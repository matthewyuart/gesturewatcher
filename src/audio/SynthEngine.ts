export type WaveKind = 'sawtooth' | 'square' | 'triangle' | 'sine';

export interface SynthParams {
  cutoff: number;   // 0..1 -> 80..9000 Hz (log)
  resonance: number; // 0..1 -> Q 0.5..16
  attack: number;   // 0..1 -> 3ms..600ms
  release: number;  // 0..1 -> 60ms..2.5s
  echo: number;     // 0..1 wet mix
  volume: number;   // 0..1 master
}

export interface SynthDebugState {
  running: boolean;
  gates: boolean[];
  freqs: number[];
  chordGate: boolean;
  chordSize: number;
  rms: number;
  params: SynthParams;
  wave: WaveKind;
}

const CUTOFF_MIN = 80;
const CUTOFF_MAX = 9000;

function cutoffHz(norm: number): number {
  return CUTOFF_MIN * Math.pow(CUTOFF_MAX / CUTOFF_MIN, Math.min(1, Math.max(0, norm)));
}

interface ChordVoice {
  osc: OscillatorNode;
  gain: GainNode;
}

interface LeadVoice {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  gain: GainNode;
  gate: boolean;
  freq: number;
}

export const LEAD_VOICES = 2;

/**
 * Two independent lead voices (each two detuned oscillators, always running,
 * gated by an envelope gain) + a polyphonic chord pad, through a shared
 * lowpass filter and a feedback delay, into master -> analyser -> destination.
 */
export class SynthEngine {
  private ctx: AudioContext | null = null;
  private filter!: BiquadFilterNode;
  private master!: GainNode;
  private analyser!: AnalyserNode;
  private delayWet!: GainNode;

  private leads: LeadVoice[] = [];

  private chordVoices: ChordVoice[] = [];

  private waveKind: WaveKind = 'sawtooth';
  private chordOnFlag = false;
  private scopeBuf: Float32Array | null = null;

  params: SynthParams = {
    cutoff: 0.72,
    resonance: 0.25,
    attack: 0.12,
    release: 0.35,
    echo: 0.25,
    volume: 0.75,
  };

  get isRunning(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture (click/keydown) the first time. */
  async start(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.ratio.value = 12;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';

    // Feedback delay in parallel with the dry path.
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.32;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    this.delayWet = ctx.createGain();
    delay.connect(feedback).connect(delay);
    this.filter.connect(delay);
    delay.connect(this.delayWet).connect(this.master);
    this.filter.connect(this.master);

    this.master.connect(limiter).connect(this.analyser).connect(ctx.destination);

    // Lead voices — oscillators run forever, envelope gates each gain.
    this.leads = Array.from({ length: LEAD_VOICES }, (_, i) => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc2.detune.value = i === 0 ? 9 : -9;
      const freq = 220 * (i + 1);
      osc1.frequency.value = freq;
      osc2.frequency.value = freq;
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.filter);
      osc1.start();
      osc2.start();
      return { osc1, osc2, gain, gate: false, freq };
    });
    this.setWave(this.waveKind);

