# Airdrop Simulator

Исходник приложения лежит в `src/` и **не меняется** при сборке.

## Структура

```
src/gta5-airdrop-tool-v3.html   — оригинал для разработки
dist/index.html                 — собранная версия (обфускация)
docs/index.html                 — копия для GitHub Pages (по команде build:pages)
build.mjs                       — скрипт сборки
```

## Сборка

```powershell
cd "X:\Airdrop Simulator"
npm install
npm run build
```

Команды:

| Команда | Результат |
|---------|-----------|
| `npm run build` | Жёсткая обфускация (control flow, RC4-строки, self-defending) |
| `npm run build:light` | Слабая обфускация (старый режим, для отладки) |
| `npm run build:min` | Только минификация — **не защита**, код легко читается |
| `npm run build:pages` | `dist/` + `docs/index.html` для GitHub Pages |
| `npm run build:pages:min` | То же, но с минификацией |

**Важно:** 100% защиты у клиентского JS нет. `build:min` лишь убирает пробелы. `npm run build` сильно усложняет копирование, но мотивированный человек всё равно может восстановить логику через DevTools.

## GitHub Pages

1. Залейте репозиторий на GitHub.
2. Выполните `npm run build:pages`.
3. Settings → Pages → Source: branch `main`, folder `/docs`.
4. Сайт: `https://<user>.github.io/<repo>/`

Папки `dist/` и `docs/` в `.gitignore` — перед публикацией уберите `docs/` из ignore или коммитьте только `docs/index.html`.
