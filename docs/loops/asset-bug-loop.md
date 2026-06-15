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
hacés **exactamente un paso de assets** y **exactamente un paso de bugs**, los verificás, y
commiteás. Menos es más: cambios chicos, atómicos, verificados. Nunca rompas el build.

### Estado / anti-repetición
Mantené el ledger `docs/loops/LEDGER.md`. Al empezar, leelo. Tiene dos tablas:
`## Assets` (archivo · acción · antes→después · iteración) y `## Bugs` (archivo:línea · síntoma ·
fix · verificación · iteración). Nunca repitas una fila ya hecha. Si no existe, creálo.

### Paso A — Assets (peso + dimensiones)
El set **vivo** es solo lo referenciado por `src/canvas/PixiApp.ts` y `src/data/factions.json`
(carpeta `public/units/normalized/`). Todo lo demás en `public/units/*.png` (raíz) es candidato
a **asset muerto**. Elegí UNA de estas, la de mayor impacto aún no hecha:

1. **Podar muertos**: confirmá que un PNG de `public/units/` (raíz) NO está referenciado en
   ningún `src/**` ni `*.json` (grepealo, sin falsos positivos por substring). Si está muerto,
   `git rm` y registralo. Estos ~15 MB son el grueso del peso del repo.
2. **Dimensiones uniformes**: si algún sprite vivo se salió del canvas/escala que impone
   `scripts/normalize-units.py` (canvas 160, targets por tipo cavalry144/infantry132/skirmisher124),
   re-normalizalo corriendo el script y verificá que el resultado sigue centrado y con alpha intacto.
3. **Peso (sin pérdida visible)**: reducí el peso de un PNG vivo. Orden de preferencia:
   `oxipng -o4 --strip safe` (instalalo con `cargo install oxipng` o `npm i -g oxipng` si falta y
   es barato); si no, Pillow `Image.save(optimize=True)` + cuantización a paleta solo si el sprite
   no pierde gradientes; último recurso `convert -strip -define png:compression-level=9`.
   **Regla dura**: las dimensiones y el canal alpha (umbral 8) no pueden cambiar; compar=á dimensiones
   y bounding-box de alpha antes/después. Si difieren → revertí.

Registrá antes→después en KB. Si no queda nada de assets por hacer, escribí "assets: idle" en el
ledger esa iteración y pasá a bugs.

### Paso B — Bugs (encontrar y arreglar)
Elegí UN módulo aún no barrido este ciclo (rotá por: `src/battle/simulate.ts`,
`src/battle/ai/*.ts`, `src/sim/runMatch.ts`, `src/canvas/render/*.ts`, `src/canvas/input/*.ts`,
`src/canvas/useBattleTick.ts`, `src/canvas/world-gen.ts`). Leelo buscando bugs **reales**, no
estilo: off-by-one, comparación de tick equivocada, mutación de estado compartido, key de hex
ad-hoc en vez de `HexUtils.key`, refs que cierran sobre estado viejo, NaN/clamp faltante en
caminos que el sim recorre, fugas de filtros/texturas PIXI.

Para cada bug candidato: **probá que es real antes de tocar nada** (construí el caso, citá la
línea, explicá el síntoma observable). Arreglá solo si estás seguro; los falsos positivos son
peor que no hacer nada. Un bug por iteración.

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
