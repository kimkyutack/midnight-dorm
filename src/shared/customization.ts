import { rankIndex } from './progression';
import type { AvatarAppearance, CosmeticSlot, RankId, TurretKind, TurretSkinLoadout } from './types';

export type CosmeticUnlock =
  | { kind: 'starter' }
  | { kind: 'points'; price: number }
  | { kind: 'rank'; rank: RankId };

/** A complete skin can replace a base trait instead of only scaling it. */
export interface SkinTraitOverride {
  label: string;
  description: string;
  turretDamageMultiplier?: number;
  turretRateMultiplier?: number;
  goldPerSecond?: number;
  powerPerSecond?: number;
  extraDraws?: number;
  /** Added probability points shared by legendary and mythic random-box rewards. */
  highRarityChanceBonus?: number;
  unclaimedMoveSpeedMultiplier?: number;
  turretRangeBonus?: number;
  firstGuardianLevelBonus?: number;
  /** Minimum level for every offensive turret installed while this skin is equipped. */
  turretStartingLevel?: number;
  occupiedDoorLevelBonus?: number;
  doorShieldRatio?: number;
}

export interface CosmeticDefinition {
  id: string;
  slot: CosmeticSlot;
  label: string;
  description: string;
  symbol: string;
  swatch: string;
  unlock: CosmeticUnlock;
  /** Base survivor required to own and equip a complete skin. */
  characterId?: string;
  /** Complete skins can tune their own trait strength without layering gear. */
  traitMultiplier?: number;
  /** Optional dedicated atlas folder for a second or later skin of one survivor. */
  assetDirectory?: string;
  /** Optional authored gameplay effect for a skin whose ability differs from its base survivor. */
  traitOverride?: SkinTraitOverride;
  turretKind?: TurretKind;
}

const CHARACTERS = [
  { id: 'character-bunny', slot: 'character', label: '밤토끼 모모', description: '작지만 겁이 없는 기본 생존자', symbol: '토', swatch: '#e9c7bc', unlock: { kind: 'starter' } },
  { id: 'character-cat', slot: 'character', label: '달고양이 루루', description: '초승달 귀를 가진 재빠른 고양이', symbol: '냥', swatch: '#bdc5da', unlock: { kind: 'points', price: 900 } },
  { id: 'character-puppy', slot: 'character', label: '구름강아지 몽', description: '축 처진 귀와 동그란 코가 매력적', symbol: '멍', swatch: '#d8aa78', unlock: { kind: 'points', price: 1_100 } },
  { id: 'character-bear', slot: 'character', label: '도토리곰 밤이', description: '고수 등급이 인정한 든든한 생존자', symbol: '곰', swatch: '#9b6f52', unlock: { kind: 'rank', rank: 'expert' } },
  { id: 'character-fox', slot: 'character', label: '별여우 초롱', description: '초고수만 만날 수 있는 별빛 여우', symbol: '여', swatch: '#d9784d', unlock: { kind: 'rank', rank: 'master' } },
  { id: 'character-hamster', slot: 'character', label: '유령햄스터 콩', description: '볼이 빵빵한 야간 정찰대원', symbol: '햄', swatch: '#d6b583', unlock: { kind: 'points', price: 1_500 } },
  { id: 'character-crocodile', slot: 'character', label: '늪악어 크로크', description: '늪지의 턱힘으로 포탑 피해를 크게 높인다', symbol: '악', swatch: '#5d9b61', unlock: { kind: 'points', price: 2_500 } },
  { id: 'character-duck', slot: 'character', label: '달오리 꽥', description: '매초 전력 1을 충전하는 달빛 정찰대원', symbol: '오', swatch: '#f0cb4e', unlock: { kind: 'points', price: 2_300 } },
  { id: 'character-tiger', slot: 'character', label: '달호랑이 라온', description: '호랑이의 도약으로 누구보다 빠르게 방을 찾아간다', symbol: '호', swatch: '#e29a4d', unlock: { kind: 'points', price: 3_000 } },
  { id: 'character-dinosaur', slot: 'character', label: '별공룡 라그', description: '포탑의 과충전 발사를 지휘하는 작은 공룡', symbol: '공', swatch: '#73b85d', unlock: { kind: 'points', price: 3_400 } },
  { id: 'character-monkey', slot: 'character', label: '달원숭이 몽키', description: '행운의 손재주로 램프를 두 번 더 돌린다', symbol: '원', swatch: '#8d5c42', unlock: { kind: 'points', price: 4_000 } },
  { id: 'character-gorilla', slot: 'character', label: '요새고릴라 콩', description: '문 최대 HP의 50%만큼 이중문 방어막을 만든다', symbol: '고', swatch: '#53606d', unlock: { kind: 'points', price: 4_400 } },
] as const satisfies readonly CosmeticDefinition[];

