# Programma GW-1 — gesture instrument

**Play synth and chords in the air; a drum machine keeps time.** Your webcam tracks both hands locally in the browser (MediaPipe — no video leaves your machine).

**Play it:** https://gesturewatcher.vercel.app

## How to play

| | |
| --- | --- |
| **Right hand** | pinch (thumb+index) anywhere in the open area = play melody · height picks the note · pull sideways = pitch bend |
| **Left hand** | thumb + **index / middle / ring / pinky** = chord slots 1–4, held while touched |
| **Knobs** | pinch, then twist your wrist |
| **Melody AUTO mode** | notes lock to the scale that fits the sounding chord (maj→ionian, min7→dorian, 7→mixolydian, dim→locrian…) |
| **FREE mode** | chromatic, no lock |

Press **POWER** first (browsers need a click to unlock audio). No camera → mouse fallback (click = pinch, chord cards are pinchable).

## The instrument

- **Chord slots** — four cards, any root × any quality (maj, min, 7, maj7, min7, sus4, dim, add9), editable in the CHORDS sheet
- **Beat** — 8-bit drum machine, synthesized live (square kick, noise snare/hats): **lofi · bossa nova · samba · hip hop · pop · house**, with tempo control and per-genre swing
- **Sound** — waveform + FILTER/RES/ATTACK/RELEASE/ECHO/VOLUME twist-knobs, melody octave
- **Cam** — the camera as a small viewfinder tile; tracking runs either way
- Oscilloscope reading the real output bus, bottom-left

## Stack

Vite + React 19 + TypeScript · `@mediapipe/tasks-vision` HandLandmarker (2 hands, GPU) · Web Audio (no samples) · One-Euro smoothing, per-finger touch hysteresis · zero backend.

## Develop

```bash
npm install
npm run dev
```

`predev`/`prebuild` copies MediaPipe's wasm into `public/mediapipe/wasm` (gitignored); the hand model loads from Google's model CDN at runtime.

---

Built autonomously by [Claude Code](https://claude.com/claude-code).
