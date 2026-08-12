# HTS 01 — hand tracked synth

**Melody with your right hand, chords with your left, 8-bit beats with a synth bass underneath.** Your webcam tracks both hands locally in the browser (MediaPipe — the feed never leaves your machine). The video sits in a rounded black-bezel stage under an adaptive shade (brighter room → more shade, so the white ink always reads), with lightweight liquid-glass panels floating over it.

**Play it:** https://gesturewatcher.vercel.app

## How to play

| | |
| --- | --- |
| **Right hand** | finger piano along the top ruler: thumb+index = white keys · thumb+middle = black keys · thumb+ring = slide · left = low, right = high |
| **Left hand** | thumb + **index / middle / ring / pinky** = chord slots 1–4, held while touched — a floating staff card follows your hand showing the notes |
| **Left hand angle** | tilt your wrist to sweep the filter — straight up is neutral, clockwise opens, counter-clockwise closes |
| **Mouse** | everything also works with a mouse — click buttons, hold chord cards, drag knobs vertically, drag the tempo bar |
| **FREE mode** (default) | chromatic slide |
| **AUTO mode** | slide locks to the scale that fits the sounding chord (maj7→ionian, min7→dorian, 7→mixolydian, dim→locrian) |

Press **POWER** first (browsers need a click to unlock audio). No camera → mouse fallback (click = pinch).

## Defaults

- **Beat:** CITY POP, 102 bpm — with a square-wave synth bass that follows the root of whatever chord you're holding
- **Chords:** the royal road progression — Fmaj7 · G7 · Em7 · Am7 (IVmaj7–V7–iii7–vi7)

## The instrument

- **BEAT** — 8-bit drum machine (square kick, noise snare/hats, synth bass), all synthesized live: city pop · lofi · bossa nova · samba · hip hop · pop · house, draggable tempo 60–180
- **CHORDS** — progression presets (city pop, pop I–V–vi–IV, 50s doo-wop, jazz ii–V–I, Andalusian, blues) plus per-slot root × quality editing (maj, min, 7, maj7, min7, sus4, dim, add9)
- **TONE** — waveform + filter/res/attack/release/echo/volume knobs (pinch + wrist-twist, or mouse drag), melody octave, tracking source
- Chord voicings are fully editable per-slot on a 2-octave piano keyboard
- Bench-style oscilloscope on the live output bus: triggered phosphor trace, frequency and vpp readouts

## Stack

Vite + React 19 + TypeScript · `@mediapipe/tasks-vision` HandLandmarker (2 hands, GPU) · Web Audio, zero samples · One-Euro smoothing, per-finger touch hysteresis · no backend.

## Develop

```bash
npm install
npm run dev
```

`predev`/`prebuild` copies MediaPipe's wasm into `public/mediapipe/wasm` (gitignored); the hand model loads from Google's model CDN at runtime.

---

Built autonomously by [Claude Code](https://claude.com/claude-code).
