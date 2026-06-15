# Loop: optimización de assets + caza de bugs

Prompt loopeable. Cada iteración hace **una** mejora de assets y **una** caza-y-arreglo de bug,
verifica, y commitea. Lanzar con:

```
/loop 30m <pegar el bloque de PROMPT de abajo>
```

(o sin intervalo para que el modelo se auto-marque el ritmo).

---

## PROMPT

Sos un loop autónomo de mejora incremental en la rama `feature/ai-enemy`. Cada iteración
hacés **un paso de bugs (PRIMARIO)** y **un paso de assets (SECUNDARIO, solo si hay win seguro)**,
los verificás, y commiteás. Menos es más: cambios chicos, atómicos, verificados. Nunca rompas el build.

**Rumbo (decidido por el usuario, iter 3):** el peso de assets ya está optimizado (poda + lossless).
Los bugs son ahora la prioridad — cada iteración el paso de bugs es el principal. El paso de assets
solo se hace si aparece un win **seguro** (ver tarea aprobada de `factions/` abajo); si no, registrá
"assets: idle" y seguí con bugs. No fuerces cambios de assets sin win claro.

### Estado / anti-repetición
Mantené el ledger `docs/loops/LEDGER.md`. Al empezar, leelo. Tiene dos tablas:
`## Assets` (archivo · acción · antes→después · iteración) y `## Bugs` (archivo:línea · síntoma ·
fix · verificación · iteración). Nunca repitas una fila ya hecha. Si no existe, creálo.

### Paso A — Assets (SECUNDARIO — solo si hay win seguro)
Poda de muertos (iter 1) y recompresión lossless (iter 2) ya están hechas. **No hay** ImageMagick
en esta máquina — `convert` es la utilidad de Windows (FAT→NTFS), NO usar; la única herramienta de
imagen es Pillow (Python). El set **vivo** es lo referenciado por `src/canvas/PixiApp.ts` y
`src/data/factions.json` (carpeta `public/units/normalized/`).

**Tarea aprobada pendiente — re-normalizar `factions/` estándar (decisión del usuario, iter 3):**
los sprites `factions/` no pasaron por `normalize-units.py` y tienen escala visible inconsistente.
Re-normalizá SOLO los de categoría **infantry / cavalry / skirmisher** a su target por tipo
(132/144/124), desde su fuente `art-source/tokens-topdown/<cat>/<name>__td.png`. **Dejá intactos
chariot / elephant / ship / siege** (intencionalmente grandes — no tienen target). Hacelo de a pocos
sprites por iteración (p.ej. una categoría por vez), registrando cada uno. Verificá: dims 160×160,
figura centrada, alpha intacto, `npm run build` verde. Cuando esto esté completo, no quedan más
wins de assets seguros conocidos → registrá "assets: idle" y enfocá bugs.

**Regla dura** (para cualquier recompresión futura): dimensiones y canal alpha (umbral 8) no
cambian salvo en la re-normalización aprobada de arriba (que SÍ cambia la escala visible a propósito,
pero mantiene el canvas 160×160). Fuera de eso, si difieren → revertí.

### Paso B — Bugs (encontrar y arreglar)
Elegí UN módulo aún no barrido este ciclo (rotá por: `src/battle/simulate.ts`,
`src/battle/ai/*.ts`, `src/sim/runMatch.ts`, `src/canvas/render/*.ts`, `src/canvas/input/*.ts`,
`src/canvas/useBattleTick.ts`, `src/canvas/world-gen.ts`). Leelo buscando bugs **reales**, no
estilo: off-by-one, comparación de tick equivocada, mutación de estado compartido, key de hex
ad-hoc en vez de `HexUtils.key`, refs que cierran sobre estado viejo, NaN/clamp faltante en
caminos que el sim recorre, fugas de filtros/texturas PIXI.

**Atajo de alto ROI (empezá por acá):** corré los regression scripts y buscá ROJOS —
`npx tsx scripts/sim-formations.ts` y los `scripts/test-ai-*.ts`. **Ojo con el exit code**: NO
uses `... | tail` para leerlo (capturás el exit de `tail`); leé la línea `N/M passed` del propio
test. Un test fallando = bug real **ya verificado** — pero distinguí *bug de código* vs *test
stale* (un test que asume balance/API viejos tras un cambio legítimo). Si es código roto en
`src/battle/ai/`, NO lo "arregles" tuneando el controller sin medir con `sim-ai-vs-ai` (CLAUDE.md);
si es test stale, arreglá el test para que refleje el comportamiento correcto actual, sin tocar el
controller. (iter 3: `test-ai-counter` apuntaba a la dificultad `hard` que ganó `frontLines:true` y
bypassa el mecanismo bajo test → fix solo de test.)

Para cada bug candidato: **probá que es real antes de tocar nada** (construí el caso con una sonda,
citá la línea, explicá el síntoma observable). Arreglá solo si estás seguro; los falsos positivos
son peor que no hacer nada. Un bug por iteración.

### Verificación (obligatoria antes de commitear)
- `npm run build` debe pasar (tsc + vite). Si falla, arreglá o revertí — no commitees roto.
- Si tocaste `src/battle/*`, `combat/units/terrain` json: `npx tsx scripts/sim-formations.ts` y
  diff de resultados (sin drift inesperado).
- Si tocaste `src/battle/ai/*`: corré el `scripts/test-ai-*.ts` relevante.
- Si tocaste assets vivos: confirmá que `npm run build` los empaqueta y que dimensiones+alpha
  no cambiaron.
No declares nada "verificado" sin haber corrido el comando y leído su salida.

### Commit
Un commit por iteración, atómico, mensaje en el estilo del repo (`fix(...)`, `chore(assets): ...`,
`perf(assets): ...`). Cuerpo: qué cambió y la evidencia de verificación (1-2 líneas).
Terminá con:
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
Actualizá `docs/loops/LEDGER.md` en el mismo commit.

### Parada
Si en una iteración no hay ni asset ni bug que valga la pena (ledger al día, módulos barridos sin
hallazgos reales), escribí "ciclo limpio — nada que hacer" y no commitees vacío. Cuando todos los
módulos estén barridos, empezá un nuevo ciclo de barrido (los bugs reaparecen al evolucionar el código).
