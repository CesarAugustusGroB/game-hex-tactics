# PixiJS v8 — concise reference

Source material for a Claude skill. PixiJS is a WebGL/WebGPU 2D renderer. **v8 is a major
break from v7** — most of the traps below are v7 habits that no longer compile or silently
misbehave. Targets `pixi.js@8.x`. Every API here was corroborated against the official v8
docs (pixijs.com/8.x) and/or real usage in this repo.

## Mental model

A single `Application` owns a renderer (WebGPU-preferred, WebGL fallback) and a `stage`
(root `Container`). You build a tree of display objects under `stage`; transforms inherit
parent→child; the renderer flushes the tree each frame. Everything visible is a
`Container`, `Sprite`, `Graphics`, `Text`, `Mesh`, or `TilingSprite`.

## 1. Application lifecycle — async init (v8's #1 gotcha)

```ts
import { Application } from 'pixi.js';

const app = new Application();
await app.init({ resizeTo: window, background: '#1099bb', antialias: true });
document.body.appendChild(app.canvas);   // v8: app.canvas (v7 was app.view)
```

- **`new Application()` is empty; the work happens in `await app.init(options)`.** v7's
  synchronous `new Application(options)` is gone. All options move to `init`.
- Wrap in an async IIFE / effect. Under Vite, avoid top-level `await` in app code (build
  issues) — wrap it.
- Force the renderer when needed: `app.init({ preference: 'webgl' })`. **Custom GLSL-only
  filters break under WebGPU** — either force WebGL or supply a WGSL `gpuProgram` too.

## 2. Scene graph

```ts
const layer = new Container();
app.stage.addChild(layer);
layer.addChild(sprite);

child.zIndex = 10;
container.sortableChildren = true;   // then children render by zIndex
```

- Render order = child insertion order, unless `sortableChildren` + `zIndex`.
- Transforms (`position`, `scale`, `rotation`, `pivot`, `alpha`) cascade to children.
- Pan/zoom a whole world by transforming one container; convert screen→local with
  `container.toLocal(globalPoint)`.

## 3. Assets — async loading (the only loader in v8)

```ts
import { Assets } from 'pixi.js';

const texture = await Assets.load('/sprites/hero.png');     // single
const sheet   = await Assets.load('/atlas.json');            // spritesheet
Assets.addBundle('game', { hero: '/hero.png', tree: '/tree.png' });
const bundle  = await Assets.loadBundle('game');             // grouped preload
```

- v7's `Loader` / `Texture.from(url)` async magic is gone. **Load explicitly with
  `Assets.load` and await it** before constructing sprites.
- Cached by URL: a second `Assets.load(sameUrl)` returns the same `Texture`.

## 4. Sprites & textures

```ts
import { Sprite } from 'pixi.js';

const sprite = new Sprite(texture);    // or Sprite.from(texture)
sprite.anchor.set(0.5);                // 0.5 = centered; default 0 = top-left
sprite.position.set(100, 100);
sprite.scale.set(2);
sprite.tint = 0xff0000;                // multiplies texture color
```

- Set size via `sprite.width/height` OR `scale`, not both.
- Sharp at zoom: `texture.source.scaleMode = 'linear'` (also sets mipmap filter);
  `texture.source.autoGenerateMipmaps = true` then `updateMipmaps()` if set post-load.

## 5. Graphics — shape **then** fill/stroke (completely new in v8)

```ts
import { Graphics } from 'pixi.js';

const g = new Graphics()
  .rect(50, 50, 100, 100).fill(0xff0000)
  .circle(0, 0, 20).fill({ color: 0x00ff00, alpha: 0.5 })
  .poly([0,0, 40,0, 20,40]).stroke({ width: 2, color: 'white' });
```

- **v7 `beginFill()` / `lineStyle()` / `drawRect()` are replaced.** Define the shape
  (`rect`, `circle`, `roundRect`, `ellipse`, `poly`, `moveTo`/`lineTo`/`closePath`) **then**
  call `.fill(...)` / `.stroke(...)`.
- `fill` accepts a color, or `{ color, alpha, texture, matrix }`.
- `stroke` accepts `{ width, color, alpha, texture }`.
- Reuse: `g.clear()` then redraw. Cheap to rebuild small graphics each frame; for static
  shapes, draw once.

## 6. Text

```ts
import { Text, TextStyle } from 'pixi.js';

const label = new Text({
  text: 'Score: 0',
  style: new TextStyle({ fontFamily: 'Arial', fontSize: 24, fill: '#fff',
                         stroke: { color: '#000', width: 3 } }),
});
```

- v8: construct with a single options object `{ text, style }`. Stroke is an object
  (`{ color, width }`), not the v7 `strokeThickness` scalar.
- `BitmapText` for many/often-changing labels (cheaper than `Text`, which re-rasterizes).

## 7. Ticker — the frame loop

```ts
app.ticker.add((time) => {
  sprite.rotation += 0.01 * time.deltaTime;   // deltaTime = frame-rate-independent factor
});
```

