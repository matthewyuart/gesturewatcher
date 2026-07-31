export const NOTE_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

export type ScaleId = 'major' | 'minor' | 'dorian' | 'lydian' | 'mixo' | 'penta';

export const SCALES: Record<ScaleId, { label: string; steps: number[] }> = {
  major: { label: 'MAJOR', steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: 'MINOR', steps: [0, 2, 3, 5, 7, 8, 10] },
  dorian: { label: 'DORIAN', steps: [0, 2, 3, 5, 7, 9, 10] },
  lydian: { label: 'LYDIAN', steps: [0, 2, 4, 6, 7, 9, 11] },
  mixo: { label: 'MIXO', steps: [0, 2, 4, 5, 7, 9, 10] },
  penta: { label: 'PENTA', steps: [0, 3, 5, 7, 10] },
};

export interface Extensions {
  sixth: boolean;
  seventh: boolean;
  ninth: boolean;
  sus4: boolean;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * MIDI note for the nth degree of a key's scale (degree may exceed one
 * octave). keyIndex 0..11 (C..B), baseOctave in scientific pitch notation.
 */
export function degreeToMidi(
  keyIndex: number,
  scale: ScaleId,
  degree: number,
  baseOctave: number,
): number {
  const steps = SCALES[scale].steps;
  const len = steps.length;
  const oct = Math.floor(degree / len);
  const idx = ((degree % len) + len) % len;
  return 12 * (baseOctave + 1) + keyIndex + steps[idx] + 12 * oct;
}

export function midiName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/**
 * Diatonic chord on the key's root: scale degrees 0-2-4, sus4 swaps the
 * third for the fourth, extensions stack more diatonic degrees on top.
 */
export function chordMidis(
  keyIndex: number,
  scale: ScaleId,
  ext: Extensions,
  baseOctave: number,
): number[] {
  const degrees = [0, ext.sus4 ? 3 : 2, 4];
  if (ext.sixth) degrees.push(5);
  if (ext.seventh) degrees.push(6);
  if (ext.ninth) degrees.push(8);
  return degrees.map((d) => degreeToMidi(keyIndex, scale, d, baseOctave));
}