/**
 * Every skin resolves to one prepared sprite atlas; runtime code never layers
 * hats, clothes, accessories, or shoes over the actor.
 */
const SKINS = [
  { id: 'skin-look-bunny-ward', slot: 'skin', characterId: 'character-bunny', traitMultiplier: 1.5, traitOverride: { label: '탐험가의 발걸음', description: '침대를 점유하기 전 이동속도가 1.5배가 됩니다.', unclaimedMoveSpeedMultiplier: 1.5 }, label: '탐험가 모모', description: '노란 안전모와 파란 후드의 완성형 이벤트 스킨', symbol: '토', swatch: '#e9c7bc', unlock: { kind: 'points', price: 800 } },
  { id: 'skin-look-cat-ward', slot: 'skin', characterId: 'character-cat', traitMultiplier: 1.5, label: '새벽 탐정 루루', description: '빨간 재킷과 배낭을 갖춘 완성형 스킨', symbol: '냥', swatch: '#bdc5da', unlock: { kind: 'points', price: 4_000 } },
  { id: 'skin-look-puppy-ward', slot: 'skin', characterId: 'character-puppy', traitMultiplier: 1.5, label: '구조대 몽', description: '구조 조끼를 입은 완성형 스킨', symbol: '멍', swatch: '#d8aa78', unlock: { kind: 'points', price: 4_000 } },
  { id: 'skin-look-puppy-surfer', slot: 'skin', characterId: 'character-puppy', traitMultiplier: 2, traitOverride: { label: '파도 위 행운', description: '침대를 점유한 동안 매초 골드 5를 추가로 얻습니다.', goldPerSecond: 5 }, assetDirectory: 'skin-surfer-mong', label: '서퍼 몽', description: '하늘빛 고글과 보드를 타고 물결 위를 미끄러지는 완성형 스킨', symbol: '파', swatch: '#72d9f4', unlock: { kind: 'points', price: 8_000 } },
  { id: 'skin-look-tiger-lifeguard', slot: 'skin', characterId: 'character-tiger', traitMultiplier: 2, traitOverride: { label: '해변 구조 지휘', description: '포탑 사거리가 2칸 늘고 공격속도가 20% 증가합니다.', turretRangeBonus: 2, turretRateMultiplier: 1 / 1.2 }, assetDirectory: 'skin-lifeguard-raon', label: '해변 구조대 라온', description: '구명 튜브와 호루라기를 갖추고 물보라를 가르며 달리는 여름 한정 스킨', symbol: '구', swatch: '#ef5548', unlock: { kind: 'points', price: 8_000 } },
  { id: 'skin-look-cat-neon-rider', slot: 'skin', characterId: 'character-cat', traitMultiplier: 2, traitOverride: { label: '네온 오버클럭', description: '모든 포탑의 공격속도가 2배가 됩니다.', turretRateMultiplier: 0.5 }, assetDirectory: 'skin-neon-rider-lulu', label: '네온 라이더 루루', description: '네온 고글과 인라인 스케이트로 사이버 시티를 질주하는 프리미엄 스킨', symbol: '네', swatch: '#b347ff', unlock: { kind: 'points', price: 8_000 } },
  { id: 'skin-look-hamster-cyber-driver', slot: 'skin', characterId: 'character-hamster', traitMultiplier: 2, traitOverride: { label: 'Lv.5 양산 설계', description: '설치하는 모든 공격 포탑이 Lv.5로 시작합니다.', turretStartingLevel: 5 }, assetDirectory: 'skin-cyber-driver-kong', label: '사이버 드라이버 콩', description: '보랏빛 스포츠카와 무지개 휠로 네온 도로를 달리는 프리미엄 스킨', symbol: '카', swatch: '#803cff', unlock: { kind: 'points', price: 8_000 } },
  { id: 'skin-look-crocodile-police-enforcer', slot: 'skin', characterId: 'character-crocodile', traitMultiplier: 2, traitOverride: { label: '강력계 화력 지휘', description: '모든 포탑의 피해가 100% 증가하고 공격속도가 10% 증가합니다.', turretDamageMultiplier: 2, turretRateMultiplier: 1 / 1.1 }, assetDirectory: 'skin-police-enforcer-croco', label: '강력계 크로크', description: '압도적인 체격과 무전 장비로 현장을 장악하는 프리미엄 경찰 스킨', symbol: '경', swatch: '#315d8f', unlock: { kind: 'points', price: 8_000 } },
  { id: 'skin-look-monkey-secret-agent', slot: 'skin', characterId: 'character-monkey', traitMultiplier: 2, traitOverride: { label: '기밀 행운 조작', description: '램프 랜덤 뽑기를 3회 더 사용하고 신화·전설 아이템 확률이 5%p 증가합니다.', extraDraws: 3, highRarityChanceBonus: 0.05 }, assetDirectory: 'skin-secret-agent-monkey', label: '시크릿 에이전트 몽키', description: '검은 수트와 쌍수 사격 자세로 임무를 수행하는 프리미엄 비밀요원 스킨', symbol: '첩', swatch: '#98754f', unlock: { kind: 'points', price: 8_000 } },
  { id: 'skin-look-bear-ward', slot: 'skin', characterId: 'character-bear', traitMultiplier: 1.5, label: '야간 경비 밤이', description: '경비복을 입은 완성형 스킨', symbol: '곰', swatch: '#9b6f52', unlock: { kind: 'points', price: 4_000 } },
  { id: 'skin-look-fox-ward', slot: 'skin', characterId: 'character-fox', traitMultiplier: 1.5, label: '별빛 여우 초롱', description: '별 문양 코트를 입은 완성형 스킨', symbol: '여', swatch: '#d9784d', unlock: { kind: 'points', price: 4_000 } },
  { id: 'skin-look-hamster-ward', slot: 'skin', characterId: 'character-hamster', traitMultiplier: 1.5, label: '개구리 탐험가 콩', description: '탐험복을 입은 완성형 스킨', symbol: '햄', swatch: '#d6b583', unlock: { kind: 'points', price: 4_000 } },
  { id: 'skin-look-crocodile-ward', slot: 'skin', characterId: 'character-crocodile', traitMultiplier: 1.5, label: '늪지 경비 크로크', description: '보호 장비를 갖춘 완성형 스킨', symbol: '악', swatch: '#5d9b61', unlock: { kind: 'points', price: 4_000 } },
  { id: 'skin-look-duck-ward', slot: 'skin', characterId: 'character-duck', traitMultiplier: 1.5, traitOverride: { label: '달빛 고속 충전', description: '침대를 점유한 동안 매초 전력 1.5를 얻습니다.', powerPerSecond: 1.5 }, label: '달빛 정찰 꽥', description: '정찰 헬멧을 쓴 완성형 스킨', symbol: '오', swatch: '#f0cb4e', unlock: { kind: 'points', price: 4_000 } },
  { id: 'skin-look-tiger-ward', slot: 'skin', characterId: 'character-tiger', traitMultiplier: 1.5, traitOverride: { label: '붉은 번개 사격', description: '포탑 사거리가 1칸 늘고 공격속도가 5% 증가합니다.', turretRangeBonus: 1, turretRateMultiplier: 1 / 1.05 }, label: '붉은 번개 라온', description: '붉은 전투복의 완성형 스킨', symbol: '호', swatch: '#e29a4d', unlock: { kind: 'points', price: 4_000 } },
  { id: 'skin-look-dinosaur-ward', slot: 'skin', characterId: 'character-dinosaur', traitMultiplier: 1.5, label: '과충전 라그', description: '기계 장비를 갖춘 완성형 스킨', symbol: '공', swatch: '#73b85d', unlock: { kind: 'points', price: 4_000 } },
  { id: 'skin-look-monkey-ward', slot: 'skin', characterId: 'character-monkey', traitMultiplier: 1.5, label: '야간 정비 몽키', description: '정비복을 입은 완성형 스킨', symbol: '원', swatch: '#8d5c42', unlock: { kind: 'points', price: 4_000 } },
  { id: 'skin-look-gorilla-ward', slot: 'skin', characterId: 'character-gorilla', traitMultiplier: 1.5, traitOverride: { label: '삼중 요새문', description: '방을 점유하면 문 최대 HP의 75%만큼 방어막이 생깁니다.', doorShieldRatio: 0.75 }, label: '요새 수호 콩', description: '중장비 수호복의 완성형 스킨', symbol: '고', swatch: '#53606d', unlock: { kind: 'points', price: 4_000 } },
] as const satisfies readonly CosmeticDefinition[];

