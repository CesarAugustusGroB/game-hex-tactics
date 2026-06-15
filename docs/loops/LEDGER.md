# Ledger — loop assets + bugs

Registro de pasos hechos por el loop `asset-bug-loop`. No repetir filas.

## Assets

| iter | archivo / acción | antes → después | verificación |
|------|------------------|-----------------|--------------|
| 1 | Podar 14 originales muertos (0 refs) de `public/units/` → `art-source/originals/`; reapuntar `normalize-units.py` (DEFAULT_SOURCE_DIR) | `public/units` 16 MB → 2.7 MB; `dist/units` 16 MB → 2.7 MB | `npm run build` ✓; dist solo `boat`/`javelin` + 12 normalizados; assets vivos intactos; 14/14 fuentes resuelven en el script |
| 2 | Recompresión **lossless** (Pillow `optimize`+`compress_level=9`) de los 41 PNG vivos (normalized + boat/javelin). Solo reemplazo si más chico, pixel-idéntico y mismas dims. Nota: NO hay ImageMagick — `convert` en Windows es la utilidad de sistema (FAT→NTFS), no usar | `dist/units` 2.7 MB → 2.4 MB (−287 KB, 11%; javelin −24%, boat −3%) | `npm run build` ✓; 41/41 pixel-idénticos y mismas dimensiones (verificado con numpy `array_equal`) |

## Bugs

| iter | módulo barrido | hallazgo | acción |
|------|----------------|----------|--------|
| 1 | `src/battle/ai/perception.ts` | limpio (coarseness de centroide documentada como intencional) | — |
| 1 | `src/canvas/useBattleTick.ts` | limpio (keys `groupOrderKey` = `${team}:${gid}` consistentes con `liveGroups`) | — |
| 1 | `src/battle/ai/controller.ts` | sin bug confiable; finamente tuneado — CLAUDE.md prohíbe tocar sin medir con sim-ai-vs-ai | — |
| 1 | `src/canvas/input/orderDrag.ts` | limpio (start/current ambos en coords de mundo vía `world.toLocal`) | — |
| 2 | `src/battle/ai/rules.ts` | limpio (matcher directo condición→acción) | — |
| 2 | `src/battle/ai/deploy.ts` | limpio (slicing lat half-open, claim de footprint, pickType fallback correctos) | — |
| 2 | `src/sim/runMatch.ts` | limpio (`applyRegenLocal` ≡ `applyRegen` real; regen `STEP*CP_REGEN_N` = default de `cpRegenRef`; heading=5 default inocuo en hold/unleash) | — |
