# rloop - OpenClaw Task Monitor Plugin

## Dev Commands
- `npm test` — Run tests (vitest)
- `npm run build` — Compile TypeScript via esbuild

## Architecture
- Single-file plugin: `index.js` (compiled from `index.ts` + all `src/*.ts`)
- Entry point: `index.js` exports `register()` for OpenClaw plugin API
- State persisted to `state/STATE.json` (managed by `src/state-manager.ts`)
- Session monitor state: `state/session-monitor.json`

## Build Order
TypeScript sources in `src/` → compiled into `index.js` (not committed to git for .map files). Run `npm run build` after editing `src/`.

## Config
- Config is partial-merged with `DEFAULT_CONFIG` in `src/types.ts`
- `sessionMonitor` property requires full object in schema or it will be undefined; fix schema if adding new fields