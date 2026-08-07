import type { GameEventKind } from '../shared/types';

type SoundName = GameEventKind | 'button';
export type BackgroundTrack = 'main' | 'ingame';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const ghostFootstepGain = (level: number, masterVolume: number): number =>
  clamp01(masterVolume) * (.08 + clamp01(level) * .42);

export const ghostFootstepIntervalMs = (level: number): number =>
  Math.round(690 - clamp01(level) * 280);

export class SynthAudio {
  private context: AudioContext | null = null;
  private muted = false;
  private readonly background: Partial<Record<BackgroundTrack, HTMLAudioElement>>;
  private activeBackground: BackgroundTrack | null = null;
  private backgroundUnlockArmed = false;
  private musicMuted = false;
  private pageVisible = typeof document === 'undefined' || !document.hidden;
  private cinematicEffect: HTMLAudioElement | null = null;
  private cinematicMedia: HTMLMediaElement | null = null;
  private ghostFootstepLevel = 0;
  private ghostFootstepTimer = 0;
  private readonly ghostFootstepAudio: HTMLAudioElement | null;
  volume = 0.65;
  musicVolume = 0.42;

  constructor() {
    if (typeof Audio === 'undefined') {
      this.background = {};
      this.ghostFootstepAudio = null;
      return;
    }
    this.background = {
      main: this.createBackground('/audio/main.mp3'),
      ingame: this.createBackground('/audio/ingame.mp3'),
    };
    this.ghostFootstepAudio = new Audio('/audio/ghost-footstep.wav');
    this.ghostFootstepAudio.preload = 'auto';
  }