export const DEFAULT_TILE_SKIN_ID = 'tile-basic-ward';
export const WAVE_TILE_SKIN_ID = 'tile-wave-surfer';
export const BEACH_SAND_TILE_SKIN_ID = 'tile-beach-lifeguard';
export const CYBERPUNK_NEON_TILE_SKIN_ID = 'tile-cyberpunk-neon';
export const SPECIAL_OPS_HEADQUARTERS_TILE_SKIN_ID = 'tile-special-ops-headquarters';
export const SURFER_WATER_TURRET_SKIN_ID = 'turret-basic-surfer-water';
export const LIFEGUARD_PARASOL_TURRET_SKIN_ID = 'turret-basic-lifeguard-parasol';
export const CYBERPUNK_LASER_TURRET_SKIN_ID = 'turret-basic-cyberpunk-laser';
export const SPECIAL_OPS_TRACKER_TURRET_SKIN_ID = 'turret-basic-special-ops-tracker';

const TILE_SKINS = [
  {
    id: DEFAULT_TILE_SKIN_ID,
    slot: 'tile',
    label: '기본 병동 타일',
    description: '스테이지 고유의 기본 방 타일을 사용합니다.',
    symbol: '기',
    swatch: '#185f63',
    unlock: { kind: 'starter' },
  },
  {
    id: WAVE_TILE_SKIN_ID,
    slot: 'tile',
    label: '파도 타일',
    description: '방 바닥을 시원한 물결 타일로 바꿉니다.',
    symbol: '파',
    swatch: '#55dff3',
    unlock: { kind: 'points', price: 1_800 },
    assetDirectory: 'skin-wave/wave-tile.webp',
  },
  {
    id: BEACH_SAND_TILE_SKIN_ID,
    slot: 'tile',
    label: '모래사장 타일',
    description: '방 바닥을 포근한 해변 타일로 바꿉니다.',
    symbol: '모',
    swatch: '#e8c783',
    unlock: { kind: 'points', price: 1_800 },
    assetDirectory: 'skin-beach-sand/sand-tile.webp',
  },
  {
    id: CYBERPUNK_NEON_TILE_SKIN_ID,
    slot: 'tile',
    label: '네온 회로 타일',
    description: '방 바닥을 보랏빛 회로 타일로 바꿉니다.',
    symbol: '전',
    swatch: '#b347ff',
    unlock: { kind: 'points', price: 1_800 },
    assetDirectory: 'skin-cyberpunk-neon/neon-circuit-tile.webp',
  },
  {
    id: SPECIAL_OPS_HEADQUARTERS_TILE_SKIN_ID,
    slot: 'tile',
    label: '특수수사본부 타일',
    description: '방 바닥을 청회색 수사본부 타일로 바꿉니다.',
    symbol: '수',
    swatch: '#4f79a8',
    unlock: { kind: 'points', price: 1_800 },
    assetDirectory: 'skin-special-ops-headquarters/investigation-floor.webp',
  },
] as const satisfies readonly CosmeticDefinition[];

