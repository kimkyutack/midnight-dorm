import type { GameEventKind } from '../shared/types';

type SoundName = GameEventKind | 'button';
export type BackgroundTrack = 'main' | 'ingame';

export class SynthAudio {
  private context: AudioContext | null = null;
  private muted = false;
  private readonly background: Partial<Record<BackgroundTrack, HTMLAudioElement>>;
  private activeBackground: BackgroundTrack | null = null;
  private backgroundUnlockArmed = false;
  private musicMuted = false;
  volume = 0.65;
  musicVolume = 0.42;

  constructor() {
    if (typeof Audio === 'undefined') {
      this.background = {};
      return;
    }
    this.background = {
      main: this.createBackground('/audio/main.mp3'),
      ingame: this.createBackground('/audio/ingame.mp3'),
    };
  }

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

  setMusicVolume(value: number): void {
    this.musicVolume = Math.max(0, Math.min(1, value));
    Object.values(this.background).forEach((track) => {
      if (track) track.volume = this.musicVolume;
    });
  }

  setMusicMuted(value: boolean): void {
    this.musicMuted = value;
    if (value) {
      Object.values(this.background).forEach((track) => track?.pause());
      return;
    }
    if (this.activeBackground) void this.playBackground(this.activeBackground);
  }

  setBackgroundTrack(track: BackgroundTrack | null): void {
    if (this.activeBackground === track) {
      if (track && !this.musicMuted) void this.playBackground(track);
      return;
    }

    const previous = this.activeBackground
      ? this.background[this.activeBackground]
      : undefined;
    previous?.pause();
    this.activeBackground = track;

    if (!track || this.musicMuted) return;
    const next = this.background[track];
    if (next) next.currentTime = 0;
    void this.playBackground(track);
  }

  play(name: SoundName): void {
    if (this.muted || this.volume <= 0) return;
    this.unlock();
    const context = this.context;
    if (!context) return;
    const presets: Record<SoundName, [number, number, OscillatorType, number]> = {
      button: [520, 690, 'sine', .055], gold: [720, 1080, 'sine', .12], power: [540, 920, 'triangle', .1], build: [180, 420, 'square', .14],
      'building-remove': [330, 85, 'square', .18],
      upgrade: [380, 880, 'triangle', .18], 'turret-fire': [220, 110, 'square', .055], 'ghost-hit': [160, 90, 'sawtooth', .08],
      'door-hit': [92, 52, 'square', .13], 'player-hit': [190, 70, 'sawtooth', .1], death: [220, 45, 'triangle', .45],
      'ghost-level-up': [120, 440, 'sawtooth', .35], 'ghost-retreat': [180, 70, 'triangle', .32],
      'ghost-return': [75, 240, 'sawtooth', .4], 'ghost-skill': [340, 45, 'square', .42], 'ghost-net': [920, 170, 'triangle', .22], 'item-draw': [360, 1260, 'sine', .5],
      'consumable-use': [640, 1160, 'sine', .18],
      'elite-join': [260, 1380, 'triangle', .65],
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

  private createBackground(source: string): HTMLAudioElement {
    const track = new Audio(source);
    track.loop = true;
    track.preload = 'auto';
    track.volume = this.musicVolume;
    return track;
  }

  private async playBackground(trackName: BackgroundTrack): Promise<void> {
    if (this.musicMuted || this.activeBackground !== trackName) return;
    const track = this.background[trackName];
    if (!track) return;
    track.volume = this.musicVolume;
    try {
      await track.play();
    } catch {
      this.armBackgroundUnlock();
    }
  }

  private armBackgroundUnlock(): void {
    if (this.backgroundUnlockArmed || typeof document === 'undefined') return;
    this.backgroundUnlockArmed = true;
    const resume = (): void => {
      document.removeEventListener('pointerdown', resume, true);
      document.removeEventListener('keydown', resume, true);
      this.backgroundUnlockArmed = false;
      if (this.activeBackground && !this.musicMuted) {
        void this.playBackground(this.activeBackground);
      }
    };
    document.addEventListener('pointerdown', resume, { once: true, capture: true });
    document.addEventListener('keydown', resume, { once: true, capture: true });
  }
}