  unlock(): void {
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') void this.context.resume();
    this.scheduleGhostFootstep();
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.cinematicEffect) this.cinematicEffect.volume = this.volume;
    if (this.cinematicMedia) {
      this.cinematicMedia.volume = this.volume;
      this.cinematicMedia.muted = this.muted || this.volume <= 0;
    }
    if (this.volume <= 0) this.stopGhostFootsteps();
    else this.scheduleGhostFootstep();
  }

  setMuted(value: boolean): void {
    this.muted = value;
    if (value) this.cinematicEffect?.pause();
    if (value) this.ghostFootstepAudio?.pause();
    if (this.cinematicMedia) this.cinematicMedia.muted = value || this.volume <= 0;
    if (value) this.stopGhostFootsteps();
    else this.scheduleGhostFootstep();
  }

  setGhostFootstepLevel(value: number): void {
    const wasAudible = this.ghostFootstepLevel > 0;
    this.ghostFootstepLevel = clamp01(value);
    if (this.ghostFootstepLevel <= 0) this.stopGhostFootsteps();
    else {
      // The ghost may only cross the six-tile warning radius briefly. Play the
      // first step immediately instead of making the survivor wait for the
      // first interval, then continue the distance-scaled cadence.
      if (!wasAudible) this.emitGhostFootstep();
      this.scheduleGhostFootstep();
    }
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
    if (this.activeBackground && this.pageVisible) void this.playBackground(this.activeBackground);
  }

  /** Stop looping BGM while the browser/app is backgrounded. */
  setPageVisible(visible: boolean): void {
    this.pageVisible = visible;
    if (!visible) {
      Object.values(this.background).forEach((track) => track?.pause());
      this.cinematicEffect?.pause();
      this.stopGhostFootsteps();
      return;
    }
    if (this.activeBackground && !this.musicMuted) void this.playBackground(this.activeBackground);
    if (this.cinematicEffect && !this.muted && !this.cinematicEffect.ended) void this.cinematicEffect.play().catch(() => undefined);
    this.scheduleGhostFootstep();
  }

  setBackgroundTrack(track: BackgroundTrack | null): void {
    if (this.activeBackground === track) {
      if (track && !this.musicMuted && this.pageVisible) void this.playBackground(track);
      return;
    }

    const previous = this.activeBackground
      ? this.background[this.activeBackground]
      : undefined;
    previous?.pause();
    this.activeBackground = track;

    if (!track || this.musicMuted || !this.pageVisible) return;
    const next = this.background[track];
    if (next) next.currentTime = 0;
    void this.playBackground(track);
  }

  bindCinematicMedia(media: HTMLMediaElement): () => void {
    if (this.cinematicMedia && this.cinematicMedia !== media) this.cinematicMedia.pause();
    this.stopCinematicEffect();
    this.cinematicMedia = media;
    media.volume = this.volume;
    media.muted = this.muted || this.volume <= 0;
    return () => {
      if (this.cinematicMedia === media) this.cinematicMedia = null;
    };
  }

  playCinematicEffect(source: string): () => void {
    this.stopCinematicEffect();
    if (this.muted || this.volume <= 0 || typeof Audio === 'undefined') return () => undefined;
    const track = new Audio(source);
    track.preload = 'auto';
    track.volume = this.volume;
    this.cinematicEffect = track;
    void track.play().catch(() => undefined);
    return () => {
      if (this.cinematicEffect !== track) return;
      this.stopCinematicEffect();
    };
  }

  private stopCinematicEffect(): void {
    this.cinematicEffect?.pause();
    if (this.cinematicEffect) this.cinematicEffect.currentTime = 0;
    this.cinematicEffect = null;
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
      'door-hit': [92, 52, 'square', .13], 'door-repair': [360, 760, 'triangle', .16], 'player-hit': [190, 70, 'sawtooth', .1], death: [220, 45, 'triangle', .45],
      'ghost-level-up': [120, 440, 'sawtooth', .35], 'ghost-retreat': [180, 70, 'triangle', .32],
      'ghost-return': [75, 240, 'sawtooth', .4], 'ghost-skill': [340, 45, 'square', .42], 'ghost-net': [920, 170, 'triangle', .22], 'item-draw': [360, 1260, 'sine', .5],
      'item-drop': [760, 320, 'sine', .2], 'item-pickup': [440, 1120, 'triangle', .18],
      'consumable-use': [640, 1160, 'sine', .18],
      'elite-join': [260, 1380, 'triangle', .65],
      'auto-bed-claim': [520, 880, 'sine', .24],
      'starter-allocation': [620, 1040, 'sine', .28],
      'lights-on': [180, 760, 'sine', .32],
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
    // Only the track for the current screen is played. Preloading both BGM
    // files on every cold start competes with the home artwork and auth API on
    // mobile connections; play() will fetch the selected track on demand.
    track.preload = 'none';
    track.volume = this.musicVolume;
    return track;
  }

  private stopGhostFootsteps(): void {
    if (this.ghostFootstepTimer && typeof window !== 'undefined') window.clearTimeout(this.ghostFootstepTimer);
    this.ghostFootstepTimer = 0;
    this.ghostFootstepAudio?.pause();
  }

  private scheduleGhostFootstep(): void {
    if (this.ghostFootstepTimer || typeof window === 'undefined') return;
    if (this.muted || !this.pageVisible || this.volume <= 0 || this.ghostFootstepLevel <= 0) return;
    this.ghostFootstepTimer = window.setTimeout(() => {
      this.ghostFootstepTimer = 0;
      this.emitGhostFootstep();
      this.scheduleGhostFootstep();
    }, ghostFootstepIntervalMs(this.ghostFootstepLevel));
  }

  private emitGhostFootstep(): void {
    if (this.muted || !this.pageVisible || this.volume <= 0) return;
    const level = this.ghostFootstepLevel;
    const volume = ghostFootstepGain(level, this.volume);
    if (this.ghostFootstepAudio) {
      this.ghostFootstepAudio.currentTime = 0;
      this.ghostFootstepAudio.volume = volume;
      void this.ghostFootstepAudio.play().catch(() => this.emitSynthGhostFootstep(level, volume));
      return;
    }
    this.emitSynthGhostFootstep(level, volume);
  }

  private emitSynthGhostFootstep(level: number, volume: number): void {
    const context = this.context;
    if (!context || context.state !== 'running' || this.muted || !this.pageVisible) return;
    for (const offset of [0, .13]) {
      const start = context.currentTime + offset;
      const duration = .16;
      const oscillator = context.createOscillator();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(176 + level * 24, start);
      oscillator.frequency.exponentialRampToValueAtTime(72, start + duration);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(520 + level * 180, start);
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(.0001, volume), start + .018);
      gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
      oscillator.connect(filter).connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration);
    }
  }

  private async playBackground(trackName: BackgroundTrack): Promise<void> {
    if (this.musicMuted || !this.pageVisible || this.activeBackground !== trackName) return;
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
      if (this.activeBackground && !this.musicMuted && this.pageVisible) {
        void this.playBackground(this.activeBackground);
      }
    };
    document.addEventListener('pointerdown', resume, { once: true, capture: true });
    document.addEventListener('keydown', resume, { once: true, capture: true });
  }
}
