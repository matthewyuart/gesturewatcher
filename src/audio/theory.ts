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

const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
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

export function chordName(slot: ChordSlot): string {
  // Black-key roots read as flats (Bb, Eb…), matching the staff spelling.
  const name = [1, 3, 6, 8, 10].includes(slot.root)
    ? FLAT_NAMES[slot.root]
    : NOTE_NAMES[slot.root];
  return `${name}${quality(slot.quality).label}`;
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
