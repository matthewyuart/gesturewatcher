# 🖐️ GestureWatcher

**Build things visually with your hands.** GestureWatcher turns your webcam into an input device: it tracks your hands in real time (MediaPipe Hand Landmarker, fully in-browser — no video ever leaves your machine) and turns pinches, points, and palms into a cursor you can build with.

## Modes

| Mode | What it does |
| --- | --- |
| **Layout** | Air-drag wireframe UI blocks (navbar, hero, cards…) from a shelf onto a canvas to sketch a page layout |
| **Nodes** | A flow/system-diagram editor — pinch-drag nodes, pinch a port and release on another node to wire them up |
| **Jarvis** | An Iron-Man style HUD — hover to target, pinch to press toggles and mission buttons, drag the radar around |

## Controls

- **Move** — raise a hand; a ring cursor follows your thumb + index fingertips (up to two hands)
- **Pinch** (thumb + index together) — grab / click / drag
- **Release** — drop
- **No camera?** It falls back to mouse simulation (click = pinch), also available via `?mouse=1`

## Stack

- [Vite](https://vite.dev) + React 19 + TypeScript
- [@mediapipe/tasks-vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) `HandLandmarker` (GPU delegate, 2 hands, video mode)
- One-Euro filtering for smooth low-latency cursors, hysteresis on pinch detection
- Zero backend — everything runs client-side

## Develop

```bash
npm install
npm run dev
```

The `predev`/`prebuild` script copies MediaPipe's wasm bundle from `node_modules` into `public/mediapipe/wasm` (gitignored); the hand-landmark model is fetched at runtime from Google's model CDN.

## Privacy

Camera frames are processed locally by wasm in your browser. Nothing is uploaded, recorded, or stored.

---

Built autonomously by [Claude Code](https://claude.com/claude-code) — gesture engine + three parallel subagents, one per mode.
