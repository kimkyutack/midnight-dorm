import type { GameEventKind } from '../shared/types';

type SoundName = GameEventKind | 'button';

export class SynthAudio {
  private context: AudioContext | null = null;
  private muted = false;
  volume = 0.65;

  unlock(): void {
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') void this.context.resume();
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
  }

  setMuted(value: boolean): void {
    this.muted = value;
  }

  play(name: SoundName): void {
    if (this.muted || this.volume <= 0) return;
    this.unlock();
    const context = this.context;
    if (!context) return;
    const presets: Record<SoundName, [number, number, OscillatorType, number]> = {
      button: [520, 690, 'sine', .055], gold: [720, 1080, 'sine', .12], build: [180, 420, 'square', .14],
      upgrade: [380, 880, 'triangle', .18], 'turret-fire': [220, 110, 'square', .055], 'ghost-hit': [160, 90, 'sawtooth', .08],
      'door-hit': [92, 52, 'square', .13], 'player-hit': [190, 70, 'sawtooth', .1], death: [220, 45, 'triangle', .45],
      victory: [440, 990, 'triangle', .55], defeat: [180, 48, 'sawtooth', .65],
    };
    const [from, to, type, duration] = presets[name];
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), context.currentTime + duration);
    gain.gain.setValueAtTime(this.volume * .15, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }
}