const TURRET_SKINS = [
  { id: 'turret-basic-ward', slot: 'turret', turretKind: 'basic-turret', label: '수호포 · 병동형', description: '기본 수호 포탑의 표준 병동 외장', symbol: '수', swatch: '#62d7ff', unlock: { kind: 'starter' } },
  {
    id: SURFER_WATER_TURRET_SKIN_ID,
    slot: 'turret',
    turretKind: 'basic-turret',
    label: '서퍼 물총포',
    description: '물총 외형과 물보라 발사 효과를 적용합니다.',
    symbol: '물',
    swatch: '#ffc84f',
    unlock: { kind: 'points', price: 2_500 },
    assetDirectory: 'skin-surfer-water-blaster',
  },
  {
    id: LIFEGUARD_PARASOL_TURRET_SKIN_ID,
    slot: 'turret',
    turretKind: 'basic-turret',
    label: '파라솔 포탑',
    description: '접힌 파라솔부터 구조대 지휘소까지 성장합니다.',
    symbol: '솔',
    swatch: '#ef5548',
    unlock: { kind: 'points', price: 2_500 },
    assetDirectory: 'skin-lifeguard-parasol',
  },
  {
    id: CYBERPUNK_LASER_TURRET_SKIN_ID,
    slot: 'turret',
    turretKind: 'basic-turret',
    label: '네온 레이저포',
    description: '권총부터 거대 레이저포까지 성장합니다.',
    symbol: '광',
    swatch: '#f24dff',
    unlock: { kind: 'points', price: 2_500 },
    assetDirectory: 'skin-cyberpunk-laser',
  },
  {
    id: SPECIAL_OPS_TRACKER_TURRET_SKIN_ID,
    slot: 'turret',
    turretKind: 'basic-turret',
    label: '기밀 추적포',
    description: '감시 장치부터 스마트 레일건까지 성장합니다.',
    symbol: '추',
    swatch: '#d5dce8',
    unlock: { kind: 'points', price: 2_500 },
    assetDirectory: 'skin-special-ops-tracker',
  },
  { id: 'turret-basic-toy', slot: 'turret', turretKind: 'basic-turret', label: '수호포 · 장난감', description: '둥근 별 장식과 크림색 포신', symbol: '별', swatch: '#f1b86b', unlock: { kind: 'points', price: 600 } },
  { id: 'turret-basic-pumpkin', slot: 'turret', turretKind: 'basic-turret', label: '수호포 · 호박등', description: '주황빛 눈이 반짝이는 호박 포대', symbol: '호', swatch: '#e87942', unlock: { kind: 'points', price: 900 } },
  { id: 'turret-rapid-firefly', slot: 'turret', turretKind: 'rapid-turret', label: '연사포 · 반딧불', description: '기본 청록 발광 연사 외장', symbol: '속', swatch: '#71e4d1', unlock: { kind: 'starter' } },
  { id: 'turret-rapid-candy', slot: 'turret', turretKind: 'rapid-turret', label: '연사포 · 캔디팝', description: '분홍·민트 쌍열 포신 디자인', symbol: '팝', swatch: '#ed86b5', unlock: { kind: 'points', price: 750 } },
  { id: 'turret-rapid-dragon', slot: 'turret', turretKind: 'rapid-turret', label: '연사포 · 꼬마용', description: '작은 뿔과 입 모양 포구', symbol: '용', swatch: '#8ccf72', unlock: { kind: 'points', price: 1_100 } },
  { id: 'turret-frost-snow', slot: 'turret', turretKind: 'frost-turret', label: '서리포 · 설원형', description: '기본 눈꽃 레이저 외장', symbol: '눈', swatch: '#91efff', unlock: { kind: 'starter' } },
  { id: 'turret-frost-globe', slot: 'turret', turretKind: 'frost-turret', label: '서리포 · 스노우볼', description: '투명 구체 속 작은 눈보라', symbol: '설', swatch: '#c4f4ff', unlock: { kind: 'points', price: 850 } },
  { id: 'turret-frost-crystal', slot: 'turret', turretKind: 'frost-turret', label: '서리포 · 수정꽃', description: '육각 결정이 회전하는 희귀 외장', symbol: '정', swatch: '#7fc8ff', unlock: { kind: 'points', price: 1_250 } },
  { id: 'turret-arc-storm', slot: 'turret', turretKind: 'arc-turret', label: '천둥포 · 폭풍형', description: '희귀 천둥포의 기본 외장', symbol: '뢰', swatch: '#cf79ff', unlock: { kind: 'starter' } },
  { id: 'turret-arc-idol', slot: 'turret', turretKind: 'arc-turret', label: '천둥포 · 구름신상', description: '구름 고리가 번개를 모은다', symbol: '운', swatch: '#b69cf2', unlock: { kind: 'points', price: 1_350 } },
  { id: 'turret-arc-crown', slot: 'turret', turretKind: 'arc-turret', label: '천둥포 · 왕실폭뢰', description: '왕관 코어가 빛나는 최상급 외장', symbol: '왕', swatch: '#f0bd63', unlock: { kind: 'points', price: 1_800 } },
] as const satisfies readonly CosmeticDefinition[];

