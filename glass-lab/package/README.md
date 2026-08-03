# liquid-glass — handoff package

Self-contained liquid-glass renderer, extracted from the glass lab and tuned
against the reference implementation
([iyinchao/liquid-glass-studio](https://github.com/iyinchao/liquid-glass-studio),
MIT © Charles Yin).

Zero dependencies, plain ES modules, WebGL2. Nothing here imports React except
the optional `GlassCanvas.tsx` wrapper.

## Files

| file | what it is |
| --- | --- |
| `liquid-glass.js` | the renderer. Framework-agnostic `LiquidGlass` class. |
| `liquid-glass.d.ts` | TypeScript types for the above. |
| `glass-preset.js` | the tuned material values, one field per lab control. |
| `GlassCanvas.tsx` | drop-in React layer for the main app (same API as the current one). |
| `demo.html` | standalone smoke test — open it to see three panels over a backdrop. |

## Dropping it into the main app

1. Copy `liquid-glass.js`, `liquid-glass.d.ts`, `glass-preset.js`,
   `glass-preset.d.ts` and `GlassCanvas.tsx` into `src/instrument/`, replacing
   the existing `GlassCanvas.tsx`:

   ```bash
   cp glass-lab/package/{liquid-glass.js,liquid-glass.d.ts,glass-preset.js,glass-preset.d.ts,GlassCanvas.tsx} src/instrument/
   ```

   This exact copy has been trial-run against the app: `tsc -b && vite build`
   passes with no changes to any other file.
2. Nothing else changes. `Instrument.tsx` keeps `<GlassCanvas shade={shade} />`
   and `<GlassShape radius={12} />` exactly as they are, and the existing
   `.gw-glass-canvas` / `.gw-fx` CSS still applies.
3. Tune by editing `glass-preset.js`.

The canvas renders **straight alpha** — transparent everywhere except the
shapes and their shadow — so it layers over the DOM `<video>` without hiding
it. The video is still handed to the renderer as a texture, because that is
what gets bent, blurred and dispersed.

## Using it without React

```js
import { LiquidGlass } from './liquid-glass.js';
import { GLASS_PRESET } from './glass-preset.js';

const glass = new LiquidGlass(canvas, { preset: GLASS_PRESET });

glass.setSource(videoEl, { x: 0, y: 0, w: 1280, h: 720 }); // css px, or null to fill
glass.setShapes([{ x: 40, y: 40, width: 380, height: 220, radius: 22 }]);
glass.setShade(0.3);
glass.start();            // or call glass.renderFrame() from your own loop
```

Call `glass.setShapes(...)` every frame if the panels move; it is a cheap
uniform upload. `glass.resize()` is idempotent — safe to call per frame.

Up to **16 shapes** per canvas (`MAX_GLASS_SHAPES`). With `mergeRate > 0`,
shapes that come close fuse into one blob like mercury.

## Tuning

Every field in `glass-preset.js` maps to a control in the lab at
`/glass-lab/`. Dial it in there, press **copy config for main app**, and paste
the result over `glass-preset.js`.

Two knobs matter most:

- **`blurRadius`** — `1` is clear glass (what the reference ships). Panels that
  carry text usually want `20`–`40` so type stays legible against a busy camera
  feed.
- **`refDispersion`** — the chromatic aberration. `7` is subtle and physical;
  push to `20`+ for obvious rainbow fringing on the rim.

## Gotchas worth keeping

- **Blur must run at full canvas resolution.** Halving it to save fill rate is
  what made an earlier port look like frosted plastic rather than glass.
- **Gaussian sigma is `radius / 3`**, matching the reference. Other sigmas
  visibly change the frost at the same radius number.
- **`shadowY` is negative for a shadow below the shape** — the reference's sign
  convention, kept so numbers copy across from the studio unchanged.
- The renderer never throws after construction; construction can throw if
  WebGL2 is missing, so keep it in a `try`/`catch` — the glass is decoration and
  must not take the app down.