    this.scopeBuf = new Float32Array(this.analyser.fftSize);
    this.applyParams();
    if (ctx.state !== 'running') await ctx.resume();
  }

  setWave(wave: WaveKind): void {
    this.waveKind = wave;
    if (!this.ctx) return;
    for (const v of this.leads) {
      v.osc1.type = wave;
      v.osc2.type = wave;
    }
  }

  getWave(): WaveKind {
    return this.waveKind;
  }

  setParam<K extends keyof SynthParams>(key: K, value: number): void {
    this.params[key] = Math.min(1, Math.max(0, value));
    this.applyParams();
  }

  private applyParams(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(cutoffHz(this.params.cutoff), t, 0.03);
    this.filter.Q.setTargetAtTime(0.5 + this.params.resonance * 15.5, t, 0.03);
    this.delayWet.gain.setTargetAtTime(this.params.echo * 0.55, t, 0.05);
    this.master.gain.setTargetAtTime(this.params.volume * 0.9, t, 0.05);
  }

  /** Live filter sweep (left hand height) without touching the knob value. */
  sweepCutoff(norm: number): void {
    this.params.cutoff = Math.min(1, Math.max(0, norm));
    if (!this.ctx) return;
    this.filter.frequency.setTargetAtTime(
      cutoffHz(this.params.cutoff),
      this.ctx.currentTime,
      0.05,
    );
  }

  private attackSec(): number {
    return 0.003 + this.params.attack * 0.6;
  }

  private releaseSec(): number {
    return 0.06 + this.params.release * 2.4;
  }

  noteOn(voice: number, freq: number): void {
    if (!this.ctx || !Number.isFinite(freq) || freq <= 0) return;
    const v = this.leads[voice];
    if (!v) return;
    v.gate = true;
    v.freq = freq;
    const t = this.ctx.currentTime;
    v.osc1.frequency.setTargetAtTime(freq, t, 0.01);
    v.osc2.frequency.setTargetAtTime(freq, t, 0.01);
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(0.26, t, this.attackSec() / 3);
  }

  /** Glide the sounding pitch (quantized target or bend) while gated. */
  setFreq(voice: number, freq: number, glide = 0.05): void {
    if (!this.ctx || !Number.isFinite(freq) || freq <= 0) return;
    const v = this.leads[voice];
    if (!v) return;
    v.freq = freq;
    const t = this.ctx.currentTime;
    v.osc1.frequency.setTargetAtTime(freq, t, glide);
    v.osc2.frequency.setTargetAtTime(freq, t, glide);
  }

  noteOff(voice: number): void {
    if (!this.ctx) return;
    const v = this.leads[voice];
    if (!v) return;
    v.gate = false;
    const t = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(0, t, this.releaseSec() / 3);
  }

  chordOn(freqs: number[]): void {
    if (!this.ctx) return;
    freqs = freqs.filter((f) => Number.isFinite(f) && f > 0);
    if (freqs.length === 0) return;
    this.chordOff();
    this.chordOnFlag = true;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.chordVoices = freqs.map((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'sawtooth' : 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = (i % 2 === 0 ? 1 : -1) * 4;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(0.14, t, this.attackSec() / 2);
      osc.connect(gain).connect(this.filter);
      osc.start();
      return { osc, gain };
    });
  }

  chordOff(): void {
    if (!this.ctx) return;
    this.chordOnFlag = false;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const rel = this.releaseSec();
    for (const v of this.chordVoices) {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0, t, rel / 3);
      v.osc.stop(t + rel + 0.5);
    }
    this.chordVoices = [];
  }

  /** Post-filter bus for the drum machine (present after start()). */
  getDrumBus(): { ctx: AudioContext; dest: AudioNode } | null {
    if (!this.ctx) return null;
    return { ctx: this.ctx, dest: this.master };
  }

  /** Copy the current waveform into `out`; returns false before start(). */
  readWaveform(out: Float32Array): boolean {
    if (!this.ctx || !this.scopeBuf) return false;
    this.analyser.getFloatTimeDomainData(out as Float32Array<ArrayBuffer>);
    return true;
  }

  getDebugState(): SynthDebugState {
    let rms = 0;
    if (this.ctx && this.scopeBuf) {
      this.analyser.getFloatTimeDomainData(this.scopeBuf as Float32Array<ArrayBuffer>);
      let sum = 0;
      for (let i = 0; i < this.scopeBuf.length; i++) sum += this.scopeBuf[i] ** 2;
      rms = Math.sqrt(sum / this.scopeBuf.length);
    }
    return {
      running: this.isRunning,
      gates: this.leads.map((v) => v.gate),
      freqs: this.leads.map((v) => v.freq),
      chordGate: this.chordOnFlag,
      chordSize: this.chordVoices.length,
      rms,
      params: { ...this.params },
      wave: this.waveKind,
    };
  }
}
