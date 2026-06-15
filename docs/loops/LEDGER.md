# Ledger — loop assets + bugs

Registro de pasos hechos por el loop `asset-bug-loop`. No repetir filas.

## Assets

| iter | archivo / acción | antes → después | verificación |
|------|------------------|-----------------|--------------|
| 1 | Podar 14 originales muertos (0 refs) de `public/units/` → `art-source/originals/`; reapuntar `normalize-units.py` (DEFAULT_SOURCE_DIR) | `public/units` 16 MB → 2.7 MB; `dist/units` 16 MB → 2.7 MB | `npm run build` ✓; dist solo `boat`/`javelin` + 12 normalizados; assets vivos intactos; 14/14 fuentes resuelven en el script |
| 2 | Recompresión **lossless** (Pillow `optimize`+`compress_level=9`) de los 41 PNG vivos (normalized + boat/javelin). Solo reemplazo si más chico, pixel-idéntico y mismas dims. Nota: NO hay ImageMagick — `convert` en Windows es la utilidad de sistema (FAT→NTFS), no usar | `dist/units` 2.7 MB → 2.4 MB (−287 KB, 11%; javelin −24%, boat −3%) | `npm run build` ✓; 41/41 pixel-idénticos y mismas dimensiones (verificado con numpy `array_equal`) |
| 3 | **Hallazgo (diferido, decisión de diseño — NO aplicado):** los sprites `factions/` no pasaron por `normalize-units.py` → escala visible inconsistente (infantry 116–160 px vs target 132; cavalry 127–151 vs 144). Fuentes existen en `art-source/tokens-topdown/<cat>/<name>__td.png`. Re-normalizar en bloque es ambiguo: roles ≠ categoría (skirmisher de Grecia usa sprite de infantería) y categorías sin target (elephant/ship/siege intencionalmente grandes). Requiere decisión del usuario | — (sin cambio de assets esta iteración) | dims 160×160 uniformes ✓; escala visible medida por alpha-bbox |
| 4 | **Pipeline mapeado, ejecución DIFERIDA (no es win seguro de un tiro):** re-normalizar `factions/` estándar (decisión iter 3 = aprobada). Las fuentes topdown son **RGB opacas 1254×1254 con fondo verde plano** (RGB ~[39,133,35], std≈1) → requieren `chroma-key.py` (quitar verde, preserva verde interior de cascos/escudos) y LUEGO `normalize-units.py --target-size {132/144/124} --canvas-size 160`. **Bloqueante:** la orientación (¿rotación 180°?) no se puede verificar headless con confianza; re-normalizar a ciegas arriesga sprites mal orientados (regresión visible). Próxima iter de assets: hacer 1 sprite, comparar silueta alpha vs el normalizado actual, y si la orientación coincide, correr la categoría | — (sin cambio de assets) | fondo verde confirmado; `chroma-key.py` aplica; modo single-file del script soporta target/canvas |

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
| 4 | `scripts/test-ai-advance.ts` | **BUG (test stale, misma familia que counter)**: 1/4 fallando. Verifica el loose-march de 4 bandas paralelas, pero driveaba `normal` (ahora `frontLines:true` → rolling waves seriales, G2..G4 no co-avanzan) | **ARREGLADO**: `makeAiControllerProfile` con `frontLines:false`. Probado: 4/4 ✓ (controller intacto) |
| 4 | **TRIAGE de tests rojos restantes** (correr `for f in scripts/test-*.ts`): `front` 2/4 y `groups` 3/6 driveaban `hard`; `rotation` 1/2 driveaba `normal` → **misma familia stale-difficulty**, fix esperado = pin `frontLines:false`. `config` 19/22 y `profile` 8/10 **NO** usan `makeAiController` → mecanismo distinto, requieren diagnóstico propio. Uno por iteración | — (diagnóstico, no fix) | exit codes leídos de la línea `N/M passed`, no vía `tail` |
