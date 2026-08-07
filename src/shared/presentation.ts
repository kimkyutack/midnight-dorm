export type PresentationCategory = 'nameplate' | 'background';
export type PresentationCurrency = 'points' | 'cash';

export interface NameplatePalette {
  edge: string;
  fill: string;
  center: string;
  text: string;
  glow: string;
  motif: 'diamond' | 'wing' | 'star' | 'gear' | 'wave';
}

export interface PresentationDefinition {
  id: string;
  category: PresentationCategory;
  label: string;
  description: string;
  currency: PresentationCurrency;
  price: number;
  imageUrl: string;
  backgroundUrl?: string;
  nameplate?: NameplatePalette;
}

const nameplate = (
  id: string,
  label: string,
  description: string,
  currency: PresentationCurrency,
  price: number,
  palette: NameplatePalette,
): PresentationDefinition => ({
  id,
  category: 'nameplate',
  label,
  description,
  currency,
  price,
  imageUrl: `/assets/ui/nameplates/${id}.svg`,
  nameplate: palette,
});

const background = (
  id: string,
  label: string,
  description: string,
  currency: PresentationCurrency,
  price: number,
  asset: string,
): PresentationDefinition => ({
  id,
  category: 'background',
  label,
  description,
  currency,
  price,
  imageUrl: `/assets/home-backgrounds/${asset}.webp`,
  backgroundUrl: `/assets/home-backgrounds/${asset}.webp`,
});

export const NAMEPLATE_CATALOG = [
  nameplate('nameplate-night-watch', '야간 순찰대', '차분한 청록빛 병동 명찰', 'points', 600, { edge: '#73efff', fill: '#07162b', center: '#16476c', text: '#f5fdff', glow: '#47dff6', motif: 'diamond' }),
  nameplate('nameplate-ghost-mail', '유령 우편', '자주빛 봉인과 유령 문양 명찰', 'points', 850, { edge: '#e599ff', fill: '#160d2d', center: '#542a78', text: '#fff5ff', glow: '#c568f4', motif: 'wing' }),
  nameplate('nameplate-moon-clinic', '달빛 진료소', '초승달을 새긴 은청색 명찰', 'points', 1_100, { edge: '#bcecff', fill: '#0b1833', center: '#294f91', text: '#ffffff', glow: '#84c9ff', motif: 'star' }),
  nameplate('nameplate-rainy-detective', '비 오는 탐정', '금빛 단서가 반짝이는 명찰', 'points', 1_450, { edge: '#ffd47c', fill: '#171827', center: '#5c4529', text: '#fff7dc', glow: '#ffb347', motif: 'diamond' }),
  nameplate('nameplate-clockwork', '시계 병동', '청동 톱니가 맞물리는 명찰', 'points', 1_900, { edge: '#d9ad67', fill: '#151b25', center: '#5b4830', text: '#fff5df', glow: '#dca44a', motif: 'gear' }),
  nameplate('nameplate-neon-phantom', '네온 팬텀', '네온 파장이 흐르는 고급 명찰', 'cash', 350, { edge: '#76f8ff', fill: '#080b2e', center: '#313a9d', text: '#ffffff', glow: '#cf54ff', motif: 'wave' }),
  nameplate('nameplate-crystal-star', '크리스털 스타', '별 결정이 빛나는 고급 명찰', 'cash', 500, { edge: '#e4f7ff', fill: '#10194c', center: '#5577cb', text: '#fffce9', glow: '#a9d9ff', motif: 'star' }),
  nameplate('nameplate-abyssal-crown', '심연의 왕관', '흑염 왕관을 두른 고급 명찰', 'cash', 700, { edge: '#ff6a57', fill: '#140713', center: '#592047', text: '#fff1e9', glow: '#bf54ff', motif: 'wing' }),
  nameplate('nameplate-ocean-prism', '해저 프리즘', '파도와 진주광이 흐르는 고급 명찰', 'cash', 900, { edge: '#87f3ff', fill: '#061b31', center: '#147194', text: '#f0ffff', glow: '#52ddeb', motif: 'wave' }),
  nameplate('nameplate-celestial-gate', '천상의 관문', '별과 금빛 문장이 감도는 최상급 명찰', 'cash', 1_250, { edge: '#ffe59a', fill: '#151849', center: '#6b67b8', text: '#ffffff', glow: '#d6bdff', motif: 'star' }),
] as const satisfies readonly PresentationDefinition[];

export const HOME_BACKGROUND_CATALOG = [
  background('home-background-misty-ward', '안개 낀 병동 정원', '은은한 안개와 달빛이 흐르는 정원', 'points', 1_200, 'misty-ward-garden'),
  background('home-background-detective-alley', '심야 탐정 골목', '빗물 위 단서가 반짝이는 병원 골목', 'points', 1_500, 'detective-night-alley'),
  background('home-background-moonlit-greenhouse', '달빛 온실', '푸른 꽃과 작은 정령이 머무는 온실', 'points', 1_800, 'moonlit-greenhouse'),
  background('home-background-haunted-library', '유령 도서 병동', '마법책과 여우불이 떠도는 서고', 'points', 2_100, 'haunted-library'),
  background('home-background-candy-carnival', '사탕 유령 축제', '귀여운 유령이 모이는 밤의 축제', 'points', 2_500, 'candy-ghost-carnival'),
  background('home-background-neon-arcade', '네온 유령 오락실', '네온 캐비닛이 빛나는 프리미엄 공간', 'cash', 650, 'neon-ghost-arcade'),
  background('home-background-deep-sea', '심해 진료동', '해파리 조명이 비추는 수중 병원', 'cash', 850, 'deep-sea-infirmary'),
  background('home-background-clockwork', '태엽 심야 병동', '황동 톱니와 유령 램프의 기계 병동', 'cash', 1_050, 'clockwork-midnight-clinic'),
  background('home-background-snow-observatory', '설원 관측 병동', '오로라 아래 별을 관측하는 설원 병원', 'cash', 1_250, 'snowy-observatory'),
  background('home-background-celestial', '천상 성역 병원', '구름 위 별빛 관문이 열리는 최상급 배경', 'cash', 1_500, 'celestial-sanctuary'),
] as const satisfies readonly PresentationDefinition[];

export const PRESENTATION_CATALOG: readonly PresentationDefinition[] = [
  ...NAMEPLATE_CATALOG,
  ...HOME_BACKGROUND_CATALOG,
];

export function presentationById(id: string | null | undefined): PresentationDefinition | undefined {
  return id ? PRESENTATION_CATALOG.find((item) => item.id === id) : undefined;
}

export function presentationsForCategory(category: PresentationCategory): readonly PresentationDefinition[] {
  return PRESENTATION_CATALOG.filter((item) => item.category === category);
}

