# 🎛️ Programma GW-1 — gesture synthesizer

**A synthesizer you conduct with your hands.** Your webcam becomes the controller: MediaPipe tracks both hands in-browser (no video ever leaves your machine) and a liquid-glass instrument panel floats over your live feed.

**Play it:** https://gesturewatcher.vercel.app

## How to play

| Gesture | Effect |
| --- | --- |
| **Right hand height** | picks the note — quantized to your key + scale across 2 octaves (pitch ladder on screen) |
| **Right hand pinch** | note on; slide up/down to glide between scale degrees |
| **Drift sideways while pinched** | pitch bend (±2 semitones, 1 st per 150 px) |
| **Left hand height** | live filter sweep — no pinch needed |
| **Left hand pinch** | sustained chord pad — diatonic triad + your enabled extensions |
| **Pinch a knob + drag up/down** | turn it |
| **Pinch buttons** | select key / scale / octave / waveform, toggle 6th·7th·9th·sus4 |

Press **POWER** first (browsers require a click to unlock audio). No camera? It falls back to mouse mode (click = pinch), or force it with `?mouse=1`.

## The instrument

- **SYNTH panel** — waveform selector (saw/square/tri/sine), FILTER · RES · ATTACK · RELEASE · ECHO · VOLUME knobs (hardware-style, black caps, white indicator lines)
- **KEY panel** — 12-key selector, MAJOR/MINOR/DORIAN/PENTA scales, octave, chord-extension LED toggles
- **Oscilloscope** — live waveform from the analyser in the top strip, plus current-note readout
- **Audio graph** — dual detuned oscillators (mono lead, envelope-gated) + polyphonic chord voices → shared lowpass → feedback delay → limiter → out

Aesthetic borrowed from DIY hardware synths ([Critter & Guitari-style boards](https://github.com/Atarity/diy-synths), Programma 900): cream frosted-glass panels, ink silkscreen labels, math doodles, LED dots — rendered as translucent liquid glass over your camera.

## Stack

Vite + React 19 + TypeScript · `@mediapipe/tasks-vision` HandLandmarker (2 hands, GPU, video mode) · Web Audio API · One-Euro filtered cursors, pinch hysteresis · zero backend.

## Develop

```bash
npm install
npm run dev
```

`predev`/`prebuild` copies MediaPipe's wasm from `node_modules` into `public/mediapipe/wasm` (gitignored); the hand model loads at runtime from Google's model CDN.

## Privacy

Camera frames are processed locally by wasm in your browser. Nothing is uploaded, recorded, or stored.

---

Built autonomously by [Claude Code](https://claude.com/claude-code).