export const COSMETIC_CATALOG = [...CHARACTERS, ...SKINS, ...TILE_SKINS, ...TURRET_SKINS] as const satisfies readonly CosmeticDefinition[];

export const DEFAULT_APPEARANCE: AvatarAppearance = {
  character: 'character-bunny',
  skin: 'skin-basic-bunny',
  tileSkin: DEFAULT_TILE_SKIN_ID,
};

export const DEFAULT_TURRET_SKINS: TurretSkinLoadout = {
  'basic-turret': 'turret-basic-ward',
  'rapid-turret': 'turret-rapid-firefly',
  'frost-turret': 'turret-frost-snow',
  'arc-turret': 'turret-arc-storm',
};

export const STARTER_COSMETICS = COSMETIC_CATALOG
  // A base skin is inherited from its character rather than being a separately
  // owned product. This keeps the account inventory free of hidden equipment.
  .filter((item) => item.unlock.kind === 'starter' && item.slot !== 'skin')
  .map((item) => item.id);

export const cosmeticById = (id: string): CosmeticDefinition | undefined =>
  COSMETIC_CATALOG.find((item) => item.id === id);

export const cosmeticsForSlot = (slot: CosmeticSlot): readonly CosmeticDefinition[] =>
  COSMETIC_CATALOG.filter((item) => item.slot === slot);

