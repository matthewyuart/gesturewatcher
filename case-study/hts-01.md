# hts_01 — a synthesizer you play with your hands

**Role** — Solo: interaction design, interface design, build (AI-assisted implementation)
**Timeline** — 14 days · Jul–Aug 2026
**Team** — Just me
**Skills** — Interaction design for novel input · interface design · rapid prototyping · play-testing

[IMG: hero — the live app over the camera feed, both hands up, one holding a chord, the melody ruler lit along the top]

---

## A webcam is a 21-point hand tracker that everyone already owns

Hand tracking stopped being exotic. MediaPipe runs 21 landmarks per hand, at
frame rate, in a browser tab, on hardware people already have. What hasn't
arrived is a reason to use it. Almost every hand-tracking demo is the same
artifact: you wave, a cursor moves, you poke a button, and you close the tab.

I wanted to find out what happens if you push past the demo — if you build
something with hand tracking that you'd actually want to get *better at*.
So I built an instrument: right hand plays melody, left hand plays chords,
an 8-bit drum machine keeps time. It runs entirely client-side and the
camera feed never leaves the machine.

**Live:** [gesturewatcher.vercel.app](https://gesturewatcher.vercel.app)

---

## Gesture interfaces are impressive for ten seconds and unplayable for eleven

Here's the thesis I kept running into: **a mouse has detents, friction, and
a surface — a hand in the air has none of them.** There's no click to tell
you a thing happened, no edge to stop against, no place to rest. Every
interaction that works on a desk falls apart when you lift it into the air.

That's the actual design problem. Not "how do I detect a pinch" — that's
solved. It's: *what do you do about a control surface with no surface?*

---

## I started with three demos and none of them were an instrument

The first version was a gesture playground with three modes: a layout
builder, a node-graph editor, and an Iron-Man-style HUD. It looked great in
a screenshot.

[IMG: v0 screenshot — the three-mode playground, Layout / Nodes / Jarvis tabs]

I played with it for a few minutes and deleted all three. Every one of them
was the same interaction wearing a different skin: *point your hand at a
button and pinch.* A mouse does that better. Nothing in any of the modes got
more interesting the second time you used it, and nothing rewarded practice.

That's the pivot the whole project hangs on. An instrument was the right
target precisely because instruments assume you'll be bad at first — which
means the design can ask something of the user instead of apologising for
the input.

---

## Six explorations died, and each one died of something specific

### Exploration 1: Two vertical pitch sliders
Each hand grabs a vertical slider; height sets pitch, so you get two voices.
**Killed** because pitch-on-Y fought everything else on screen — the chord
cards live at the bottom, so playing high notes meant holding an unsupported
arm up in front of your face. Replaced with a horizontal ruler along the top
(left = low, right = high), which your hand reads like a keyboard.

### Exploration 2: Pitch bend on horizontal drift
While a note sounded, sideways hand motion bent it up to ±2 semitones. Sounds
expressive on paper. **Killed the first time I played it seriously**: I
couldn't tell whether *I* was out of tune or the *app* was. The readout said
D♯5 and my ear said something else, and after that I didn't trust any of it.
I deleted bend entirely and adopted a rule: the note on screen must be exactly
the note you hear. **Trading expressiveness for truth** — an instrument that
can lie to you is worse than one that does less.

### Exploration 3: Adaptive ink
The UI floats over live video, so legibility changes with your room. I built a
sampler that read the video's brightness every 800ms and flipped the entire
interface between black and white text, with hysteresis so it wouldn't strobe.
It worked. **Killed anyway**, because the interface changed *identity* as you
moved — and the legibility problem didn't disappear, it just moved around the
screen. Replaced with one black shade layer over the video: darken the world
once, keep the ink white forever.

[IMG: side by side — ink-flip version vs shade version, same bright room]

### Exploration 4: Automatic shade
The shade started automatic too, driven by the same brightness sampling.
**Killed** for a manual slider. **Trading automation for predictability** — an
auto-adjusting backdrop meant the app looked different every session and I
could never learn where "my" setting was. A slider is boring and I stopped
thinking about it.

### Exploration 5: Three glass renderers
The panels are frosted glass over your own video. It turned out to be the single
largest cost in the project: **25 of 42 commits mention the glass.**

- **`liquid-glass-react`** (off-the-shelf) — killed: it assumes Tailwind, so
  without it the library's internal layers render as visible slabs *and*
  swallow clicks; its glow layers self-measure to a phantom 228×67 rectangle
  and paint ghost boxes over the UI.
- **SVG displacement `backdrop-filter`** — killed: too slow across a
  full-screen stage, and the CSS minifier silently stripped the spaces inside
  the filter list, so Chrome dropped *every* backdrop-filter in production
  while working perfectly in dev.
- **A 4-pass WebGL renderer** (refraction, dispersion, fresnel, glare) — kept.

To tune it I stopped working in the app entirely and built a separate
**glass lab**: a standalone board with the camera behind it, every parameter
on a slider, and presets saved to localStorage. **Trading a day of scope for
a tuning rig** — the app was the wrong place to evaluate a material, because
every change cost a rebuild and I could only see one setting at a time.

[IMG: the glass lab — parameter panel on the right, camera-backed glass shapes on the left]

### Exploration 6: Swapping the hands
MediaPipe's docs say its handedness labels assume a *mirrored* selfie image.
Our feed isn't mirrored — so I swapped the labels, shipped it, and felt clever.
Then I raised my hands and everything was crossed: melody on the left, chords
on the right. **Reverted five minutes later.** The docs were right about the
API and wrong about my setup.

---

## The hardest control to design was the one with no surface at all

The last feature is the one I'd show a designer first: **your left wrist angle
sweeps the filter.** Rotate your hand and the sound opens up.

The naive version is one line of math — angle maps to cutoff. It's also
unusable, and every problem with it is a problem *about* airborne controls:

**There is no "off."** Your hand is always at *some* angle, so the filter is
always being set by accident. Fix: straight up is a true neutral — an ~11°
deadzone where the filter sits exactly where the knob left it, and only past
that does the hand take over.

**The knob and the hand fight over one value.** If the hand owns the filter,
what does the filter *knob* do? Fix: the knob sets a base, the hand modulates
*around* it, and the mapping keeps full travel in both directions from
wherever the base sits. The knob always displays the base; your hand moves the
sound.

**One signal, two jobs.** Wrist roll also turns knobs (pinch a knob, twist).
So releasing a knob would fling the filter to wherever your wrist happened to
stop. Fix: after a knob twist, tilt re-arms only once your wrist passes back
through neutral. But I first applied that rule to *every* grab — including
chord cards, which are that hand's natural target, making the filter snap to
base and back on every chord. The rule that actually works: **whichever
interaction consumes the signal owns it.** A knob twist consumes roll; a chord
card doesn't, so the filter keeps sweeping straight through it.

**A hand at rest is a hand at 180°.** Let your arm hang and the wrist angle
sits exactly where the sign flips — a millimetre of wobble slammed the filter
between fully open and fully shut. Fix: past 150° is treated as neutral,
because that's a resting posture, not a playing one.

And one that only showed up because I measured it: I'd smoothed the tilt with
a rolling average, which is standard practice. But the gesture loop skips
frames when a hand holds still — so the average stopped converging mid-flight.
**A held 60° tilt settled at 0.216 instead of 0.770.** Smoothing had to move
out of the gesture layer and into the audio engine.

[GIF: hand tilts left and right, the arc on screen sweeping with it and the filter opening and closing audibly — 6s, loop]

---

## Four gestures carry the whole instrument

**Chords live on your fingertips.** Touch thumb to index, middle, ring, or
pinky for chord slots 1–4. A staff card floats next to your hand showing the
actual notes.
[GIF: left hand cycling all four fingers, chord cards lighting up, staff card following the hand — 6s]

**Melody is a keyboard drawn in the air.** Three fingers = three ways to play:
in-key notes, out-of-key notes, and a free slide. Hand position along the top
ruler picks the pitch.
[GIF: right hand playing a phrase along the ruler, tick highlighting each note — 8s]

**Everything is also a mouse.** Every control works with a pointer, which is
how the app is testable at all — and how anyone without a camera can still
play it.
[GIF: mouse dragging the tempo bar and a knob, beat changing live — 5s]

**Chord voicings are editable per note.** A two-octave keyboard in the sheet;
tap notes in and out and the chord names itself back to you.
[GIF: toggling notes on the mini piano, chord name updating — 5s]

---

## Three things I'd carry into any product

**In gesture UI, the body is the spec — not the docs.** MediaPipe's
documentation told me the hand labels were mirrored. It was correct about the
API and wrong about my setup, and no amount of re-reading would have caught
it. Five seconds of raising my hands did.

**A control that can lie is worse than a control that can't move.** Pitch bend
added a whole expressive axis and cost the one thing an instrument can't lose:
the user believing what it tells them. When the readout and the sound
disagreed, I stopped trusting the parts that *were* correct.

**Continuous input needs arbitration, not modes.** When one signal serves two
purposes, the instinct is to add a mode switch. The rule that actually worked
was ownership: whichever interaction *consumes* the signal owns it, and only
that one has to hand it back. No mode, no toggle, nothing for the user to
remember.
