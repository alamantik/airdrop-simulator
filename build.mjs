import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { minify } from 'terser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const SRC_FILE = path.join(ROOT, 'src', 'gta5-airdrop-tool-v3.html');
const DIST_DIR = path.join(ROOT, 'dist');
const DIST_FILE = path.join(DIST_DIR, 'index.html');
const DOCS_DIR = path.join(ROOT, 'docs');
const DOCS_FILE = path.join(DOCS_DIR, 'index.html');

const mode = process.argv.includes('--min')
  ? 'min'
  : process.argv.includes('--light')
    ? 'light'
    : 'hard';
const copyToDocs = process.argv.includes('--pages');

const EXTRA_RESERVED = ['L'];
const HANDLER_SKIP = new Set(['event', 'return', 'if', 'void', 'new', 'typeof', 'stopPropagation']);

function extractInlineScript(html) {
  const re = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let last = null;
  while ((match = re.exec(html)) !== null) last = match;
  if (!last) throw new Error('Inline <script> block not found in source HTML.');
  return { full: last[0], code: last[1] };
}

function addCallsFromHandler(expr, names) {
  for (const m of expr.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (!HANDLER_SKIP.has(m[1])) names.add(m[1]);
  }
}

function collectReservedNames(html) {
  const names = new Set(EXTRA_RESERVED);
  const patterns = [
    /\bon[a-z]+\s*=\s*"([^"]+)"/gi,
    /\bon[a-z]+\s*=\s*'([^']+)'/gi,
    /onclick\s*=\s*"([A-Za-z_$][\w$]*)\s*\(/g,
    /window\.([A-Za-z_$][\w$]*)\s*=/g
  ];

  for (const re of patterns) {
    let match;
    while ((match = re.exec(html)) !== null) {
      if (re.source.startsWith('onclick')) {
        names.add(match[1]);
        continue;
      }
      if (re.source.startsWith('window')) {
        names.add(match[1]);
        continue;
      }
      addCallsFromHandler(match[1], names);
    }
  }

  return [...names];
}

function obfuscateScript(code, html, level) {
  const reservedNames = collectReservedNames(html);

  const common = {
    compact: true,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: true,
    reservedNames,
    // Never emit HTML-close sequences — they break inline <script> in index.html.
    reservedStrings: ['</script>', '</body>', '</html>'],
    target: 'browser',
    // Leaflet/DOM APIs expect real property names (crs, zoomControl, tileSize, …).
    transformObjectKeys: false,
    unicodeEscapeSequence: false
  };

  const presets = {
    light: {
      ...common,
      renameGlobals: false,
      controlFlowFlattening: false,
      deadCodeInjection: false,
      numbersToExpressions: false,
      selfDefending: false,
      stringArray: true,
      stringArrayCallsTransform: false,
      stringArrayEncoding: ['base64'],
      stringArrayThreshold: 0.75
    },
    hard: {
      ...common,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.4,
      deadCodeInjection: false,
      debugProtection: false,
      disableConsoleOutput: false,
      numbersToExpressions: true,
      selfDefending: false,
      simplify: true,
      splitStrings: false,
      stringArray: true,
      stringArrayCallsTransform: true,
      stringArrayCallsTransformThreshold: 0.75,
      stringArrayEncoding: ['rc4'],
      stringArrayIndexShift: true,
      stringArrayRotate: true,
      stringArrayShuffle: true,
      stringArrayWrappersCount: 1,
      stringArrayWrappersChainedCalls: true,
      stringArrayWrappersType: 'function',
      stringArrayThreshold: 1
    }
  };

  return JavaScriptObfuscator.obfuscate(code, presets[level]).getObfuscatedCode();
}

async function transformScript(code, html) {
  const reservedNames = collectReservedNames(html);

  if (mode === 'min') {
    const result = await minify(code, {
      compress: true,
      mangle: {
        toplevel: true,
        reserved: reservedNames
      },
      format: { comments: false }
    });
    if (!result.code) throw new Error('Terser failed to minify script.');
    return result.code;
  }

  return obfuscateScript(code, html, mode);
}

function listHtmlHandlerNames(html) {
  const names = new Set();
  for (const re of [/\bon[a-z]+\s*=\s*"([^"]+)"/gi, /\bon[a-z]+\s*=\s*'([^']+)'/gi]) {
    let match;
    while ((match = re.exec(html)) !== null) addCallsFromHandler(match[1], names);
  }
  let match;
  const onclickRe = /onclick\s*=\s*"([A-Za-z_$][\w$]*)\s*\(/g;
  while ((match = onclickRe.exec(html)) !== null) names.add(match[1]);
  return [...names];
}

function validateHtmlHandlers(html) {
  const handlers = listHtmlHandlerNames(html);
  const onWindow = new Set();
  const winRe = /window\.([A-Za-z_$][\w$]*)\s*=/g;
  let match;
  while ((match = winRe.exec(html)) !== null) onWindow.add(match[1]);

  const missing = handlers.filter((name) => !onWindow.has(name));
  if (missing.length) {
    throw new Error(
      `HTML handlers missing window export: ${missing.join(', ')}\n` +
      'Add window.<name> = <name> before init in src HTML.'
    );
  }
}

function hardenScriptForHtmlEmbedding(code) {
  return code.replace(/<\/script/gi, '<\\/script');
}

function extractEmbeddedScript(html) {
  const open = html.lastIndexOf('<script>');
  const close = html.lastIndexOf('</script>');
  if (open === -1 || close === -1 || close <= open) {
    throw new Error('Embedded <script> block not found in output HTML.');
  }
  return html.slice(open + '<script>'.length, close).trim();
}

function validateScript(code, label = 'script') {
  const tmp = path.join(ROOT, '.build-check.js');
  fs.writeFileSync(tmp, code, 'utf8');
  try {
    execSync(`node --check ${JSON.stringify(tmp)}`, { stdio: 'pipe' });
  } catch (err) {
    const detail = err.stderr?.toString?.() || err.message || String(err);
    throw new Error(`${label} failed syntax check:\n${detail}`);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

async function build() {
  if (!fs.existsSync(SRC_FILE)) {
    throw new Error(`Source not found: ${SRC_FILE}`);
  }

  const html = fs.readFileSync(SRC_FILE, 'utf8');
  validateHtmlHandlers(html);
  const { full, code } = extractInlineScript(html);
  const reserved = collectReservedNames(html);
  const transformed = await transformScript(code, html);
  validateScript(transformed, 'Obfuscated script');
  const embedded = hardenScriptForHtmlEmbedding(transformed);
  const replacement = `<script>\n${embedded}\n</script>`;
  const out = html.replace(full, () => replacement);

  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(DIST_FILE, out, 'utf8');
  validateScript(extractEmbeddedScript(out), 'Embedded dist script');

  const srcKb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  const outKb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1);
  console.log(`Build (${mode}): ${DIST_FILE}`);
  console.log(`Reserved globals: ${reserved.length}`);
  console.log(`Size: ${srcKb} KB -> ${outKb} KB`);

  if (copyToDocs) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
    fs.writeFileSync(DOCS_FILE, out, 'utf8');
    console.log(`Copied: ${DOCS_FILE}`);
  }
}

build().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
