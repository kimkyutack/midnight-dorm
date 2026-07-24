export type StageThemeId = 'hospital' | 'forest' | 'ice' | 'desert' | 'junkyard' | 'occult' | 'void';
export type StageDecor = StageThemeId;

export interface StageTheme {
  id: StageThemeId;
  label: string;
  decor: StageDecor;
  background: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  corridor: number;
  room: number;
  wall: number;
  wallCap: number;
  marker: number;
  respawn: number;
  bedFrame: number;
  bedBlanket: number;
  hemisphereSky: number;
  hemisphereGround: number;
  moon: number;
  lightA: number;
  lightB: number;
  /** Each surface has its own art: rooms, corridors, and raised walls must read apart. */
  corridorAsset: string;
  roomAsset: string;
  wallAsset: string;
}

export const STAGE_THEMES: Readonly<Record<StageThemeId, StageTheme>> = {
  hospital: {
    id: 'hospital', label: '폐쇄 정신병동', decor: 'hospital', background: 0x050812, fog: 0x050812, fogNear: 10, fogFar: 34,
    corridor: 0x1c2b3b, room: 0x243654, wall: 0x25374b, wallCap: 0x4b687b, marker: 0x5dc9df,
    respawn: 0x9b204d, bedFrame: 0x25314c, bedBlanket: 0x3e7890,
    hemisphereSky: 0x8fb8d5, hemisphereGround: 0x0a0714, moon: 0xb9dbf4, lightA: 0x72d9e8, lightB: 0x8887df,
    corridorAsset: '/assets/environment/hospital-corridor-tile-v2.png', roomAsset: '/assets/environment/hospital-room-tile-v2.png', wallAsset: '/assets/environment/hospital-wall-tile-v2.png',
  },
  forest: {
    id: 'forest', label: '안개 낀 산림', decor: 'forest', background: 0x06140f, fog: 0x102b21, fogNear: 10, fogFar: 36,
    corridor: 0x3b7968, room: 0x23624d, wall: 0x173d32, wallCap: 0x4d8b75, marker: 0x8edbbd,
    respawn: 0x7f1e36, bedFrame: 0x2f3429, bedBlanket: 0x416d54,
    hemisphereSky: 0x79b7a4, hemisphereGround: 0x060b08, moon: 0xa7d6c6, lightA: 0x66d49d, lightB: 0x7c9bc7,
    corridorAsset: '/assets/environment/forest-corridor-tile-v2.png', roomAsset: '/assets/environment/forest-room-tile-v2.png', wallAsset: '/assets/environment/forest-wall-tile-v2.png',
  },
  ice: {
    id: 'ice', label: '빙결 격리동', decor: 'ice', background: 0x06111b, fog: 0x0b2030, fogNear: 10, fogFar: 38,
    corridor: 0x19394b, room: 0x28536c, wall: 0x315d70, wallCap: 0x82b9c8, marker: 0xa0f4ff,
    respawn: 0x6c3159, bedFrame: 0x33566a, bedBlanket: 0x6cb5cc,
    hemisphereSky: 0xb4eaff, hemisphereGround: 0x07121d, moon: 0xe2f9ff, lightA: 0x78eaff, lightB: 0x9baeff,
    corridorAsset: '/assets/environment/ice-corridor-tile-v2.png', roomAsset: '/assets/environment/ice-room-tile-v2.png', wallAsset: '/assets/environment/ice-wall-tile-v2.png',
  },
  desert: {
    id: 'desert', label: '붉은 사막 유적', decor: 'desert', background: 0x160b07, fog: 0x2b160c, fogNear: 9, fogFar: 36,
    corridor: 0x4b3022, room: 0x6b4930, wall: 0x67452d, wallCap: 0xa87549, marker: 0xffc66f,
    respawn: 0x841f2b, bedFrame: 0x49372b, bedBlanket: 0x9a6841,
    hemisphereSky: 0xe2a978, hemisphereGround: 0x160906, moon: 0xffd5a0, lightA: 0xffa95f, lightB: 0xd8664c,
    corridorAsset: '/assets/environment/desert-corridor-tile-v2.png', roomAsset: '/assets/environment/desert-room-tile-v2.png', wallAsset: '/assets/environment/desert-wall-tile-v2.png',
  },
  junkyard: {
    id: 'junkyard', label: '폐기물 처리장', decor: 'junkyard', background: 0x0d0d0a, fog: 0x171813, fogNear: 8, fogFar: 31,
    corridor: 0x30342d, room: 0x41463a, wall: 0x44443a, wallCap: 0x786f55, marker: 0xc4d86a,
    respawn: 0x762833, bedFrame: 0x3f4137, bedBlanket: 0x68714b,
    hemisphereSky: 0xa8ae85, hemisphereGround: 0x0a0a07, moon: 0xd9d6aa, lightA: 0xb5d96c, lightB: 0xd18a53,
    corridorAsset: '/assets/environment/junkyard-corridor-tile-v2.png', roomAsset: '/assets/environment/junkyard-room-tile-v2.png', wallAsset: '/assets/environment/junkyard-wall-tile-v2.png',
  },
  occult: {
    id: 'occult', label: '금단 의식 연구소', decor: 'occult', background: 0x08040f, fog: 0x130822, fogNear: 9, fogFar: 34,
    corridor: 0x241935, room: 0x38254f, wall: 0x3e2b52, wallCap: 0x76538c, marker: 0xd28cff,
    respawn: 0xa01e5a, bedFrame: 0x34223f, bedBlanket: 0x714b82,
    hemisphereSky: 0xb99bd6, hemisphereGround: 0x08040c, moon: 0xe2c5ff, lightA: 0xca72ff, lightB: 0x5c8dff,
    corridorAsset: '/assets/environment/occult-corridor-tile-v2.png', roomAsset: '/assets/environment/occult-room-tile-v2.png', wallAsset: '/assets/environment/occult-wall-tile-v2.png',
  },
  void: {
    id: 'void', label: '공허의 성채', decor: 'void', background: 0x020106, fog: 0x080311, fogNear: 7, fogFar: 29,
    corridor: 0x161124, room: 0x25173b, wall: 0x2b1b40, wallCap: 0x725080, marker: 0xff6edb,
    respawn: 0xc01958, bedFrame: 0x24172d, bedBlanket: 0x5e356b,
    hemisphereSky: 0xa76ac6, hemisphereGround: 0x020104, moon: 0xffc5ef, lightA: 0xff5fc9, lightB: 0x675cff,
    corridorAsset: '/assets/environment/void-corridor-tile-v2.png', roomAsset: '/assets/environment/void-room-tile-v2.png', wallAsset: '/assets/environment/void-wall-tile-v2.png',
  },
};

export function stageThemeFor(stageId: string): StageTheme {
  const tier = stageId.split('-')[0];
  const themeId: StageThemeId = tier === 'nightmare' ? 'forest'
    : tier === 'hell' ? 'ice'
      : tier === 'inferno' ? 'desert'
        : tier === 'epic' ? 'junkyard'
          : tier === 'mythic' ? 'occult'
            : tier === 'legendary' ? 'void'
              : 'hospital';
  return STAGE_THEMES[themeId];
}
