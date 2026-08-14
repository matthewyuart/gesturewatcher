# hts_01 — fact base

Source of truth for the case study. Everything here is traceable to a commit,
a file, or a measurement. No narrative.

## Shape of the project

- 42 commits, 2026-07-30 → 2026-08-12 (14 days)
- 3,354 lines of TS/TSX in `src/`
- **25 of 42 commit messages mention the glass** — the single largest cost
  centre in the project (`git log --grep=glass -i`)
- stack: Vite + React 19 + TS, MediaPipe HandLandmarker (2 hands, GPU),
  Web Audio (zero samples), WebGL glass renderer. No backend.
- live: https://gesturewatcher.vercel.app · repo: github.com/matthewyuart/gesturewatcher

## The pivots (commit-traceable)

| when | commit | what changed |
|---|---|---|
| Jul 30 | `GestureWatcher: gesture-controlled visual builder (Layout / Nodes / Jarvis)` | v0: three demo modes — layout builder, node graph, Jarvis HUD |
| Jul 31 15:33 | `Programma GW-1: pivot to gesture-conducted synthesizer` | all three modes deleted; it becomes an instrument |
| Jul 31 16:44 | `flat schematic edition: twist knobs, dual pitch sliders` | skeuomorphic → flat; two vertical pitch sliders |
| Jul 31 17:28 | `v3: light minimal UI, finger chords, chord-aware melody, 8-bit drums` | thumb-to-finger chord slots; drum machine |
| Jul 31 18:01 | `HTS 01: camera stage, micrographic UI, mouse support, city pop + bass` | camera becomes the stage; full mouse parity |
| Jul 31 18:24 | `no camera crop, hard drum stop, live tempo, stationary ruler, piano voicing` | five play-testing bugs in one pass |
| Jul 31 19:14 | `taste + perf pass: lowercase, finger piano, truthful notes` | pitch bend deleted; 3-finger piano |
| Jul 31 21:32 → 21:37 | `swap mediapipe handedness` → `revert handedness swap` | **shipped and reverted in 5 minutes** |
| Jul 31 21:49 | `melody ruler horizontal along the top` | pitch moves from Y to X |
| Aug 02 14:03 | `adaptive ink + pure-blur frost` | UI ink flips black/white by video luminance |
| Aug 02 14:53 | `stage rehash: black bezel, adaptive shade, staff card, tech scope` | ink-flip replaced by a shade layer |
| Aug 02 17:23 | `use liquid-glass-react for the glass` | adopted the off-the-shelf library |
| Aug 02 19:34 | `replace liquid-glass-react with single-element css glass` | library removed (~2h later) |
| Aug 02 20:57 | `webgl liquid glass: single-canvas port of liquid-glass-studio` | SVG filters replaced by a 4-pass WebGL renderer |
| Aug 02 21:54 | `glass lab: standalone camera liquid-glass preview board` | glass moved into its own sub-app to tune |
| Aug 02 23:07 | `adopt glass-lab handoff package` | tuned preset handed back into the main app |
| Aug 12 10:26 → 10:31 | `left-hand wrist angle sweeps the filter` → `arbitrate by claim type` | continuous filter control + conflict arbitration |

## Explorations that died, and the cause of death

1. **Three demo modes (Layout / Nodes / Jarvis)** — all three were "point at a
   button with your hand." Nothing rewarded practice. Deleted whole.
2. **Two vertical pitch sliders** — pitch on Y fought the chord cards below and
   required holding an unsupported arm position. Replaced by a horizontal
   ruler (left = low), which reads like a keyboard.
3. **Pitch bend on horizontal drift (±2 semitones)** — playing it, I couldn't
   tell whether I was out of tune or the app was. Deleted; rule adopted:
   the displayed note must equal the sounding note.
4. **Adaptive ink (flip all text black↔white by luminance, 800ms sampling,
   hysteresis 0.40/0.52)** — it worked and still felt wrong; the UI changed
   identity as the room changed. Replaced by one black shade layer over the
   video: darken the world once, keep the ink white forever.
5. **Auto-luminance shade** — replaced by a manual shade slider (Aug 2 18:17).
   Predictable beat clever.
6. **liquid-glass-react** — assumes Tailwind (its layers render as visible
   slabs and eat clicks without it); its glow layers self-measure to a
   phantom 228×67 and render as ghost rectangles. Removed.
7. **SVG displacement `backdrop-filter`** — too slow at full-stage size, and
   Lightning CSS minification stripped the spaces inside the filter list so
   Chrome silently dropped *every* backdrop-filter in production
   (commit `ship css unminified`). Replaced by WebGL.
8. **Handedness swap** — MediaPipe documents its labels as assuming a mirrored
   selfie image; our feed isn't mirrored, so I swapped them. Raised my hands:
   everything crossed. Reverted in 5 minutes.
9. **EMA smoothing on the wrist-tilt filter** — the gesture loop dedupes frames
   while a hand holds still, so a filter that needed successive frames to
   converge froze part-way. **Measured: a 60° tilt settled at 0.216 instead
   of 0.770.** Replaced with a pure function of the current angle.

## Constraints found (evidence)

- MediaPipe landmarks are normalised to the *camera frame*; the video renders
  letterboxed (`object-fit: contain`) inside an inset stage, so cursors drift
  unless mapped to the video's displayed content rect.
- `object-fit: cover` crop-zooms the feed — reads as "the app is zooming on my
  face." Native aspect is non-negotiable.
- Browsers block AudioContext until a user gesture → "live by default" needs a
  re-arm on first pointerdown/keydown.
- Web Audio throws on non-finite frequencies; a collapsed layout once produced
  NaN → engine throw → full React unmount (whole app blank).
- Hidden tabs throttle timers to ~1s and pause rAF → the drum scheduler needs a
  0.3s lookahead when visible, 1.5s when hidden.
- Wrist roll near ±180° (hand hanging at rest) flips sign — without a guard the
  filter slams between fully open and fully closed.

## Numbers

- tilt: ±11° deadzone (true neutral), rails at ±75°, rest-guard at 150°
- EMA failure: 0.216 vs 0.770 expected at 60°
- redundant audio writes after gating: 0 while holding an angle, 1 on a change
- final review: 24 agents, 20 findings, 19 refuted, 1 confirmed
- melody ruler: fixed 25-step chromatic ladder, never moves on chord change
- 4 chord slots (thumb + each finger), 7 drum genres, tempo 60–180
