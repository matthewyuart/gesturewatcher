# hts_01 — handoff

hand tracked synth. right hand plays melody, left hand plays chords, an 8-bit
drum machine with a synth bass keeps time. everything runs client-side in the
browser; no backend, no samples.

- **production:** https://gesturewatcher.vercel.app (vercel project `gesturewatcher`, team `matthewyus-projects`, deploys via `vercel deploy --prod --yes`)
- **repo:** https://github.com/matthewyuart/gesturewatcher (public, branch `main`)
- **stack:** vite + react 19 + typescript (strict, `erasableSyntaxOnly` — no param properties/enums) · @mediapipe/tasks-vision 1.0.0 · web audio
- **local dev:** `npm run dev` (predev copies mediapipe wasm from node_modules → `public/mediapipe/wasm`, gitignored; the hand model loads at runtime from google's model cdn)

## interaction model (current, do not regress)

| input | result |
| --- | --- |
| right hand, thumb+index | melody, snapped to notes **in the key** (discrete steps, no glide) |
| right hand, thumb+middle | melody, snapped to the notes **outside the key** (chromatic complement) |
| right hand, thumb+ring | melody **slide** (glide 50ms), snapped per auto/free chip |
| hand x-position | pitch along the top ruler, **left = low** (mapped to the ruler element's rect, cached 1s) |
| left hand, thumb+index/middle/ring/pinky | chord slots 1–4, held while touched; newest touch wins |
| pinch a knob + twist wrist | knob turn (135° roll = full range); mouse = vertical drag |
| mouse | everything also works natively: click buttons, hold chord cards, drag bpm bar/knobs; in mouse mode the synthetic pinch pipeline skips UI (native handlers own it) |
| `?mouse=1` | force mouse mode (used for all headless testing) |

- **no pitch bend anywhere** — the user was explicit: the displayed note must exactly equal the sounding note ("the TRUTH").
- the melody ruler is a **fixed 25-step chromatic ladder anchored at c** — chord changes dim/undim rungs, never move them.
- auto mode snaps the slide finger to the chord-fitting scale (maj/maj7→ionian, min→aeolian, min7→dorian, dom7/sus4→mixolydian, dim→locrian); free = chromatic (default).
- handedness labels from mediapipe are correct AS-IS for this user — a swap was tried and immediately reverted (`7512e21`). do not swap.

## music engine

- `src/audio/SynthEngine.ts` — 2 lead voices (dual detuned osc, envelope-gated, melody uses voice 0) + poly chord pad → shared lowpass → feedback delay → limiter → analyser. **rejects non-finite frequencies** (guard against NaN from degenerate layout rects — removing this once caused a full react unmount crash).
- `src/audio/DrumMachine.ts` — 8-bit kit (square kick w/ pitch drop, noise snare/hats) + square **synth bass following the sounding chord root** (set via `setBassRoot`). 16-step patterns: city pop (default, 102bpm) / lofi / bossa / samba / hiphop / pop / house, per-genre swing. lookahead scheduler vs the audio clock: 0.3s horizon visible, 1.5s hidden; `stop()` hard-kills all scheduled sources (tracked in a set) so stop is instant and restarts don't layer.
- `src/audio/theory.ts` — chord qualities (maj/min/dom7/maj7/min7/sus4/dim/add9) with chord→scale pairings; `ChordSlot` carries an explicit `notes: number[]` voicing (editable per-note on the 2-octave piano in the chords sheet, c3–c5); flat-rooted chords (f/bb/eb/ab/db/gb) spell + name as flats (`Bbmaj7`, ♭ on the staff). **`recognizeChord(notes)`** (after derrickward/ChordRecGen) names slots from the actual voicing — exact pitch-class-set match over ~26 templates, every present pc tried as root, root-in-bass preferred, inversions named as slash chords (`Cmaj/E`); `chordName` falls back to stored root+quality only when nothing matches. staff flat-spelling follows the recognized root. auto-mode scale + bass root still use the stored `root`/`quality` (recognition is display-only).
- **key** (`keyRoot`/`keyMode`, chords sheet, default **g minor**) is the "1" of the piece and only drives the two melody fingers above: index snaps to the ionian/aeolian set on that root, middle to the 5 leftovers. c major degenerates to the old white/black split. it does NOT affect chord voicings or the ring-finger auto scale (that still follows the sounding chord).
- progressions presets (chords sheet): plastic love in g minor (default: gm7 · **c13b9** `c-bb-db-e-a` · am · dm7), city pop royal road, pop, 50s, jazz, andalusian, blues. `slot(root, quality, notes?)` takes an explicit voicing for chords the default builder can't spell.

## gesture engine

- `src/gesture/GestureProvider.tsx` — camera (720p, `object-fit: contain`, **never crop/zoom** — user insists) + mediapipe handlandmarker (2 hands, gpu). one-euro smoothing, pinch hysteresis, per-finger thumb-touch detection (`Hand.fingerTouch`, same hysteresis), wrist roll (`Hand.roll`). **hand coords map to the video's displayed content rect** (letterbox-aware) so cursors sit on the on-screen hand. mouse fallback synthesizes one right hand (click = pinch, with a latch so instant clicks still register). rAF loop with a 150ms timer fallback (headless/hidden tabs pause rAF). react updates are **skipped when hands are static** (perf).
- `src/gesture/useHandEvents.ts` — pinch start/move/end edge detection (index finger only; melody/chords read `fingerTouch` per-frame in `Instrument`).

## ui (`src/instrument/Instrument.tsx` + `Instrument.css`)

black page, `hts_01.` title outside a rounded (22px) video stage; ALL panels
live inside the stage. **shade**: a black overlay whose opacity is set by a
manual slider in the tone sheet (0–0.9, default 0.55; drag with mouse or
camera pinch — same bar pattern as bpm). the old auto-luminance sampler was
removed. `.video-shade` must keep `z-index` above the video (video is
appended after it in the dom).

- **live by default**: an effect calls `powerOn()` on mount and, because the
  autoplay policy blocks AudioContext until a gesture, re-arms on the first
  `pointerdown`/`keydown` (capture phase). `engine.start()` is idempotent —
  it resumes a suspended ctx — so retrying is free. the `on`/`live` pill just
  reflects `audioOn`.
- glass panels: 4 chord cards, staff float, tab rail, **and the sheet**
  (`gw-lg` + `<GlassShape>`); closed sheet has width 0 so the wrapper skips
  it. MAX_SHAPES is 16, currently ≤7 in use.
- top ruler = melody, **right-aligned** (`left: 24%` / `right: 20px`); `auto/free` mode + `tutorial` + `on` pills live in the **bezel header row** next to the title (outside the stage — camera pinches may not reach them, mouse always works); tabs `beat/chords/tone` right edge; sheets stop at `bottom: 162px` so they clear the scope dock; chord cards bottom row; piano black keys are `4.2%` wide (offset `-2.1%` in the tsx); white bench-style oscilloscope (`TechScope`, rising-edge trigger, freq/vpp readouts) bottom-right; floating staff card (`StaffChord`, hand-rolled svg treble staff w/ accidentals + ledger lines) follows the left hand, anchors above the cards without one.
- typography: inter (google fonts), regular tracking, **everything lowercase** (`text-transform` on `.hts-page` + `button { text-transform: inherit }`), **nothing bold**.
- hand cursor overlay: always **white outlines** + dark halo; pinch = thicker outline ring, **never filled**.
- central interaction: controls register dom nodes in `controlsRef` (per-id cached ref callbacks); camera pinches hit-test those rects; claims (`claimsRef`) route knob/bpm/chord-card drags per hand. hover glow (`gw-hot`) computed only in camera mode against 400ms-cached rects; mouse uses css `:hover`.

### glass (plain css — liquid-glass-react was REMOVED, do not reintroduce)

every glass element (pills, chord cards, staff card, sheet, rail, scope dock,
tutorial) is ONE element: `background: var(--glass)` (gradient sheen, in
`index.css`) + `backdrop-filter: blur(26px) saturate(2) brightness(1.18)` +
`border: 1px solid var(--panel-line)` + inset specular/glow + drop shadow +
its own `border-radius` (base rule in `Instrument.css`).
active (`gw-active` on `.hts-pill`, `gw-card-live` on `.gw-card`) keeps the
glass and boldens the outline: white border + 1px inset ring — never a fill.

**liquid refraction**: the glass-lab handoff package (`glass-lab/package/`,
see its README) copied verbatim into `src/instrument/`: `liquid-glass.js`
(framework-agnostic WebGL2 `LiquidGlass` class, a 4-pass port of
**iyinchao/liquid-glass-studio** verified side-by-side — full-res backdrop
blur, snell edge refraction, per-channel dispersion, LCH fresnel + glare,
metaball merge + spring stretch), `glass-preset.js` (the tuned material — one
field per lab control) and `GlassCanvas.tsx` (react wrapper). ONE canvas
overlays the stage (`.gw-glass-canvas`, z 3); chord cards + staff float opt
in via a `<GlassShape radius>` child + `gw-lg` class (strips css glass body;
DOM keeps outline/text/lift). pills keep css glass (black bezel — nothing to
refract). works in every browser; straight-alpha output layers over the dom
video.

- **tune in the lab**: `/glass-lab/` (standalone vite page) → dial controls →
  "copy config for main app" → paste over `src/instrument/glass-preset.js`.
- `blurRadius` 1 = clear reference glass; 20–40 if text legibility suffers.
  `refDispersion` 7 subtle, 20+ rainbow fringing. `mergeRate` stays **0** —
  the user explicitly rejected shapes fusing. `mirror: true` in the wrapper —
  the dom video is scaleX(-1).
- **rings are shader-drawn and per shape** (renderer extension: `border`
  0..1 on each shape → `u_shapeParams[i].z`, weighted by nearest-shape in
  `borderWeightAt`). the wrapper maps element state each frame: `gw-card-live`
  / `gw-active` → 1, `gw-hot` / `:hover` → 0.5, resting → 0. `borderEnabled`
  in the preset gates the feature and must stay true. `gw-lg` DOM draws NO
  border/bg/shadow in ANY state (css forces transparent) — one flattened
  layer, exact SDF fit, squircle corners (preset roundness 5) preserved.
- `.gw-staff-float` must NOT have a transform transition — the canvas reads
  its rect per frame and a css tween makes glass and dom shear apart.
- glass visual checks headlessly: `window.__glassPattern(true)` substitutes a
  stripe texture for the camera, then screenshot.
- the backdrop pass fades the source to `voidColor` over a **12px band** at
  the letterbox edges. do not restore the hard `if (uv in 0..1)` cut: the
  dispersion samples r/g/b at different offsets, so a 1px source edge splits
  into a coloured fringe (the user-reported "red bar" down the right side).
- the wrapper's try/catch stays — glass must never unmount the app; the
  renderer never throws after construction.
- failed approaches, do not revisit: `liquid-glass-react` npm lib (inner
  layers escape rounded clipping → square slabs, `ed25290`…`9f3d1d9`);
  per-element svg feImage displacement via `backdrop-filter: url(#…)`
  (`fcd263e`: right look, but 7 backdrop readbacks/frame = slow, and a filter
  defined inside the filtered element's subtree wedges chromium's
  compositor); calling `loseContext()` in react cleanup (strictmode remounts
  inherit the same, permanently dead context).

## testing (headless — how all of this was verified)

- always test against `http://localhost:5173/?mouse=1` (browser pane has no camera).
- debug hooks on `window`: `__synth()` (gates/freqs/rms/params), `__synthEngine`, `__drum()`, `__ui()`, `__melody(finger, clientX)` → note name (makes the camera-only finger-piano routing testable: sweep x across the ruler rect and assert the pitch-class set).
- the pane throttles the gesture loop to ~1fps when hidden and **collapses layout to zero size between tool calls**: drive drags as stepped synthetic `PointerEvent`s with 1.3s sleeps between down/move/up; **never trust rect measurements or screenshots for layout verification** — plant an in-page poller that captures rects when width > 0, screenshot (forces layout), then read the report. css transitions pause while the pane is hidden, so computed colors mid-transition read stale; set `transition: none` before reading.
- glass visual checks: paint `.video-backdrop-fallback` with harsh color stripes via js, then screenshot.
- audio checks: `noteOn` → `__synth().gates/freqs` + rms > 0; drums → poll max rms over ~2s (hits are transient).

## glass-lab (standalone sub-project, `glass-lab/`)

Buildless static playground: liquid glass panel over the live camera, 4-pass WebGL2 port of iyinchao/liquid-glass-studio (MIT). Pipeline matches the reference exactly: bgPass → vBlur → hBlur → mainPass, ALL AT FULL CANVAS RESOLUTION (half-res blur was the reason it looked washed out vs the original), gaussian sigma = radius/3 like the studio's computeGaussianKernelByRadius, STEP-9 material math verbatim (Snell edge refraction, per-channel dispersion = chromatic aberration, LCH fresnel + glare), plus the studio's rounded-rect ⊕ circle smooth-min metaball merge and springSizeFactor stretch. Parameter names/ranges/defaults are copied from the studio's Leva panel; shadow position uses the studio sign convention (negative y = below). Debug "show step" 0-9 reproduces the studio's intermediate views (0 sdf, 2 normals, 3 edge factor, 5 blur, 6-8 build-up, 9 full).

HANDOFF PACKAGE for the main app: `glass-lab/package/` — `liquid-glass.js` (framework-agnostic renderer class, up to 16 shapes on one canvas, straight-alpha output so it layers over the DOM video), `liquid-glass.d.ts` + `glass-preset.d.ts` (types), `glass-preset.js` (tuned material values), `GlassCanvas.tsx` (drop-in replacement for `src/instrument/GlassCanvas.tsx`, same `<GlassCanvas shade>` / `<GlassShape radius>` API, no other file changes needed — trial-integrated and `tsc -b && vite build` passes), `demo.html` (standalone smoke test at /glass-lab/package/demo.html), `README.md`. The lab's "copy config for main app" button emits `glass-preset.js` verbatim, so tuning round-trips.

Differences from the studio, all deliberate: the rect is the user-draggable panel and the circle blob follows the cursor (reference does the reverse); backgrounds are camera + procedural (checkerboard/bars/half/grid/hue) + the user's own photos (added via file picker, downscaled to 2048px JPEG and kept in localStorage `glasslab:images` — the studio's bundled wallpapers/press photos were NOT copied, they aren't the author's to relicense); arrow keys flick through backgrounds; optional white border highlight band (default OFF so the base material matches the reference). State: `glasslab:params`, `glasslab:pos`, `glasslab:presets` (named presets). Plain ES modules, no npm deps. Dev: launch config `glass-lab` (python http.server :4519). Deployed by `npm run build` copying the folder to `dist/glass-lab` → https://gesturewatcher.vercel.app/glass-lab/. Debug hook: `__glassLab()`. To compare against the reference: clone iyinchao/liquid-glass-studio, `npm i`, `npx vite --port 4520`.

## deploy

```bash
npm run build        # tsc -b && vite build (prebuild copies wasm)
git push             # public repo
vercel deploy --prod --yes
```
prod smoke: power click → `__synth().running` → pinch → gate/freq → done.
(the vercel cli here is old, 51.8.0 → 58.4.4; upgrading is recommended but current one works.)

## tunables the user may still want adjusted

- shade slider: `SHADE_MAX 0.9`, default `0.55` (`Instrument.tsx`).
- glass: the `blur(26px) saturate(2) brightness(1.18)` backdrop in `Instrument.css` + the `--glass` gradient in `index.css`.
- finger-touch thresholds: `PINCH_ON 0.32 / PINCH_OFF 0.45` ratios in `src/gesture/classify.ts` (shared by pinch + all finger touches).
- knob twist range: `TWIST_FULL` = 135°.
- staff card offset from the left hand: `+26 / -170` px in the `staffPos` memo.

## known rough edges

- camera-only paths (finger-piano routing, twist, staff following) can't be exercised headlessly — user feel is ground truth; everything else has scripted coverage.
