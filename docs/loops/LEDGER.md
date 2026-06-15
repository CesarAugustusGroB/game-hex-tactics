# Ledger — loop assets + bugs

Registro de pasos hechos por el loop `asset-bug-loop`. No repetir filas.

## Assets

| iter | archivo / acción | antes → después | verificación |
|------|------------------|-----------------|--------------|
| 1 | Podar 14 originales muertos (0 refs) de `public/units/` → `art-source/originals/`; reapuntar `normalize-units.py` (DEFAULT_SOURCE_DIR) | `public/units` 16 MB → 2.7 MB; `dist/units` 16 MB → 2.7 MB | `npm run build` ✓; dist solo `boat`/`javelin` + 12 normalizados; assets vivos intactos; 14/14 fuentes resuelven en el script |
| 2 | Recompresión **lossless** (Pillow `optimize`+`compress_level=9`) de los 41 PNG vivos (normalized + boat/javelin). Solo reemplazo si más chico, pixel-idéntico y mismas dims. Nota: NO hay ImageMagick — `convert` en Windows es la utilidad de sistema (FAT→NTFS), no usar | `dist/units` 2.7 MB → 2.4 MB (−287 KB, 11%; javelin −24%, boat −3%) | `npm run build` ✓; 41/41 pixel-idénticos y mismas dimensiones (verificado con numpy `array_equal`) |
| 3 | **Hallazgo (diferido, decisión de diseño — NO aplicado):** los sprites `factions/` no pasaron por `normalize-units.py` → escala visible inconsistente (infantry 116–160 px vs target 132; cavalry 127–151 vs 144). Fuentes existen en `art-source/tokens-topdown/<cat>/<name>__td.png`. Re-normalizar en bloque es ambiguo: roles ≠ categoría (skirmisher de Grecia usa sprite de infantería) y categorías sin target (elephant/ship/siege intencionalmente grandes). Requiere decisión del usuario | — (sin cambio de assets esta iteración) | dims 160×160 uniformes ✓; escala visible medida por alpha-bbox |

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
| 3 | `scripts/test-ai-counter.ts` | **BUG real (test stale)**: 3/4 fallando. El test verifica early-launch por danger (`launchShare`), pero seleccionaba dificultad `hard`, que ganó `frontLines:true` (commit `bdfdc93`) → ese path usa `bandCap`, bypassa `launchShare`. Controller correcto, test apuntaba al path equivocado | **ARREGLADO**: pasar a `makeAiControllerProfile` con perfil parallel-front explícito (`frontLines:false`, `forceScale:0.7`) en vez de la dificultad que derivó. Probado: 4/4 ✓ (controller intacto, sin tuneo de IA) |
