import { COSMETIC_CATALOG, type CosmeticDefinition } from './customization';

export const MOONLIT_PHANTOM_PACKAGE_ID = 'prestige-moonlit-phantom-fox';
export const MOONLIT_PHANTOM_SKIN_ID = 'skin-look-fox-moonlit-phantom';
export const MOONLIT_PHANTOM_TILE_ID = 'tile-moonlit-phantom';
export const MOONLIT_FOXFIRE_TURRET_ID = 'turret-basic-moonlit-foxfire';
export const MOONLIT_PROFILE_IMAGE_ID = 'profile-image-moonlit-phantom-fox';
export const MOONLIT_PROFILE_FRAME_ID = 'profile-frame-moonlit-phantom-fox';
export const BASIC_PROFILE_FRAME_ID = 'profile-frame-basic';

export const STARLIT_CLOUD_RABBIT_PACKAGE_ID = 'prestige-starlit-cloud-rabbit';
export const STARLIT_CLOUD_RABBIT_SKIN_ID = 'skin-look-bunny-starlit-cloud';
export const STARLIT_CLOUD_RABBIT_TILE_ID = 'tile-starlit-cloud';
export const STARLIT_CLOUD_RABBIT_TURRET_ID = 'turret-basic-starlit-cloud';
export const STARLIT_CLOUD_PROFILE_IMAGE_ID = 'profile-image-starlit-cloud-rabbit';
export const STARLIT_CLOUD_PROFILE_FRAME_ID = 'profile-frame-starlit-cloud-rabbit';

export const ABYSSAL_KNIGHT_GORILLA_PACKAGE_ID = 'prestige-abyssal-knight-gorilla';
export const ABYSSAL_KNIGHT_GORILLA_SKIN_ID = 'skin-look-gorilla-abyssal-knight';
export const ABYSSAL_KNIGHT_GORILLA_TILE_ID = 'tile-abyssal-knight';
export const ABYSSAL_KNIGHT_GORILLA_TURRET_ID = 'turret-basic-abyssal-knight';
export const ABYSSAL_KNIGHT_PROFILE_IMAGE_ID = 'profile-image-abyssal-knight-gorilla';
export const ABYSSAL_KNIGHT_PROFILE_FRAME_ID = 'profile-frame-abyssal-knight-gorilla';

export const MOONLIT_EMOTES = [
  { id: 'moonlit-smug', label: '월령의 미소', assetUrl: '/assets/emotes/moonlit-phantom-fox/smug.webp' },
  { id: 'moonlit-shock', label: '여우불 깜짝', assetUrl: '/assets/emotes/moonlit-phantom-fox/shock.webp' },
  { id: 'moonlit-yawn', label: '달빛 하품', assetUrl: '/assets/emotes/moonlit-phantom-fox/yawn.webp' },
  { id: 'moonlit-victory', label: '월령 승리', assetUrl: '/assets/emotes/moonlit-phantom-fox/victory.webp' },
] as const;

export const STARLIT_CLOUD_EMOTES = [
  { id: 'starlit-cheer', label: '성운 환호', assetUrl: '/assets/emotes/starlit-cloud-rabbit/cheer.webp?v=prestige-v2' },
  { id: 'starlit-sparkle', label: '별빛 반짝', assetUrl: '/assets/emotes/starlit-cloud-rabbit/sparkle.webp?v=prestige-v2' },
  { id: 'starlit-cloud', label: '구름 휴식', assetUrl: '/assets/emotes/starlit-cloud-rabbit/cloud.webp?v=prestige-v2' },
  { id: 'starlit-dash', label: '유성 질주', assetUrl: '/assets/emotes/starlit-cloud-rabbit/dash.webp?v=prestige-v2' },
] as const;

export const ABYSSAL_KNIGHT_EMOTES = [
  { id: 'abyssal-roar', label: '심연의 포효', assetUrl: '/assets/emotes/abyssal-knight-gorilla/roar.webp?v=prestige-v2' },
  { id: 'abyssal-flame', label: '흑염 점화', assetUrl: '/assets/emotes/abyssal-knight-gorilla/flame.webp?v=prestige-v2' },
  { id: 'abyssal-guard', label: '기사단 방패', assetUrl: '/assets/emotes/abyssal-knight-gorilla/guard.webp?v=prestige-v2' },
  { id: 'abyssal-victory', label: '군단장 승리', assetUrl: '/assets/emotes/abyssal-knight-gorilla/victory.webp?v=prestige-v2' },
] as const;

export type PrestigeEmoteId =
  | typeof MOONLIT_EMOTES[number]['id']
  | typeof STARLIT_CLOUD_EMOTES[number]['id']
  | typeof ABYSSAL_KNIGHT_EMOTES[number]['id'];

export const PREMIUM_SKIN_IDS = new Set([
  'skin-look-puppy-surfer',
  'skin-look-tiger-lifeguard',
  'skin-look-cat-neon-rider',
  'skin-look-hamster-cyber-driver',
  'skin-look-crocodile-police-enforcer',
  'skin-look-monkey-secret-agent',
]);

export const MOONLIT_PACKAGE_REWARDS = {
  profileImageId: MOONLIT_PROFILE_IMAGE_ID,
  profileFrameId: MOONLIT_PROFILE_FRAME_ID,
  emoteIds: MOONLIT_EMOTES.map((emote) => emote.id),
  cosmeticIds: [MOONLIT_PHANTOM_SKIN_ID, MOONLIT_PHANTOM_TILE_ID, MOONLIT_FOXFIRE_TURRET_ID],
} as const;

