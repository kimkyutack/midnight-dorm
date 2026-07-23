import { rankIndex } from './progression';
import type { AvatarAppearance, CosmeticSlot, RankId, TurretKind, TurretSkinLoadout } from './types';

export type CosmeticUnlock =
  | { kind: 'starter' }
  | { kind: 'points'; price: number }
  | { kind: 'rank'; rank: RankId };

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
  turretKind?: TurretKind;
}

const CHARACTERS = [
  { id: 'character-bunny', slot: 'character', label: '밤토끼 모모', description: '작지만 겁이 없는 기본 생존자', symbol: '토', swatch: '#e9c7bc', unlock: { kind: 'starter' } },
  { id: 'character-cat', slot: 'character', label: '달고양이 루루', description: '초승달 귀를 가진 재빠른 고양이', symbol: '냥', swatch: '#bdc5da', unlock: { kind: 'points', price: 500 } },
  { id: 'character-puppy', slot: 'character', label: '구름강아지 몽', description: '축 처진 귀와 동그란 코가 매력적', symbol: '멍', swatch: '#d8aa78', unlock: { kind: 'points', price: 650 } },
  { id: 'character-bear', slot: 'character', label: '도토리곰 밤이', description: '고수 등급이 인정한 든든한 생존자', symbol: '곰', swatch: '#9b6f52', unlock: { kind: 'rank', rank: 'expert' } },
  { id: 'character-fox', slot: 'character', label: '별여우 초롱', description: '초고수만 만날 수 있는 별빛 여우', symbol: '여', swatch: '#d9784d', unlock: { kind: 'rank', rank: 'master' } },
  { id: 'character-hamster', slot: 'character', label: '유령햄스터 콩', description: '볼이 빵빵한 야간 정찰대원', symbol: '햄', swatch: '#d6b583', unlock: { kind: 'points', price: 900 } },
  { id: 'character-crocodile', slot: 'character', label: '늪악어 크로크', description: '늪지의 턱힘으로 포탑 피해를 크게 높인다', symbol: '악', swatch: '#5d9b61', unlock: { kind: 'points', price: 1_500 } },
  { id: 'character-duck', slot: 'character', label: '달오리 꽥', description: '달빛 동전을 물어오는 부유한 정찰대원', symbol: '오', swatch: '#f0cb4e', unlock: { kind: 'points', price: 1_350 } },
  { id: 'character-tiger', slot: 'character', label: '달호랑이 라온', description: '호랑이의 도약으로 누구보다 빠르게 방을 찾아간다', symbol: '호', swatch: '#e29a4d', unlock: { kind: 'points', price: 1_800 } },
  { id: 'character-dinosaur', slot: 'character', label: '별공룡 라그', description: '포탑의 과충전 발사를 지휘하는 작은 공룡', symbol: '공', swatch: '#73b85d', unlock: { kind: 'points', price: 2_000 } },
  { id: 'character-monkey', slot: 'character', label: '달원숭이 몽키', description: '행운의 손재주로 램프를 두 번 더 돌린다', symbol: '원', swatch: '#8d5c42', unlock: { kind: 'points', price: 2_400 } },
  { id: 'character-gorilla', slot: 'character', label: '요새고릴라 콩', description: '든든한 시야로 모든 포탑의 사거리를 넓힌다', symbol: '고', swatch: '#53606d', unlock: { kind: 'points', price: 2_600 } },
] as const satisfies readonly CosmeticDefinition[];

/**
 * Every skin resolves to one prepared sprite atlas; runtime code never layers
 * hats, clothes, accessories, or shoes over the actor.
 */
const SKINS = [
  { id: 'skin-bunny-ward', slot: 'skin', characterId: 'character-bunny', label: '병동 토끼', description: '모모의 기본 병동 스킨', symbol: '토', swatch: '#e9c7bc', unlock: { kind: 'starter' } },
  { id: 'skin-cat-ward', slot: 'skin', characterId: 'character-cat', label: '병동 고양이', description: '루루의 기본 병동 스킨', symbol: '냥', swatch: '#bdc5da', unlock: { kind: 'starter' } },
  { id: 'skin-puppy-ward', slot: 'skin', characterId: 'character-puppy', label: '병동 강아지', description: '몽의 기본 병동 스킨', symbol: '멍', swatch: '#d8aa78', unlock: { kind: 'starter' } },
  { id: 'skin-bear-ward', slot: 'skin', characterId: 'character-bear', label: '병동 곰', description: '밤이의 기본 병동 스킨', symbol: '곰', swatch: '#9b6f52', unlock: { kind: 'starter' } },
  { id: 'skin-fox-ward', slot: 'skin', characterId: 'character-fox', label: '병동 여우', description: '초롱의 기본 병동 스킨', symbol: '여', swatch: '#d9784d', unlock: { kind: 'starter' } },
  { id: 'skin-hamster-ward', slot: 'skin', characterId: 'character-hamster', label: '병동 햄스터', description: '콩의 기본 병동 스킨', symbol: '햄', swatch: '#d6b583', unlock: { kind: 'starter' } },
  { id: 'skin-crocodile-ward', slot: 'skin', characterId: 'character-crocodile', label: '병동 악어', description: '크로크의 기본 병동 스킨', symbol: '악', swatch: '#5d9b61', unlock: { kind: 'starter' } },
  { id: 'skin-duck-ward', slot: 'skin', characterId: 'character-duck', label: '병동 오리', description: '꽥의 기본 병동 스킨', symbol: '오', swatch: '#f0cb4e', unlock: { kind: 'starter' } },
  { id: 'skin-tiger-ward', slot: 'skin', characterId: 'character-tiger', label: '병동 호랑이', description: '라온의 기본 병동 스킨', symbol: '호', swatch: '#e29a4d', unlock: { kind: 'starter' } },
  { id: 'skin-dinosaur-ward', slot: 'skin', characterId: 'character-dinosaur', label: '병동 공룡', description: '라그의 기본 병동 스킨', symbol: '공', swatch: '#73b85d', unlock: { kind: 'starter' } },
  { id: 'skin-monkey-ward', slot: 'skin', characterId: 'character-monkey', label: '병동 원숭이', description: '몽키의 기본 병동 스킨', symbol: '원', swatch: '#8d5c42', unlock: { kind: 'starter' } },
  { id: 'skin-gorilla-ward', slot: 'skin', characterId: 'character-gorilla', label: '병동 고릴라', description: '콩의 기본 병동 스킨', symbol: '고', swatch: '#53606d', unlock: { kind: 'starter' } },
] as const satisfies readonly CosmeticDefinition[];

