# hts_01 case study — shot list

Ordered by narrative weight. Record 1–4 first; the case study works with just
those. Keep GIFs ≤8s and looping. Screen Studio or cap.so; record the browser
window only, camera feed visible.

Setup for every shot: good even lighting, plain-ish background, shade slider
around 0.55 so the glass reads, beat playing unless noted.

## Must-have (carries the argument)

- [ ] **1. Tilt sweeps the filter** — `[GIF]`, ~6s, *"The hardest control"* section.
      Left hand up, straight (arc shows neutral tick only), then rotate
      clockwise ~60° and back through neutral to counter-clockwise. The arc
      and the `filter NN` readout must be legible. **Audio matters here** —
      export as video with sound if the portfolio supports it, GIF as fallback.

- [ ] **2. Melody along the ruler** — `[GIF]`, ~8s, *"What it does now"*.
      Right hand plays a short phrase left→right; the ruler tick jumps note to
      note. Play something that resolves so it sounds intentional.

- [ ] **3. Chords on fingertips** — `[GIF]`, ~6s, *"What it does now"*.
      Left hand cycles thumb→index, middle, ring, pinky. Chord cards light in
      turn, staff card follows the hand. Go slowly enough to read the names.

- [ ] **4. Hero still** — `[IMG]`, top of page.
      Both hands up, one chord held, melody ruler lit, beat running. This is
      the thumbnail — shoot several and pick.

## Supporting (adds credibility)

- [ ] **5. v0 three-mode playground** — `[IMG]`, *"I started with three demos"*.
      Check out commit `6d80fac~41` (`GestureWatcher: gesture-controlled
      visual builder`), run it, screenshot the Layout/Nodes/Jarvis tabs.
      Worth the five minutes — the deleted version proves the pivot.

- [ ] **6. Ink-flip vs shade, side by side** — `[IMG]`, *Exploration 3*.
      Same bright room, two states. Recreate the ink-flip by forcing dark ink
      in devtools, or pull a screenshot from commit `adaptive ink + pure-blur
      frost`.

- [ ] **7. The glass lab** — `[IMG]`, *Exploration 5*.
      `npm run dev` in `glass-lab/`. Parameter panel right, camera-backed
      glass left. This is the artifact that shows process without a process
      diagram — do not skip it.

## Optional (only if the page has room)

- [ ] **8. Mouse parity** — `[GIF]`, ~5s. Dragging tempo + a knob, beat
      changing live.
- [ ] **9. Chord voicing editor** — `[GIF]`, ~5s. Toggling notes on the mini
      piano, chord name updating (e.g. build a Cmaj7 → add the 9th).

## Notes

- Nothing here requires faking. Every shot is a real state of the shipped app
  except #5 and #6, which are real states of earlier commits.
- If only one asset gets made: it's #1. The tilt control is the strongest
  design story in the project.