export const STARLIT_CLOUD_PACKAGE_REWARDS = {
  profileImageId: STARLIT_CLOUD_PROFILE_IMAGE_ID,
  profileFrameId: STARLIT_CLOUD_PROFILE_FRAME_ID,
  emoteIds: STARLIT_CLOUD_EMOTES.map((emote) => emote.id),
  cosmeticIds: [STARLIT_CLOUD_RABBIT_SKIN_ID, STARLIT_CLOUD_RABBIT_TILE_ID, STARLIT_CLOUD_RABBIT_TURRET_ID],
} as const;

export const ABYSSAL_KNIGHT_PACKAGE_REWARDS = {
  profileImageId: ABYSSAL_KNIGHT_PROFILE_IMAGE_ID,
  profileFrameId: ABYSSAL_KNIGHT_PROFILE_FRAME_ID,
  emoteIds: ABYSSAL_KNIGHT_EMOTES.map((emote) => emote.id),
  cosmeticIds: [ABYSSAL_KNIGHT_GORILLA_SKIN_ID, ABYSSAL_KNIGHT_GORILLA_TILE_ID, ABYSSAL_KNIGHT_GORILLA_TURRET_ID],
} as const;

export interface PrestigeEmoteDefinition {
  id: string;
  label: string;
  assetUrl: string;
}

export interface PrestigePackageDefinition {
  id: string;
  title: string;
  /** Listed before launch, but never exchangeable until its game assets ship. */
  available: boolean;
  profileImageId: string;
  profileFrameId: string;
  cosmeticIds: readonly string[];
  emotes: readonly PrestigeEmoteDefinition[];
}

export const PRESTIGE_PACKAGES: readonly PrestigePackageDefinition[] = [
  { id: MOONLIT_PHANTOM_PACKAGE_ID, title: '월령 환영 여우', available: true, profileImageId: MOONLIT_PROFILE_IMAGE_ID, profileFrameId: MOONLIT_PROFILE_FRAME_ID, cosmeticIds: MOONLIT_PACKAGE_REWARDS.cosmeticIds, emotes: MOONLIT_EMOTES },
  { id: STARLIT_CLOUD_RABBIT_PACKAGE_ID, title: '성운 구름무희 모모', available: true, profileImageId: STARLIT_CLOUD_PROFILE_IMAGE_ID, profileFrameId: STARLIT_CLOUD_PROFILE_FRAME_ID, cosmeticIds: STARLIT_CLOUD_PACKAGE_REWARDS.cosmeticIds, emotes: STARLIT_CLOUD_EMOTES },
  { id: ABYSSAL_KNIGHT_GORILLA_PACKAGE_ID, title: '심연 기사단장 콩', available: true, profileImageId: ABYSSAL_KNIGHT_PROFILE_IMAGE_ID, profileFrameId: ABYSSAL_KNIGHT_PROFILE_FRAME_ID, cosmeticIds: ABYSSAL_KNIGHT_PACKAGE_REWARDS.cosmeticIds, emotes: ABYSSAL_KNIGHT_EMOTES },
] as const;

export type PrestigePackageId = string;

export const GHOST_ORB_CASH_COST = 100;
export const GHOST_ORB_PACKAGE_COST = 10;
/** One orb is guaranteed no later than the 33rd draw; ten orbs cap at 330 draws. */
export const GHOST_ORB_PITY_DRAWS = 33;

export const GHOST_ORB_DRAW_TABLE = [
  { kind: 'points', amount: 100, weight: 24 },
  { kind: 'points', amount: 200, weight: 18 },
  { kind: 'points', amount: 300, weight: 14 },
  { kind: 'points', amount: 500, weight: 8 },
  { kind: 'points', amount: 1_000, weight: 3 },
  { kind: 'cosmetic', slot: 'character', weight: 12 },
  { kind: 'cosmetic', slot: 'skin', weight: 10 },
  { kind: 'cosmetic', slot: 'tile', weight: 5 },
  { kind: 'cosmetic', slot: 'turret', weight: 3 },
  { kind: 'orbs', amount: 1, weight: 2.4 },
  { kind: 'orbs', amount: 5, weight: 0.5 },
  { kind: 'orbs', amount: 10, weight: 0.1 },
] as const;

export function ghostOrbEligibleCosmetics(): CosmeticDefinition[] {
  return (COSMETIC_CATALOG as readonly CosmeticDefinition[]).filter((item) =>
    item.unlock.kind === 'points'
    && !item.premium
    && !item.prestige
    && !PREMIUM_SKIN_IDS.has(item.id),
  );
}

/** Duplicate compensation is always the item's live point-shop price. */
export function duplicatePointRefund(itemId: string): number {
  const item = COSMETIC_CATALOG.find((candidate) => candidate.id === itemId);
  return item?.unlock.kind === 'points' ? item.unlock.price : 0;
}

export function prestigeEmoteById(id: string) {
  return PRESTIGE_PACKAGES.flatMap((entry) => entry.emotes).find((emote) => emote.id === id);
}

export function prestigePackageById(id: string) {
  return PRESTIGE_PACKAGES.find((entry) => entry.id === id);
}

export function prestigePackageForProfileImage(id: string) {
  return PRESTIGE_PACKAGES.find((entry) => entry.profileImageId === id);
}

export function prestigePackageForProfileFrame(id: string) {
  return PRESTIGE_PACKAGES.find((entry) => entry.profileFrameId === id);
}