/** A character's neutral paperdoll base is never a purchasable skin card. */
export const defaultSkinForCharacter = (characterId: string): string =>
  `skin-basic-${characterId.replace('character-', '')}`;

export const isDefaultSkinForCharacter = (skinId: string, characterId: string): boolean =>
  skinId === defaultSkinForCharacter(characterId);

/** New skins can override this per item; base paperdolls never receive a bonus. */
export function skinTraitMultiplier(appearance: AvatarAppearance): number {
  if (isDefaultSkinForCharacter(appearance.skin, appearance.character)) return 1;
  const skin = cosmeticById(appearance.skin);
  return skin?.slot === 'skin' && skin.characterId === appearance.character
    ? skin.traitMultiplier ?? 1
    : 1;
}

export function skinTraitOverride(appearance: AvatarAppearance): SkinTraitOverride | undefined {
  if (isDefaultSkinForCharacter(appearance.skin, appearance.character)) return undefined;
  const skin = cosmeticById(appearance.skin);
  return skin?.slot === 'skin' && skin.characterId === appearance.character
    ? skin.traitOverride
    : undefined;
}

export function characterAvailable(characterId: string, rank: RankId, owned: readonly string[]): boolean {
  const character = cosmeticById(characterId);
  if (!character || character.slot !== 'character') return false;
  if (character.unlock.kind === 'starter') return true;
  if (character.unlock.kind === 'rank') return rankIndex(rank) >= rankIndex(character.unlock.rank);
  return owned.includes(characterId);
}

