export type GenreId = 'citypop' | 'lofi' | 'bossa' | 'samba' | 'hiphop' | 'pop' | 'house';

interface Pattern {
  label: string;
  bpm: number;
  /** 0..1 fraction of a 16th step to delay odd 16ths. */
  swing: number;
  kick: number[];
  snare: number[];
  hat: number[];
  openHat: number[];
  /** Synth-bass steps — plays the root of the current chord. */
  bass: number[];
}

export const GENRES: Record<GenreId, Pattern> = {
  citypop: {
    label: 'CITY POP', bpm: 102, swing: 0,
    kick: [0, 4, 8, 12], snare: [4, 12],
    hat: [0, 2, 4, 6, 8, 10, 12, 14], openHat: [10],
    bass: [0, 3, 4, 7, 8, 11, 12, 14],
  },
  lofi: {
    label: 'LOFI', bpm: 74, swing: 0.16,
    kick: [0, 7, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], openHat: [],
    bass: [0, 7, 8],
  },
  bossa: {
    label: 'BOSSA NOVA', bpm: 120, swing: 0,
    kick: [0, 3, 8, 11], snare: [0, 3, 6, 10, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], openHat: [],
    bass: [0, 3, 8, 11],
  },
  samba: {
    label: 'SAMBA', bpm: 104, swing: 0,
    kick: [0, 4, 6, 8, 12, 14], snare: [2, 5, 10, 13],
    hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], openHat: [],
    bass: [0, 4, 8, 12],
  },
  hiphop: {
    label: 'HIP HOP', bpm: 92, swing: 0.12,
    kick: [0, 3, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], openHat: [],
    bass: [0, 3, 10, 11],
  },
  pop: {
    label: 'POP', bpm: 118, swing: 0,
    kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], openHat: [14],
    bass: [0, 2, 4, 6, 8, 10, 12, 14],
  },
  house: {
    label: 'HOUSE', bpm: 124, swing: 0,
    kick: [0, 4, 8, 12], snare: [4, 12], hat: [], openHat: [2, 6, 10, 14],
    bass: [2, 6, 10, 14],
  },
};

/**
 * 8-bit style drum machine: square-wave kick with a pitch drop, noise snare
 * and hats, plus a square synth bass that follows the current chord root.
 * Scheduled ahead of the AudioContext clock so throttled timers can't
 * starve it.
 */
export class DrumMachine {
  private ctx: AudioContext;
  private out: GainNode;
  private noiseBuf: AudioBuffer;

  private timer = 0;
  private nextStepTime = 0;
  private step = 0;
  private playing = false;
  private genreId: GenreId = 'citypop';
  /** MIDI note the bass plays (root of the sounding chord). */
  private bassMidi = 41; // F2
  bpm = GENRES.citypop.bpm;

  constructor(ctx: AudioContext, dest: AudioNode) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.5;
    this.out.connect(dest);

    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get genre(): GenreId {
    return this.genreId;
  }

  setGenre(id: GenreId): void {
    this.genreId = id;
    this.bpm = GENRES[id].bpm;
  }

  setBpm(bpm: number): void {
    this.bpm = Math.min(180, Math.max(60, Math.round(bpm)));
  }

  /** Chord root (0..11) the bass should follow. */
  setBassRoot(root: number): void {
    this.bassMidi = 36 + ((root % 12) + 12) % 12; // octave 2
  }

  start(): void {
    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextStepTime = this.ctx.currentTime + 0.06;
    // Big lookahead so background-tab timer throttling (~1s) can't starve it.
    this.timer = window.setInterval(() => this.schedule(), 250);
    this.schedule();
  }

  stop(): void {
    this.playing = false;
    window.clearInterval(this.timer);
  }

  private schedule(): void {
    const horizon = this.ctx.currentTime + 1.4;
    const p = GENRES[this.genreId];
    while (this.nextStepTime < horizon) {
      const stepDur = 60 / this.bpm / 4;
      const swingDelay = this.step % 2 === 1 ? p.swing * stepDur : 0;
      const t = this.nextStepTime + swingDelay;
      if (p.kick.includes(this.step)) this.kick(t);
      if (p.snare.includes(this.step)) this.snare(t);
      if (p.hat.includes(this.step)) this.hat(t, false);
      if (p.openHat.includes(this.step)) this.hat(t, true);
      if (p.bass.includes(this.step)) this.bass(t, stepDur);
      this.step = (this.step + 1) % 16;
      this.nextStepTime += stepDur;
    }
  }

  private kick(t: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  private snare(t: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.9;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(bp).connect(g).connect(this.out);
    src.start(t, Math.random(), 0.2);

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.08);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.12, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(og).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  private hat(t: number, open: boolean): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7200;
    const g = this.ctx.createGain();
    const dur = open ? 0.24 : 0.045;
    g.gain.setValueAtTime(open ? 0.2 : 0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(hp).connect(g).connect(this.out);
    src.start(t, Math.random(), dur + 0.05);
  }

  private bass(t: number, stepDur: number): void {
    const freq = 440 * Math.pow(2, (this.bassMidi - 69) / 12);
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 480;
    const g = this.ctx.createGain();
    const dur = Math.max(0.1, stepDur * 0.9);
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(lp).connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}
