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
  turretKind?: TurretKind;
}

export const COSMETIC_CATALOG = [
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

  { id: 'hat-rank', slot: 'hat', label: '등급 대표 모자', description: '현재 최고 등급에 맞춰 자동 진화', symbol: '등', swatch: '#d8c887', unlock: { kind: 'starter' } },
  { id: 'hat-beanie', slot: 'hat', label: '새벽 비니', description: '귀를 포근하게 덮는 니트 모자', symbol: '비', swatch: '#7d668f', unlock: { kind: 'points', price: 250 } },
  { id: 'hat-moon-cap', slot: 'hat', label: '초승달 캡', description: '작은 달 자수가 들어간 캡모자', symbol: '캡', swatch: '#426c91', unlock: { kind: 'points', price: 400 } },
  { id: 'hat-headlamp', slot: 'hat', label: '정찰 헤드램프', description: '어두운 복도에서 은은하게 빛난다', symbol: '빛', swatch: '#e2bc5d', unlock: { kind: 'points', price: 600 } },
  { id: 'hat-silver-crown', slot: 'hat', label: '은빛 작은 왕관', description: '초고수 등급 전용 왕관', symbol: '♛', swatch: '#c9d6e0', unlock: { kind: 'rank', rank: 'master' } },
  { id: 'hat-gold-crown', slot: 'hat', label: '황금 지휘관 왕관', description: '베테랑의 전투 기록을 상징한다', symbol: '♛', swatch: '#e8b24d', unlock: { kind: 'rank', rank: 'veteran' } },
  { id: 'hat-halo', slot: 'hat', label: '심연의 광륜', description: '레전드만 착용할 수 있는 발광 장식', symbol: '◎', swatch: '#ff79b5', unlock: { kind: 'rank', rank: 'legend' } },

  { id: 'outfit-pajamas', slot: 'outfit', label: '별무늬 잠옷', description: '병동에서 눈뜬 생존자의 기본 복장', symbol: '잠', swatch: '#6677a6', unlock: { kind: 'starter' } },
  { id: 'outfit-raincoat', slot: 'outfit', label: '노란 우비', description: '비와 안개를 막아주는 밝은 우비', symbol: '우', swatch: '#e1b842', unlock: { kind: 'points', price: 350 } },
  { id: 'outfit-campus', slot: 'outfit', label: '캠퍼스 재킷', description: '가볍고 활동하기 편한 야간 재킷', symbol: '교', swatch: '#4d806f', unlock: { kind: 'points', price: 500 } },
  { id: 'outfit-medic', slot: 'outfit', label: '새벽 의무복', description: '고수 등급 생존자의 구조 복장', symbol: '+', swatch: '#dce8e6', unlock: { kind: 'rank', rank: 'expert' } },
  { id: 'outfit-commander', slot: 'outfit', label: '지휘관 코트', description: '베테랑 전용 금장 코트', symbol: '장', swatch: '#3f344e', unlock: { kind: 'rank', rank: 'veteran' } },
  { id: 'outfit-starlight', slot: 'outfit', label: '별빛 후드', description: '어둠 속에서 가장자리가 은은히 빛난다', symbol: '별', swatch: '#5366b6', unlock: { kind: 'points', price: 950 } },
  { id: 'outfit-frog', slot: 'outfit', label: '개구리 탐험복', description: '연잎 배지와 볼록한 등 장식이 달린 점프슈트', symbol: '개', swatch: '#74b96a', unlock: { kind: 'points', price: 420 } },
  { id: 'outfit-bakery', slot: 'outfit', label: '새벽 제빵 앞치마', description: '주머니와 단추가 달린 크림색 작업복', symbol: '빵', swatch: '#d6a36c', unlock: { kind: 'points', price: 560 } },
  { id: 'outfit-detective', slot: 'outfit', label: '달빛 탐정 코트', description: '넓은 라펠과 허리띠가 있는 짧은 트렌치코트', symbol: '탐', swatch: '#8b7658', unlock: { kind: 'points', price: 700 } },
  { id: 'outfit-puffer', slot: 'outfit', label: '눈보라 패딩', description: '도톰한 퀼팅과 털 깃이 있는 방한복', symbol: '눈', swatch: '#4e89a8', unlock: { kind: 'points', price: 620 } },
  { id: 'outfit-astronaut', slot: 'outfit', label: '꼬마 우주 구조복', description: '조작 패널과 산소팩이 붙은 입체 우주복', symbol: '우', swatch: '#d9e4ed', unlock: { kind: 'points', price: 1_000 } },
  { id: 'outfit-vampire', slot: 'outfit', label: '밤의 백작 예복', description: '높은 깃과 두 갈래 망토가 있는 초고수 예복', symbol: '밤', swatch: '#641f42', unlock: { kind: 'rank', rank: 'master' } },

  { id: 'accessory-none', slot: 'accessory', label: '장신구 없음', description: '가볍게 병동으로 들어간다', symbol: '—', swatch: '#5c6470', unlock: { kind: 'starter' } },
  { id: 'accessory-scarf', slot: 'accessory', label: '체크 목도리', description: '달릴 때 살짝 흔들리는 목도리', symbol: '목', swatch: '#b05f68', unlock: { kind: 'points', price: 200 } },
  { id: 'accessory-backpack', slot: 'accessory', label: '미니 구조 가방', description: '작은 비상 물품이 들어 있는 가방', symbol: '백', swatch: '#6b5745', unlock: { kind: 'points', price: 350 } },
  { id: 'accessory-star', slot: 'accessory', label: '별빛 브로치', description: '고수 등급을 증명하는 작은 별', symbol: '★', swatch: '#8bd9e5', unlock: { kind: 'rank', rank: 'expert' } },
  { id: 'accessory-lantern', slot: 'accessory', label: '꼬마 유령 등불', description: '옆에서 둥실거리는 작은 등불', symbol: '불', swatch: '#8fe5d5', unlock: { kind: 'points', price: 700 } },

  { id: 'shoes-slippers', slot: 'shoes', label: '병동 슬리퍼', description: '조용히 움직이는 기본 신발', symbol: '슬', swatch: '#b6c4ca', unlock: { kind: 'starter' } },
  { id: 'shoes-sneakers', slot: 'shoes', label: '민트 운동화', description: '가벼운 색 배합의 작은 운동화', symbol: '운', swatch: '#65b7a5', unlock: { kind: 'points', price: 180 } },
  { id: 'shoes-boots', slot: 'shoes', label: '빗길 장화', description: '젖은 복도에서도 든든한 장화', symbol: '장', swatch: '#735d86', unlock: { kind: 'points', price: 320 } },
  { id: 'shoes-moon', slot: 'shoes', label: '달빛 구두', description: '초고수 등급 전용 은빛 구두', symbol: '달', swatch: '#b7ccec', unlock: { kind: 'rank', rank: 'master' } },
  { id: 'shoes-neon', slot: 'shoes', label: '네온 러너', description: '발뒤꿈치가 청록색으로 빛난다', symbol: '빛', swatch: '#4de1d1', unlock: { kind: 'points', price: 650 } },
  { id: 'shoes-bunny', slot: 'shoes', label: '토끼 얼굴 슬리퍼', description: '귀와 눈이 달린 폭신한 실내화', symbol: '토', swatch: '#efbfc7', unlock: { kind: 'points', price: 260 } },
  { id: 'shoes-duck', slot: 'shoes', label: '오리 주둥이 장화', description: '앞코가 주황색 부리처럼 튀어나온 장화', symbol: '오', swatch: '#e4c84d', unlock: { kind: 'points', price: 420 } },
  { id: 'shoes-roller', slot: 'shoes', label: '별바퀴 롤러', description: '작은 별 바퀴가 실제로 달린 롤러스케이트', symbol: '롤', swatch: '#d77eac', unlock: { kind: 'points', price: 720 } },
  { id: 'shoes-cloud', slot: 'shoes', label: '구름 통통 신발', description: '세 겹 구름 쿠션으로 둥실한 운동화', symbol: '구', swatch: '#d6edf2', unlock: { kind: 'points', price: 560 } },
  { id: 'shoes-armor', slot: 'shoes', label: '새벽 기사 부츠', description: '금속 발등과 발목 보호대가 있는 베테랑 장화', symbol: '갑', swatch: '#aeb8c3', unlock: { kind: 'rank', rank: 'veteran' } },

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

export const DEFAULT_APPEARANCE: AvatarAppearance = {
  character: 'character-bunny',
  hat: 'hat-rank',
  outfit: 'outfit-pajamas',
  accessory: 'accessory-none',
  shoes: 'shoes-slippers',
};

export const DEFAULT_TURRET_SKINS: TurretSkinLoadout = {
  'basic-turret': 'turret-basic-ward',
  'rapid-turret': 'turret-rapid-firefly',
  'frost-turret': 'turret-frost-snow',
  'arc-turret': 'turret-arc-storm',
};

export const STARTER_COSMETICS = COSMETIC_CATALOG
  .filter((item) => item.unlock.kind === 'starter')
  .map((item) => item.id);

export const cosmeticById = (id: string): CosmeticDefinition | undefined =>
  COSMETIC_CATALOG.find((item) => item.id === id);

export const cosmeticsForSlot = (slot: CosmeticSlot): readonly CosmeticDefinition[] =>
  COSMETIC_CATALOG.filter((item) => item.slot === slot);

export function cosmeticAvailable(item: CosmeticDefinition, rank: RankId, owned: readonly string[]): boolean {
  if (item.unlock.kind === 'starter') return true;
  if (item.unlock.kind === 'points') return owned.includes(item.id);
  return rankIndex(rank) >= rankIndex(item.unlock.rank);
}

export function normalizeAppearance(value: unknown): AvatarAppearance {
  const source = value && typeof value === 'object' ? value as Partial<Record<keyof AvatarAppearance, unknown>> : {};
  const result = { ...DEFAULT_APPEARANCE };
  for (const slot of Object.keys(result) as Array<keyof AvatarAppearance>) {
    const rawId = typeof source[slot] === 'string' ? source[slot] as string : '';
    // 초기 고가 캐릭터의 독수리 표기는 달호랑이로 교체했다. 이미 저장된
    // 프리뷰 선택값도 다음 로그인부터 자연스럽게 새 외형으로 이어진다.
    const id = rawId === 'character-eagle' ? 'character-tiger' : rawId;
    if (cosmeticById(id)?.slot === slot) result[slot] = id;
  }
  return result;
}

export function normalizeTurretSkins(value: unknown): TurretSkinLoadout {
  const source = value && typeof value === 'object' ? value as Partial<Record<TurretKind, unknown>> : {};
  const result = { ...DEFAULT_TURRET_SKINS };
  for (const kind of Object.keys(result) as TurretKind[]) {
    const id = typeof source[kind] === 'string' ? source[kind] as string : '';
    const item = cosmeticById(id);
    if (item?.slot === 'turret' && item.turretKind === kind) result[kind] = id;
  }
  return result;
}

export function customizationReward(stageIndex: number): number {
  return 80 + Math.min(420, Math.max(0, Math.floor(stageIndex)) * 4);
}

const BOT_CHARACTERS = ['character-cat', 'character-puppy', 'character-bear', 'character-hamster'] as const;
const BOT_OUTFITS = ['outfit-raincoat', 'outfit-campus', 'outfit-medic', 'outfit-pajamas'] as const;

export function botAppearance(index: number): AvatarAppearance {
  const safe = Math.abs(Math.floor(index));
  return {
    ...DEFAULT_APPEARANCE,
    character: BOT_CHARACTERS[safe % BOT_CHARACTERS.length] as string,
    outfit: BOT_OUTFITS[safe % BOT_OUTFITS.length] as string,
    hat: safe % 2 === 0 ? 'hat-beanie' : 'hat-moon-cap',
    shoes: safe % 2 === 0 ? 'shoes-sneakers' : 'shoes-boots',
  };
}