export function cosmeticAvailable(item: CosmeticDefinition, rank: RankId, owned: readonly string[]): boolean {
  if (item.slot === 'skin' && (!item.characterId || !characterAvailable(item.characterId, rank, owned))) return false;
  if (item.unlock.kind === 'starter') return true;
  if (item.unlock.kind === 'points') return owned.includes(item.id);
  return rankIndex(rank) >= rankIndex(item.unlock.rank);
}

/**
 * Converts every old paper-doll save into the matching base skin.  Old fields
 * are intentionally ignored so an old hat/outfit can never be rendered again.
 */
export function normalizeAppearance(value: unknown): AvatarAppearance {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawCharacter = typeof source.character === 'string' ? source.character : '';
  const character = rawCharacter === 'character-eagle' ? 'character-tiger' : rawCharacter;
  const characterId = cosmeticById(character)?.slot === 'character'
    ? character
    : DEFAULT_APPEARANCE.character;
  const rawSkin = typeof source.skin === 'string' ? source.skin : '';
  const skin = cosmeticById(rawSkin);
  const rawTileSkin = typeof source.tileSkin === 'string' ? source.tileSkin : '';
  const tileSkin = cosmeticById(rawTileSkin);
  return {
    character: characterId,
    skin: isDefaultSkinForCharacter(rawSkin, characterId) || (skin?.slot === 'skin' && skin.characterId === characterId)
      ? rawSkin
      : defaultSkinForCharacter(characterId),
    tileSkin: tileSkin?.slot === 'tile' ? tileSkin.id : DEFAULT_TILE_SKIN_ID,
  };
}

export function appearanceAfterCosmeticEquip(
  appearance: AvatarAppearance,
  item: CosmeticDefinition,
): AvatarAppearance {
  if (item.slot === 'character') {
    return normalizeAppearance({
      ...appearance,
      character: item.id,
      skin: defaultSkinForCharacter(item.id),
    });
  }
  if (item.slot === 'skin' && item.characterId) {
    return normalizeAppearance({
      ...appearance,
      character: item.characterId,
      skin: item.id,
    });
  }
  if (item.slot === 'tile') {
    return normalizeAppearance({ ...appearance, tileSkin: item.id });
  }
  return normalizeAppearance(appearance);
}

export function tileSkinTextureUrl(tileSkinId: string | undefined): string | undefined {
  const item = cosmeticById(tileSkinId ?? '');
  if (item?.slot !== 'tile' || !item.assetDirectory) return undefined;
  return `/assets/tiles/${item.assetDirectory}`;
}

export function turretSkinAssetUrl(
  turretSkinId: string | undefined,
  level = 1,
): string | undefined {
  const item = cosmeticById(turretSkinId ?? '');
  if (item?.slot !== 'turret' || !item.assetDirectory) return undefined;
  const safeLevel = Math.max(1, Math.min(15, Math.floor(level)));
  return `/assets/turret-skins/${item.assetDirectory}/level-${String(safeLevel).padStart(2, '0')}.png`;
}

export function normalizeTurretSkins(value: unknown): TurretSkinLoadout {
  const source = value && typeof value === 'object' ? value as Partial<Record<TurretKind, unknown>> : {};
  const result = { ...DEFAULT_TURRET_SKINS };
  for (const kind of Object.keys(result) as TurretKind[]) {
    const id = typeof source[kind] === 'string' ? source[kind] : '';
    const item = cosmeticById(id);
    if (item?.slot === 'turret' && item.turretKind === kind) result[kind] = id;
  }
  return result;
}

export function customizationReward(stageIndex: number): number {
  return 80 + Math.min(420, Math.max(0, Math.floor(stageIndex)) * 4);
}

const BOT_CHARACTERS = ['character-cat', 'character-puppy', 'character-bear', 'character-hamster'] as const;

export function botAppearance(index: number): AvatarAppearance {
  const safe = Math.abs(Math.floor(index));
  const character = BOT_CHARACTERS[safe % BOT_CHARACTERS.length] as string;
  return {
    character,
    skin: defaultSkinForCharacter(character),
    tileSkin: DEFAULT_TILE_SKIN_ID,
  };
}