- The callback receives a `Ticker` (use `time.deltaTime`, ~1 at 60fps; `time.deltaMS` for ms).
- Per-frame visual updates (hover, pan/zoom-driven LOD) belong here, **not** in
  framework state — keep them off the React/Vue render path.

## 8. Events — `eventMode` + federated pointer events

```ts
sprite.eventMode = 'static';            // v8 replaces v7 `interactive = true`
sprite.cursor = 'pointer';
sprite.on('pointertap', (e) => { ... });
stage.on('globalpointermove', (e) => { ... });   // fires even off-target
```

- `eventMode`: `'none'` (ignore) · `'passive'` · `'auto'` · `'static'` (interactive, not
  moving) · `'dynamic'` (interactive + moves on its own). v7's `interactive=true` ≈
  `'static'`.
- Unified pointer events: `pointerdown/up/move/tap`, `globalpointermove`, `wheel`. Use
  `e.global` then `container.toLocal(e.global)` to map into world space.

## 9. Filters & custom shaders (new v8 constructor)

```ts
import { Filter, GlProgram } from 'pixi.js';

const filter = new Filter({
  glProgram: GlProgram.from({ vertex, fragment }),         // add gpuProgram for WebGPU
  resources: { timeUniforms: { uTime: { value: 0, type: 'f32' } } },
});
sprite.filters = [filter];
app.ticker.add((t) => { filter.resources.timeUniforms.uniforms.uTime += 0.04 * t.deltaTime; });
```

- v7's `new Filter(vertex, fragment, uniforms)` is gone — pass `{ glProgram, resources }`.
- **Filter vertex shaders MUST use the v8 uniforms** `uInputSize`, `uOutputFrame`,
  `uOutputTexture` to position the quad and compute UVs. v7 full-screen-quad shaders render
  garbage. Sample the input via `uTexture`/`vTextureCoord`.
- For WebGPU support, also provide `gpuProgram: GpuProgram.from({ vertex, fragment })`
  (WGSL). GLSL-only filters work only on the WebGL renderer.

## 10. Cleanup — destroy to avoid GPU leaks

```ts
sprite.destroy({ children: true, texture: false });
app.destroy(true, { children: true });   // (removeCanvas, stageOptions)
```

- Removing from a container does **not** free GPU memory — call `destroy(...)`.
- Kill external animations (e.g. GSAP tweens) targeting an object **before** destroying it,
  or the next tick touches a freed object.

## 11. Performance levers

- **Batching:** many same-texture `Sprite`s batch into few draw calls automatically. Mixing
  textures/filters breaks batches — group by texture, minimize filtered objects.
- **`ParticleContainer`** for thousands of simple, same-texture sprites.
- **`container.cacheAsTexture(true)`** (v8 rename of v7 `cacheAsBitmap`) flattens a static
  subtree to one texture.
- **LOD:** tag children with `.label` and toggle `.visible` from the ticker by zoom level
  instead of drawing detail that's invisible when zoomed out.
- Rebuild only what changed; don't `clear()`+redraw the whole world every frame.

## 12. v7 → v8 cheat sheet

| v7 | v8 |
| --- | --- |
| `new Application(opts)` (sync) | `new Application()` + `await app.init(opts)` |
| `app.view` | `app.canvas` |
| `Loader`, `Texture.from(url)` | `await Assets.load(url)` |
| `g.beginFill(c); g.drawRect(...); g.endFill()` | `g.rect(...).fill(c)` |
| `g.lineStyle(w,c)` | `g.stroke({ width:w, color:c })` |
| `sprite.interactive = true` | `sprite.eventMode = 'static'` |
| `displayObject.name` | `displayObject.label` |
| `new Filter(vert, frag, uniforms)` | `new Filter({ glProgram, resources })` |
| `cacheAsBitmap = true` | `cacheAsTexture(true)` |
| `new Text(str, style)` | `new Text({ text, style })` |

## 13. Repo-corroborated gotchas (from LEARNINGS.md)

- **`Color.multiply(number)` is a hex-int bit-shift, not a scalar multiply.**
  `Color.shared.setValue(0xC0C0C0).multiply(0.7)` → black, because `0.7 | 0 === 0`. Pass an
  RGBA-normalized array `[s, s, s, 1]` to shade. Whenever a v8 API takes "a color-like
  thing," verify bare scalars round-trip the way you expect.
- **`Graphics.fill({ texture })` normalizes UVs to each shape's bounding box** → every tile
  shows the same stretched patch ("wallpaper"). For continuous textured terrain use a
  world-space **`TilingSprite` + a `Graphics` mask** so neighbors sample different patches.
- **Custom filter vertex shaders need `uOutputFrame`/`uInputSize`/`uOutputTexture`** (see §9)
  — a v7-style full-viewport quad shader is wrong under v8.
- **`.label` is the v8 layer-tag.** Tagging children and toggling `.visible`/styling by tag
  from the ticker is a cheap LOD/grouping mechanism.

## Sources

- Official v8 docs & migration guide: https://pixijs.com/8.x/guides/migrations/v8
- This repo: `LEARNINGS.md`, `src/canvas/PixiApp.ts`, `src/canvas/water-filter.ts`,
  `src/canvas/render/drawUnits.ts`.
