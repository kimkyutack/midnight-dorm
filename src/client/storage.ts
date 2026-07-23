export interface LocalProfile {
  nickname: string;
  deviceId: string;
  volume: number;
  musicVolume: number;
  musicEnabled: boolean;
  vibration: boolean;
  bestSurvivalSeconds: number;
  victories: number;
  ghostKills: number;
  bestGhostLevel: number;
  recentRoomCode: string;
  installHintShown: boolean;
  openingSeen: boolean;
  /** A failed cold-start realtime handshake must not silently restore an
   * otherwise valid cookie on the next page open. */
  mustReauthenticate: boolean;
  reconnectTokens: Record<string, string>;
}

const STORAGE_KEY = 'midnight-dorm-profile-v1';

const defaults = (): LocalProfile => ({
  nickname: '',
  deviceId: crypto.randomUUID(),
  volume: 0.65,
  musicVolume: 0.42,
  musicEnabled: true,
  vibration: true,
  bestSurvivalSeconds: 0,
  victories: 0,
  ghostKills: 0,
  bestGhostLevel: 0,
  recentRoomCode: '',
  installHintShown: false,
  openingSeen: false,
  mustReauthenticate: false,
  reconnectTokens: {},
});

export function loadProfile(): LocalProfile {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<LocalProfile>;
    return { ...defaults(), ...parsed, reconnectTokens: { ...parsed.reconnectTokens } };
  } catch {
    return defaults();
  }
}

export function saveProfile(profile: LocalProfile): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}
