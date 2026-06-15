# Ledger — loop assets + bugs

Registro de pasos hechos por el loop `asset-bug-loop`. No repetir filas.

## Assets

| iter | archivo / acción | antes → después | verificación |
|------|------------------|-----------------|--------------|
| 1 | Podar 14 originales muertos (0 refs) de `public/units/` → `art-source/originals/`; reapuntar `normalize-units.py` (DEFAULT_SOURCE_DIR) | `public/units` 16 MB → 2.7 MB; `dist/units` 16 MB → 2.7 MB | `npm run build` ✓; dist solo `boat`/`javelin` + 12 normalizados; assets vivos intactos; 14/14 fuentes resuelven en el script |

## Bugs

| iter | módulo barrido | hallazgo | acción |
|------|----------------|----------|--------|
| 1 | `src/battle/ai/perception.ts` | limpio (coarseness de centroide documentada como intencional) | — |
| 1 | `src/canvas/useBattleTick.ts` | limpio (keys `groupOrderKey` = `${team}:${gid}` consistentes con `liveGroups`) | — |
| 1 | `src/battle/ai/controller.ts` | sin bug confiable; finamente tuneado — CLAUDE.md prohíbe tocar sin medir con sim-ai-vs-ai | — |
| 1 | `src/canvas/input/orderDrag.ts` | limpio (start/current ambos en coords de mundo vía `world.toLocal`) | — |
