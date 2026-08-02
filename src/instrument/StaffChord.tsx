import './StaffChord.css';

// --- staff geometry ---------------------------------------------------------
// viewBox is 170 x 96. Five staff lines, gap 9px, bottom line (E4) at y=46.
const GAP = 9;
const HALF = GAP / 2; // one diatonic step = half a line gap
const BOTTOM_Y = 46; // y of the bottom staff line (E4)
const E4_STEP = 30; // diatonic step index of E4 (C=0..B=6, +7 per octave)
const STAFF_LEFT = 4;
const STAFF_RIGHT = 166;
const NOTE_X = 100; // base x of the chord's notehead column

// pitch class -> diatonic letter index.
// Sharp spelling: C# sits on the C line with ♯; flat spelling: the same
// pitch sits on the D line with ♭ (Db). Chosen per chord by `preferFlats`.
const SHARP_DIATONIC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const FLAT_DIATONIC = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6];
const IS_BLACK = [
  false, true, false, true, false, false,
  true, false, true, false, true, false,
];

function midiToStep(midi: number, preferFlats: boolean): number {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return octave * 7 + (preferFlats ? FLAT_DIATONIC : SHARP_DIATONIC)[pc];
}

function stepToY(step: number): number {
  return BOTTOM_Y - (step - E4_STEP) * HALF;
}

type NoteGlyph = {
  midi: number;
  step: number;
  x: number;
  y: number;
  accidental: string | null;
  sharpX: number;
};

type LedgerLine = { y: number; x1: number; x2: number };

function layoutNotes(midis: number[], preferFlats: boolean): { notes: NoteGlyph[]; ledgers: LedgerLine[] } {
  const sorted = [...new Set(midis)].sort((a, b) => a - b);

  const notes: NoteGlyph[] = [];
  let prevStep = Number.NEGATIVE_INFINITY;
  let prevOffset: boolean = false;
  let prevSharpStep = Number.NEGATIVE_INFINITY;
  let prevSharpCol = 0;

  for (const midi of sorted) {
    const pc = ((midi % 12) + 12) % 12;
    const step = midiToStep(midi, preferFlats);

    // seconds (or same staff position): kick the upper note right
    const offset: boolean = step - prevStep <= 1 && !prevOffset;
    const x = offset ? NOTE_X + 9 : NOTE_X;

    // stagger accidentals into two columns when vertically crowded
    const accidental = IS_BLACK[pc] ? (preferFlats ? '\u266d' : '\u266f') : null;
    let sharpCol = 0;
    if (accidental) {
      sharpCol = step - prevSharpStep < 4 ? (prevSharpCol + 1) % 2 : 0;
      prevSharpStep = step;
      prevSharpCol = sharpCol;
    }
    const sharpX = NOTE_X - 13 - sharpCol * 8;

    notes.push({ midi, step, x, y: stepToY(step), accidental, sharpX });
    prevStep = step;
    prevOffset = offset;
  }

  // ledger lines: even steps at/below middle C (28) or at/above A5 (40)
  const extents = new Map<number, { min: number; max: number }>();
  const addLedger = (s: number, x: number) => {
    const e = extents.get(s);
    if (e) {
      e.min = Math.min(e.min, x);
      e.max = Math.max(e.max, x);
    } else {
      extents.set(s, { min: x, max: x });
    }
  };
  for (const n of notes) {
    if (n.step <= 28) {
      for (let s = 28; s >= n.step; s -= 2) addLedger(s, n.x);
    } else if (n.step >= 40) {
      for (let s = 40; s <= n.step; s += 2) addLedger(s, n.x);
    }
  }
  const ledgers: LedgerLine[] = [...extents.entries()].map(([s, e]) => ({
    y: stepToY(s),
    x1: e.min - 8,
    x2: e.max + 8,
  }));

  return { notes, ledgers };
}

export function StaffChord({ midis, label, preferFlats = false }: { midis: number[]; label: string; preferFlats?: boolean }) {
  const { notes, ledgers } = layoutNotes(midis, preferFlats);

  return (
    <div className="gw-staff-card" data-testid="staff-card">
      <svg
        className="gw-staff-svg"
        viewBox="0 0 170 96"
        xmlns="http://www.w3.org/2000/svg"
        aria-label={`chord ${label}`}
        role="img"
      >
        {/* five staff lines, top (F5) at y=10 down to bottom (E4) at y=46 */}
        {[0, 1, 2, 3, 4].map((i) => {
          const y = BOTTOM_Y - i * GAP;
          return (
            <line
              key={i}
              x1={STAFF_LEFT}
              y1={y}
              x2={STAFF_RIGHT}
              y2={y}
              stroke="currentColor"
              strokeWidth={0.8}
              opacity={0.55}
            />
          );
        })}

        {/* treble clef, curl wrapping the G4 line (y=37) */}
        <text
          x={1}
          y={50}
          fontSize={58}
          fill="currentColor"
          opacity={0.9}
        >
          {'\u{1D11E}'}
        </text>

        {/* ledger lines */}
        {ledgers.map((l, i) => (
          <line
            key={i}
            x1={l.x1}
            y1={l.y}
            x2={l.x2}
            y2={l.y}
            stroke="currentColor"
            strokeWidth={0.9}
            opacity={0.7}
          />
        ))}

        {/* noteheads + accidentals */}
        {notes.map((n) => (
          <g key={n.midi}>
            {n.accidental && (
              <text
                x={n.sharpX}
                y={n.y}
                fontSize={11}
                fill="currentColor"
                textAnchor="middle"
                dominantBaseline="central"
              >
                {n.accidental}
              </text>
            )}
            <ellipse
              cx={n.x}
              cy={n.y}
              rx={5}
              ry={3.6}
              fill="currentColor"
              transform={`rotate(-18 ${n.x} ${n.y})`}
            />
          </g>
        ))}
      </svg>
      <div className="gw-staff-label">{label}</div>
    </div>
  );
}
