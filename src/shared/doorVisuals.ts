export type DoorVisualStyle =
  | 'wood'
  | 'rusted-steel'
  | 'weathered-steel'
  | 'red-steel'
  | 'iron-bars'
  | 'luminous-bars'
  | 'steel-titanium'
  | 'silver-titanium'
  | 'gold-titanium'
  | 'diamond-titanium';

export interface DoorVisual {
  level: number;
  label: string;
  style: DoorVisualStyle;
  frameColor: number;
  panelColor: number;
  accentColor: number;
  emissiveColor: number;
  metalness: number;
  roughness: number;
}

// 기본 문 단계는 10개다. 등급 보상으로 단계를 늘릴 때는 이 배열과
// DOOR_HP를 같은 순서로 추가하면 클라이언트 외형도 자동으로 확장된다.
export const DOOR_VISUALS: readonly DoorVisual[] = [
  { level: 1, label: '나무 문', style: 'wood', frameColor: 0x4a2d1f, panelColor: 0x7a4b2d, accentColor: 0xc98a4b, emissiveColor: 0x2d1608, metalness: 0.03, roughness: 0.92 },
  { level: 2, label: '녹슨 강철문', style: 'rusted-steel', frameColor: 0x3a3431, panelColor: 0x70463a, accentColor: 0xc26c3e, emissiveColor: 0x38120a, metalness: 0.56, roughness: 0.76 },
  { level: 3, label: '빛바랜 강철문', style: 'weathered-steel', frameColor: 0x45515a, panelColor: 0x60707a, accentColor: 0xa9b4b5, emissiveColor: 0x1b2a31, metalness: 0.62, roughness: 0.6 },
  { level: 4, label: '빨간 강철문', style: 'red-steel', frameColor: 0x4b2228, panelColor: 0x9e3137, accentColor: 0xff8a65, emissiveColor: 0x4a070b, metalness: 0.64, roughness: 0.5 },
  { level: 5, label: '단단한 철창', style: 'iron-bars', frameColor: 0x262d35, panelColor: 0x38424d, accentColor: 0x8492a1, emissiveColor: 0x101820, metalness: 0.78, roughness: 0.38 },
  { level: 6, label: '빛나는 철창', style: 'luminous-bars', frameColor: 0x20343a, panelColor: 0x345760, accentColor: 0x7ff2df, emissiveColor: 0x14665e, metalness: 0.72, roughness: 0.3 },
  { level: 7, label: '강철 티타늄', style: 'steel-titanium', frameColor: 0x263948, panelColor: 0x466479, accentColor: 0x93c4dd, emissiveColor: 0x1a415c, metalness: 0.84, roughness: 0.26 },
  { level: 8, label: '은빛 티타늄', style: 'silver-titanium', frameColor: 0x667887, panelColor: 0xb5c7d0, accentColor: 0xf1fbff, emissiveColor: 0x557786, metalness: 0.9, roughness: 0.2 },
  { level: 9, label: '금빛 티타늄', style: 'gold-titanium', frameColor: 0x704d13, panelColor: 0xd5a833, accentColor: 0xffef9a, emissiveColor: 0x765400, metalness: 0.88, roughness: 0.18 },
  { level: 10, label: '다이아 티타늄', style: 'diamond-titanium', frameColor: 0x25566e, panelColor: 0x73ddf4, accentColor: 0xe6ffff, emissiveColor: 0x168cb8, metalness: 0.94, roughness: 0.12 },
];

export function doorVisualForLevel(level: number): DoorVisual {
  const index = Math.max(0, Math.min(DOOR_VISUALS.length - 1, Math.floor(level) - 1));
  return DOOR_VISUALS[index] as DoorVisual;
}
