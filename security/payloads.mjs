/** Shared XSS / injection payloads for security tests */

export const XSS_HTML = [
  '<img src=x onerror="window.__xssHit=1">',
  '<script>window.__xssHit=1</script>',
  '"><svg/onload=window.__xssHit=1>',
  '<iframe src="javascript:window.__xssHit=1">',
  '\'><img src=x onerror="window.__xssHit=1">'
];

export const XSS_NAMES = [
  '<img src=x onerror="window.__xssHit=1">',
  '"><script>window.__xssHit=1</script>',
  'Zone\u0000Hidden',
  'Normal & <evil> "quotes"'
];

export const BAD_URLS = [
  'javascript:alert(1)',
  'data:text/html,<script>window.__xssHit=1</script>',
  'https://evil.com/watch?v=abcdefghijk',
  'https://www.youtube.com/watch?v=abc<script>',
  'https://www.youtube.com/embed/abcdefghijk'
];

export const BAD_COLORS = [
  'javascript:alert(1)',
  '#ff0000"><script>window.__xssHit=1</script>',
  'expression(alert(1))',
  'red; background:url(javascript:window.__xssHit=1)'
];

export const LABEL_COORDS = [533.8417, -2853.9033];

export function encodeAdp1(profile) {
  const json = JSON.stringify(profile);
  const b64 = Buffer.from(json, 'utf8').toString('base64');
  return `ADP1:${b64}`;
}

export function emptyZoneChunk() {
  return [[], [], []];
}

export function profileWithLabel(text, color = '#ffff00') {
  const [lat, lng] = LABEL_COORDS;
  return {
    v: 3,
    a: {
      0: [
        [],
        [[lat, lng, text, color]],
        []
      ]
    },
    c: []
  };
}

export function profileWithCustomZone(name, extraChunk = emptyZoneChunk()) {
  const a = {};
  for (let i = 0; i < 18; i++) a[i] = emptyZoneChunk();
  return {
    v: 3,
    a,
    c: [['evilid', name, 500, 500, 150, 300, extraChunk]]
  };
}

export function profileWithClimb(url) {
  const [lat, lng] = LABEL_COORDS;
  return {
    v: 3,
    a: {
      0: [
        [],
        [],
        [[lat, lng, url]]
      ]
    },
    c: []
  };
}

export function profileLegacyV2(labelText) {
  const [lat, lng] = LABEL_COORDS;
  return {
    v: 2,
    z: [['<img src=x onerror="window.__xssHit=1">', 500, 500]],
    d: [
      [
        [],
        [[lat, lng, labelText, '#ffff00']],
        []
      ]
    ]
  };
}
