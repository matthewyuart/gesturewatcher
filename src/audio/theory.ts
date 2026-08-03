export const NOTE_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export type QualityId =
  | 'maj' | 'min' | 'dom7' | 'maj7' | 'min7' | 'sus4' | 'dim' | 'add9';

export interface ChordQuality {
  id: QualityId;
  label: string;
  /** Chord tones in semitones above the root. */
  intervals: number[];
  /**
   * Scale that "sounds good" over this chord (root = chord root), per the
   * classic chord-scale pairings: maj→ionian, m7→dorian, 7→mixolydian,
   * min→aeolian, dim→locrian, sus4→mixolydian.
   */
  scaleSteps: number[];
  scaleName: string;
}

export const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
export const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];
const LOCRIAN = [0, 1, 3, 5, 6, 8, 10];

export const CHORD_QUALITIES: ChordQuality[] = [
  { id: 'maj', label: 'maj', intervals: [0, 4, 7], scaleSteps: IONIAN, scaleName: 'ionian' },
  { id: 'min', label: 'min', intervals: [0, 3, 7], scaleSteps: AEOLIAN, scaleName: 'aeolian' },
  { id: 'dom7', label: '7', intervals: [0, 4, 7, 10], scaleSteps: MIXOLYDIAN, scaleName: 'mixolydian' },
  { id: 'maj7', label: 'maj7', intervals: [0, 4, 7, 11], scaleSteps: IONIAN, scaleName: 'ionian' },
  { id: 'min7', label: 'min7', intervals: [0, 3, 7, 10], scaleSteps: DORIAN, scaleName: 'dorian' },
  { id: 'sus4', label: 'sus4', intervals: [0, 5, 7], scaleSteps: MIXOLYDIAN, scaleName: 'mixolydian' },
  { id: 'dim', label: 'dim', intervals: [0, 3, 6], scaleSteps: LOCRIAN, scaleName: 'locrian' },
  { id: 'add9', label: 'add9', intervals: [0, 4, 7, 14], scaleSteps: IONIAN, scaleName: 'ionian' },
];

export const CHROMATIC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

export function quality(id: QualityId): ChordQuality {
  return CHORD_QUALITIES.find((q) => q.id === id) ?? CHORD_QUALITIES[0];
}

export interface ChordSlot {
  root: number; // 0..11
  quality: QualityId;
  /** Exact MIDI notes the slot plays — fully user-editable voicing. */
  notes: number[];
}

const FLAT_NAMES = [
  'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B',
] as const;

/** Black-key pitch classes read as flats (Bb, Eb…), matching the staff. */
function pcName(pc: number): string {
  return [1, 3, 6, 8, 10].includes(pc) ? FLAT_NAMES[pc] : NOTE_NAMES[pc];
}

/**
 * Chord templates for recognition, matched as exact pitch-class sets above a
 * candidate root. Order = preference on ties (C6 over Am7/c, etc.).
 * Recognition approach after derrickward/ChordRecGen: try every present pitch
 * class as the root, score the exact template matches, prefer root-in-bass
 * readings, and name inversions as slash chords.
 */
const CHORD_TEMPLATES: Array<{ label: string; pcs: number[] }> = [
  { label: 'maj', pcs: [0, 4, 7] },
  { label: 'min', pcs: [0, 3, 7] },
  { label: '7', pcs: [0, 4, 7, 10] },
  { label: 'maj7', pcs: [0, 4, 7, 11] },
  { label: 'min7', pcs: [0, 3, 7, 10] },
  { label: 'sus4', pcs: [0, 5, 7] },
  { label: 'sus2', pcs: [0, 2, 7] },
  { label: 'dim', pcs: [0, 3, 6] },
  { label: 'aug', pcs: [0, 4, 8] },
  { label: '6', pcs: [0, 4, 7, 9] },
  { label: 'min6', pcs: [0, 3, 7, 9] },
  { label: 'add9', pcs: [0, 2, 4, 7] },
  { label: 'minadd9', pcs: [0, 2, 3, 7] },
  { label: 'dim7', pcs: [0, 3, 6, 9] },
  { label: 'min7b5', pcs: [0, 3, 6, 10] },
  { label: 'minmaj7', pcs: [0, 3, 7, 11] },
  { label: '7sus4', pcs: [0, 5, 7, 10] },
  { label: 'aug7', pcs: [0, 4, 8, 10] },
  { label: '9', pcs: [0, 2, 4, 7, 10] },
  { label: 'maj9', pcs: [0, 2, 4, 7, 11] },
  { label: 'min9', pcs: [0, 2, 3, 7, 10] },
  { label: '7b9', pcs: [0, 1, 4, 7, 10] },
  { label: '7#9', pcs: [0, 3, 4, 7, 10] },
  { label: '13b9', pcs: [0, 1, 4, 9, 10] },
  { label: '11', pcs: [0, 2, 4, 5, 7, 10] },
  { label: '13', pcs: [0, 2, 4, 7, 9, 10] },
  { label: '5', pcs: [0, 7] },
];

export interface RecognizedChord {
  root: number; // 0..11
  name: string;
}

/** Recognize a chord from the exact notes played (null if nothing matches). */
export function recognizeChord(notes: number[]): RecognizedChord | null {
  if (notes.length === 0) return null;
  const sorted = [...notes].sort((a, b) => a - b);
  const bass = ((sorted[0] % 12) + 12) % 12;
  const pcs = [...new Set(sorted.map((n) => ((n % 12) + 12) % 12))];
  if (pcs.length === 1) return { root: bass, name: pcName(bass) };

  let best: RecognizedChord | null = null;
  let bestScore = -1;
  for (const root of pcs) {
    const rel = new Set(pcs.map((p) => (((p - root) % 12) + 12) % 12));
    for (let t = 0; t < CHORD_TEMPLATES.length; t++) {
      const tpl = CHORD_TEMPLATES[t];
      if (tpl.pcs.length !== rel.size || !tpl.pcs.every((iv) => rel.has(iv))) continue;
      const score = (root === bass ? 100 : 0) + (CHORD_TEMPLATES.length - t);
      if (score > bestScore) {
        bestScore = score;
        const slash = root === bass ? '' : `/${pcName(bass)}`;
        best = { root, name: `${pcName(root)}${tpl.label}${slash}` };
      }
    }
  }
  return best;
}

export function chordName(slot: ChordSlot): string {
  // Name what the voicing actually plays; fall back to the stored
  // root+quality when the notes don't spell a known chord.
  return recognizeChord(slot.notes)?.name ?? `${pcName(slot.root)}${quality(slot.quality).label}`;
}

/** Default voicing for a root+quality, used until the user edits notes. */
export function buildChordNotes(
  root: number,
  qualityId: QualityId,
  baseOctave: number,
): number[] {
  const rootMidi = 12 * (baseOctave + 1) + root;
  return quality(qualityId).intervals.map((iv) => rootMidi + iv);
}

/** MIDI note for the nth degree of a step-pattern scale rooted at `root`. */
export function scaleDegreeToMidi(
  root: number,
  steps: number[],
  degree: number,
  baseOctave: number,
): number {
  const len = steps.length;
  const oct = Math.floor(degree / len);
  const idx = ((degree % len) + len) % len;
  return 12 * (baseOctave + 1) + root + steps[idx] + 12 * oct;
}