const TURRET_SKINS = [
  { id: 'turret-basic-ward', slot: 'turret', turretKind: 'basic-turret', label: '수호포 · 병동형', description: '기본 수호 포탑의 표준 병동 외장', symbol: '수', swatch: '#62d7ff', unlock: { kind: 'starter' } },
  { id: 'turret-basic-toy', slot: 'turret', turretKind: 'basic-turret', label: '수호포 · 장난감', description: '둥근 별 장식과 크림색 포신', symbol: '별', swatch: '#f1b86b', unlock: { kind: 'points', price: 300 } },
  { id: 'turret-basic-pumpkin', slot: 'turret', turretKind: 'basic-turret', label: '수호포 · 호박등', description: '주황빛 눈이 반짝이는 호박 포대', symbol: '호', swatch: '#e87942', unlock: { kind: 'points', price: 520 } },
  { id: 'turret-rapid-firefly', slot: 'turret', turretKind: 'rapid-turret', label: '연사포 · 반딧불', description: '기본 청록 발광 연사 외장', symbol: '속', swatch: '#71e4d1', unlock: { kind: 'starter' } },
  { id: 'turret-rapid-candy', slot: 'turret', turretKind: 'rapid-turret', label: '연사포 · 캔디팝', description: '분홍·민트 쌍열 포신 디자인', symbol: '팝', swatch: '#ed86b5', unlock: { kind: 'points', price: 420 } },
  { id: 'turret-rapid-dragon', slot: 'turret', turretKind: 'rapid-turret', label: '연사포 · 꼬마용', description: '작은 뿔과 입 모양 포구', symbol: '용', swatch: '#8ccf72', unlock: { kind: 'points', price: 680 } },
  { id: 'turret-frost-snow', slot: 'turret', turretKind: 'frost-turret', label: '서리포 · 설원형', description: '기본 눈꽃 레이저 외장', symbol: '눈', swatch: '#91efff', unlock: { kind: 'starter' } },
  { id: 'turret-frost-globe', slot: 'turret', turretKind: 'frost-turret', label: '서리포 · 스노우볼', description: '투명 구체 속 작은 눈보라', symbol: '설', swatch: '#c4f4ff', unlock: { kind: 'points', price: 480 } },
  { id: 'turret-frost-crystal', slot: 'turret', turretKind: 'frost-turret', label: '서리포 · 수정꽃', description: '육각 결정이 회전하는 희귀 외장', symbol: '정', swatch: '#7fc8ff', unlock: { kind: 'points', price: 760 } },
  { id: 'turret-arc-storm', slot: 'turret', turretKind: 'arc-turret', label: '천둥포 · 폭풍형', description: '희귀 천둥포의 기본 외장', symbol: '뢰', swatch: '#cf79ff', unlock: { kind: 'starter' } },
  { id: 'turret-arc-idol', slot: 'turret', turretKind: 'arc-turret', label: '천둥포 · 구름신상', description: '구름 고리가 번개를 모은다', symbol: '운', swatch: '#b69cf2', unlock: { kind: 'points', price: 820 } },
  { id: 'turret-arc-crown', slot: 'turret', turretKind: 'arc-turret', label: '천둥포 · 왕실폭뢰', description: '왕관 코어가 빛나는 최상급 외장', symbol: '왕', swatch: '#f0bd63', unlock: { kind: 'points', price: 1_100 } },
] as const satisfies readonly CosmeticDefinition[];

export const COSMETIC_CATALOG = [...CHARACTERS, ...SKINS, ...TURRET_SKINS] as const satisfies readonly CosmeticDefinition[];

export const DEFAULT_APPEARANCE: AvatarAppearance = {
  character: 'character-bunny',
  skin: 'skin-bunny-ward',
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

export const defaultSkinForCharacter = (characterId: string): string =>
  `skin-${characterId.replace('character-', '')}-ward`;

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
  return {
    character: characterId,
    skin: skin?.slot === 'skin' && skin.characterId === characterId
      ? rawSkin
      : defaultSkinForCharacter(characterId),
  };
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
  return { character, skin: defaultSkinForCharacter(character) };
}
