import * as THREE from 'three';
import {
  DEFAULT_TURRET_SKINS,
  cosmeticById,
} from '../../shared/customization';
import type {
  AvatarAppearance,
  BuildingKind,
  BuildingState,
  ConsumableId,
  TurretSkinLoadout,
} from '../../shared/types';
import { cosmeticProductUrl } from './CosmeticAssets';
import { createBuildingModel, createTurretPreviewModel } from './ThreeGameView';

const WIDTH = 256;
const HEIGHT = 210;
const thumbnailCache = new Map<string, string>();

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Line) && !(child instanceof THREE.Sprite)) return;
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose();
      material.dispose();
    }
  });
}

const material = (color: number, emissive = 0): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: emissive ? 0.72 : 0,
    roughness: 0.48,
    metalness: 0.2,
  });

function mesh(
  geometry: THREE.BufferGeometry,
  color: number,
  position: [number, number, number],
  emissive = 0,
): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material(color, emissive));
  result.position.set(...position);
  result.castShadow = true;
  return result;
}

/**
 * 설치 모달은 전투 중에도 열리므로 WebGL 컨텍스트가 잠깐 복구 중일 수 있다.
 * 그 경우에도 카드가 빈 원으로 남지 않도록, 실제 설비 실루엣을 닮은 SVG를
 * 먼저 표시하고 3D 캡처가 성공하면 그 이미지로 교체한다.
 */
function buildingFallbackArt(kind: BuildingKind): string {
  const art: Record<BuildingKind, { accent: string; detail: string }> = {
    bed: { accent: '#78dff1', detail: '<rect x="48" y="82" width="160" height="56" rx="14" fill="#6ba7c5"/><rect x="59" y="66" width="54" height="32" rx="11" fill="#eff5f4"/><path d="M48 120v37m160-37v37" stroke="#d7b37a" stroke-width="12" stroke-linecap="round"/>' },
    'reinforced-door': { accent: '#f0b765', detail: '<path d="M73 154V45q55-35 110 0v109z" fill="#985c42" stroke="#ffd38a" stroke-width="9"/><path d="M97 62v81m31-97v108m31-92v81" stroke="#4b2e35" stroke-width="9"/><circle cx="161" cy="104" r="7" fill="#ffe09a"/>' },
    'basic-turret': { accent: '#62d7ff', detail: '<ellipse cx="128" cy="148" rx="61" ry="20" fill="#21495f"/><rect x="94" y="89" width="68" height="54" rx="17" fill="#64b9d3"/><path d="M126 102h74v19h-74z" fill="#d8f4f5" stroke="#2b718a" stroke-width="7"/><circle cx="128" cy="116" r="13" fill="#f3c866"/>' },
    'rapid-turret': { accent: '#71e4d1', detail: '<ellipse cx="128" cy="148" rx="61" ry="20" fill="#1d4d55"/><rect x="91" y="94" width="74" height="48" rx="17" fill="#4aaf99"/><path d="M126 101h78m-78 18h78m-78 18h78" stroke="#d5fff2" stroke-width="9" stroke-linecap="round"/><circle cx="112" cy="118" r="8" fill="#f7d06b"/>' },
    'frost-turret': { accent: '#98e9ff', detail: '<ellipse cx="128" cy="148" rx="61" ry="20" fill="#21495f"/><path d="M86 139l15-54h54l15 54z" fill="#78c9e8"/><path d="M125 94v44m-22-22h44m-37-15l30 30m0-30l-30 30" stroke="#efffff" stroke-width="8" stroke-linecap="round"/>' },
    'arc-turret': { accent: '#c77df1', detail: '<ellipse cx="128" cy="148" rx="61" ry="20" fill="#322254"/><rect x="91" y="93" width="74" height="49" rx="16" fill="#7453a9"/><path d="M130 76l-20 43h21l-10 36 34-50h-22l11-29z" fill="#ffe078" stroke="#fff2b2" stroke-width="4"/>' },
    'golden-turret': { accent: '#f2bf53', detail: '<ellipse cx="128" cy="148" rx="67" ry="22" fill="#5c3b13"/><path d="M84 141V89l18 12 26-34 26 34 18-12v52z" fill="#e3a93e" stroke="#ffe59a" stroke-width="8"/><path d="M128 79v55m-25-25h50" stroke="#fff2bd" stroke-width="8"/><circle cx="128" cy="109" r="10" fill="#fff6ce"/>' },
    generator: { accent: '#e0d66c', detail: '<rect x="64" y="55" width="128" height="104" rx="18" fill="#708f5a" stroke="#d9eb9a" stroke-width="8"/><path d="M137 66l-36 49h26l-8 34 37-53h-26z" fill="#ffe06b"/><path d="M81 76h20m-20 54h20m76-54h-20m20 54h-20" stroke="#294238" stroke-width="8" stroke-linecap="round"/>' },
    'repair-drone': { accent: '#7ee5d5', detail: '<circle cx="128" cy="108" r="45" fill="#4c9c99" stroke="#baffed" stroke-width="8"/><path d="M128 75v66m-33-33h66" stroke="#f3fff7" stroke-width="13" stroke-linecap="round"/><path d="M58 81h26m72 0h26M58 135h26m72 0h26" stroke="#c4efe4" stroke-width="10" stroke-linecap="round"/>' },
    'electric-coil': { accent: '#74dcff', detail: '<path d="M75 148V86m26 62V70m27 78V62m26 86V70m27 78V86" stroke="#4db7dd" stroke-width="12" stroke-linecap="round"/><path d="M83 116h91" stroke="#eefcff" stroke-width="8"/><path d="M126 52l-18 45h20l-8 38 30-48h-20l10-35z" fill="#f2e47d"/>' },
    'floor-trap': { accent: '#f08686', detail: '<path d="M63 145h130l-14-56H77z" fill="#86434b" stroke="#f5a5a5" stroke-width="8"/><path d="M83 115l11-25 11 25 11-25 12 25 11-25 11 25 11-25 11 25" fill="none" stroke="#f4e9d4" stroke-width="10" stroke-linejoin="round"/>' },
    'shield-device': { accent: '#9d91f0', detail: '<path d="M128 49l57 20v42c0 35-25 58-57 71-32-13-57-36-57-71V69z" fill="#6659a4" stroke="#d6d0ff" stroke-width="9"/><path d="M128 75v70m-30-35h60" stroke="#efedff" stroke-width="10" stroke-linecap="round"/>' },
    'lucky-machine': { accent: '#f2b85c', detail: '<rect x="72" y="42" width="112" height="122" rx="17" fill="#ab6249" stroke="#ffd384" stroke-width="8"/><rect x="87" y="61" width="82" height="43" rx="8" fill="#2b5065"/><circle cx="109" cy="82" r="12" fill="#f17b79"/><circle cx="147" cy="82" r="12" fill="#7de6cf"/><rect x="99" y="121" width="58" height="18" rx="7" fill="#f6ce66"/>' },
    'gem-core': { accent: '#69e7ff', detail: '<path d="M128 42l48 55-48 65-48-65z" fill="#35aeca" stroke="#c7f9ff" stroke-width="9"/><path d="M128 42v120M80 97h96" stroke="#e9ffff" stroke-width="6" opacity=".8"/><ellipse cx="128" cy="149" rx="70" ry="17" fill="none" stroke="#69e7ff" stroke-width="8"/>' },
    'ghost-net': { accent: '#f4d36d', detail: '<circle cx="128" cy="108" r="57" fill="#564b31" stroke="#ffe899" stroke-width="9"/><path d="M88 68l80 80M168 68l-80 80M128 51v114M71 108h114" stroke="#fff0b0" stroke-width="7"/><circle cx="128" cy="108" r="25" fill="none" stroke="#f4d36d" stroke-width="7"/>' },
    'range-amplifier': { accent: '#8bafff', detail: '<path d="M128 155V78" stroke="#dfe8ff" stroke-width="12"/><path d="M99 138h58" stroke="#52699e" stroke-width="16" stroke-linecap="round"/><path d="M132 103c25-11 39-29 43-52M124 103C99 92 85 74 81 51" fill="none" stroke="#8bafff" stroke-width="9" stroke-linecap="round"/><circle cx="128" cy="96" r="12" fill="#fff2a6"/>' },
    'starter-grave': { accent: '#8b97a5', detail: '<path d="M83 157V86c0-29 20-47 45-47s45 18 45 47v71z" fill="#667380" stroke="#c5d0d8" stroke-width="9"/><path d="M128 68v59m-23-36h46" stroke="#303842" stroke-width="10" stroke-linecap="round"/><path d="M63 158h130" stroke="#414b55" stroke-width="18" stroke-linecap="round"/>' },
  };
  const spec = art[kind];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 190"><defs><radialGradient id="g"><stop stop-color="${spec.accent}" stop-opacity=".52"/><stop offset="1" stop-color="#08111d" stop-opacity="0"/></radialGradient></defs><rect width="256" height="190" rx="26" fill="#091521"/><ellipse cx="128" cy="142" rx="95" ry="55" fill="url(#g)"/>${spec.detail}<ellipse cx="128" cy="166" rx="76" ry="9" fill="#031019" fill-opacity=".62"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/** 상점 보급품도 텍스트 기호가 아니라 식별 가능한 작은 3D 물체로 표시한다. */
function createSupplyModel(id: ConsumableId): THREE.Group {
  const root = new THREE.Group();
  const steel = 0xb9c8d3;
  const dark = 0x223142;
  const cyan = 0x62e4eb;
  const gold = 0xf1bf58;
  const red = 0xe45e68;
  if (id === 'scout-flare') {
    root.add(mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.9, 14), red, [0, 0.45, 0], 0x61151c));
    root.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.16, 12), gold, [0, 0.98, 0], 0x7b4700));
    root.rotation.z = -0.28;
  } else if (id === 'path-chalk') {
    for (const [index, color] of [cyan, gold, 0xeef5f1].entries()) {
      const stick = mesh(new THREE.CapsuleGeometry(0.075, 0.62, 5, 10), color, [(index - 1) * 0.22, 0.33, 0]);
      stick.rotation.z = (index - 1) * 0.16;
      root.add(stick);
    }
  } else if (id === 'adrenal-shot') {
    const barrel = mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.72, 16), 0xdbeefa, [0, 0.5, 0]);
    barrel.rotation.z = -0.55;
    root.add(barrel, mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.45, 12), red, [0.25, 0.82, 0], 0x64151c));
    const needle = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.55, 8), steel, [-0.3, 0.1, 0]);
    needle.rotation.z = -0.55;
    root.add(needle);
  } else if (id === 'quiet-slippers') {
    for (const x of [-0.22, 0.22]) {
      const slipper = mesh(new THREE.SphereGeometry(0.24, 16, 10), cyan, [x, 0.25, x * 0.3]);
      slipper.scale.set(0.72, 0.48, 1.35);
      root.add(slipper);
    }
  } else if (id === 'room-beacon') {
    root.add(mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.22, 16), dark, [0, 0.12, 0]));
    root.add(mesh(new THREE.CylinderGeometry(0.17, 0.24, 0.68, 16), cyan, [0, 0.54, 0], 0x166c74));
    const ring = mesh(new THREE.TorusGeometry(0.34, 0.045, 8, 28), gold, [0, 0.88, 0], 0x674300);
    ring.rotation.x = Math.PI / 2;
    root.add(ring);
  } else if (id === 'quick-mortar') {
    root.add(mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.62, 16), 0x718a95, [0, 0.32, 0]));
    root.add(mesh(new THREE.TorusGeometry(0.34, 0.04, 7, 24), steel, [0, 0.64, 0]));
    root.add(mesh(new THREE.SphereGeometry(0.13, 12, 8), gold, [0, 0.77, 0]));
  } else if (id === 'hinge-brace') {
    for (const angle of [-0.62, 0.62]) {
      const bar = mesh(new THREE.BoxGeometry(0.16, 1.05, 0.12), steel, [0, 0.5, 0]);
      bar.rotation.z = angle;
      root.add(bar);
    }
    root.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.22, 14), gold, [0, 0.5, -0.02]));
  } else if (id === 'ward-seal') {
    root.add(mesh(new THREE.BoxGeometry(0.62, 0.92, 0.08), 0xe7d09c, [0, 0.48, 0]));
    root.add(mesh(new THREE.TorusGeometry(0.18, 0.045, 7, 22), red, [0, 0.48, -0.07], 0x65121b));
    for (const x of [-0.36, 0.36]) root.add(mesh(new THREE.CylinderGeometry(0.075, 0.075, 1.08, 10), dark, [x, 0.48, 0]));
  } else if (id === 'repair-window') {
    const rim = mesh(new THREE.TorusGeometry(0.4, 0.08, 10, 30), cyan, [0, 0.5, 0], 0x155f66);
    root.add(rim);
    const hand = mesh(new THREE.BoxGeometry(0.06, 0.42, 0.06), gold, [0, 0.64, -0.04]);
    hand.rotation.z = -0.7;
    root.add(hand, mesh(new THREE.BoxGeometry(0.28, 0.06, 0.06), steel, [0.1, 0.48, -0.04]));
  } else if (id === 'last-latch') {
    root.add(mesh(new THREE.BoxGeometry(0.62, 0.52, 0.22), gold, [0, 0.28, 0]));
    const shackle = mesh(new THREE.TorusGeometry(0.25, 0.07, 8, 24, Math.PI), steel, [0, 0.62, 0]);
    shackle.rotation.z = Math.PI;
    root.add(shackle, mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.24, 10), dark, [0, 0.29, -0.14]));
  } else if (id === 'emergency-bedroll') {
    const roll = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.8, 18), 0x587aa0, [0, 0.35, 0]);
    roll.rotation.z = Math.PI / 2;
    root.add(roll);
    for (const x of [-0.25, 0.25]) root.add(mesh(new THREE.TorusGeometry(0.31, 0.035, 7, 20), gold, [x, 0.35, 0]));
  } else if (id === 'echo-lens') {
    const rim = mesh(new THREE.TorusGeometry(0.36, 0.07, 10, 28), cyan, [0, 0.5, 0], 0x155f66);
    root.add(rim, mesh(new THREE.CircleGeometry(0.3, 24), 0x395b73, [0, 0.5, -0.02], 0x143845));
    root.add(mesh(new THREE.SphereGeometry(0.09, 12, 8), gold, [0.18, 0.68, -0.08], 0x6a4700));
  } else if (id === 'moon-compass') {
    root.add(mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.16, 20), dark, [0, 0.15, 0]));
    root.add(mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.04, 20), 0xd7e9e6, [0, 0.26, -0.02]));
    const needle = mesh(new THREE.BoxGeometry(0.06, 0.4, 0.05), red, [0.02, 0.285, -0.08]);
    needle.rotation.z = -0.65;
    root.add(needle, mesh(new THREE.SphereGeometry(0.055, 10, 8), gold, [0, 0.29, -0.11]));
  } else if (id === 'sprint-candy') {
    const candy = mesh(new THREE.CapsuleGeometry(0.13, 0.58, 6, 12), 0xff6687, [0, 0.47, 0], 0x60182e);
    candy.rotation.z = -0.44;
    root.add(candy);
    for (const x of [-0.27, 0.27]) {
      const wrap = mesh(new THREE.ConeGeometry(0.14, 0.23, 5), cyan, [x, x < 0 ? 0.35 : 0.58, 0]);
      wrap.rotation.z = -0.96;
      root.add(wrap);
    }
  } else if (id === 'mist-cape') {
    const cape = mesh(new THREE.ConeGeometry(0.38, 0.82, 5, 1, true), 0x9f9dea, [0, 0.42, 0], 0x2e2a67);
    cape.scale.z = 0.38;
    root.add(cape, mesh(new THREE.SphereGeometry(0.13, 12, 8), 0xe7d9f5, [0, 0.89, -0.02]));
  } else if (id === 'rescue-whistle') {
    const whistle = mesh(new THREE.CapsuleGeometry(0.11, 0.5, 5, 10), steel, [0, 0.42, 0]);
    whistle.rotation.z = -0.5;
    root.add(whistle);
    const loop = mesh(new THREE.TorusGeometry(0.15, 0.028, 7, 20), gold, [-0.19, 0.72, 0]);
    loop.rotation.x = Math.PI / 2;
    root.add(loop, mesh(new THREE.BoxGeometry(0.1, 0.07, 0.08), dark, [0.13, 0.18, -0.03]));
  } else if (id === 'patch-paste') {
    const tube = mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.65, 14), 0x6ec9a4, [0, 0.42, 0]);
    tube.rotation.z = -0.22;
    root.add(tube, mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 12), steel, [-0.1, 0.08, 0]));
    root.add(mesh(new THREE.SphereGeometry(0.12, 12, 8), 0xe7f3ed, [0.16, 0.77, -0.03]));
  } else if (id === 'steel-rivet') {
    for (const [x, y] of [[-0.18, 0.27], [0.18, 0.27], [-0.18, 0.65], [0.18, 0.65]] as Array<[number, number]>) {
      root.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.32, 10), steel, [x, y, 0]));
      root.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.045, 10), gold, [x, y + 0.17, -0.02]));
    }
  } else if (id === 'ice-seal') {
    root.add(mesh(new THREE.BoxGeometry(0.58, 0.8, 0.08), 0xd8f8ff, [0, 0.44, 0], 0x216d87));
    const seal = mesh(new THREE.TorusGeometry(0.16, 0.045, 7, 22), cyan, [0, 0.45, -0.07], 0x18798b);
    root.add(seal);
    for (const angle of [0, Math.PI / 3, (Math.PI * 2) / 3]) {
      const flake = mesh(new THREE.BoxGeometry(0.32, 0.028, 0.04), cyan, [0, 0.45, -0.08], 0x18798b);
      flake.rotation.z = angle;
      root.add(flake);
    }
  } else if (id === 'rewind-clock') {
    const rim = mesh(new THREE.TorusGeometry(0.38, 0.075, 10, 30), 0x9e86e7, [0, 0.5, 0], 0x38235c);
    root.add(rim, mesh(new THREE.CircleGeometry(0.3, 24), 0x3d4f72, [0, 0.5, -0.02]));
    const hand = mesh(new THREE.BoxGeometry(0.045, 0.34, 0.05), gold, [0.1, 0.58, -0.08]);
    hand.rotation.z = -0.8;
    root.add(hand);
  } else if (id === 'calibrator-key') {
    const stem = mesh(new THREE.BoxGeometry(0.12, 0.78, 0.1), steel, [0, 0.43, 0]);
    stem.rotation.z = -0.58;
    const jaw = mesh(new THREE.TorusGeometry(0.18, 0.055, 6, 18, Math.PI * 1.55), cyan, [-0.23, 0.73, 0], 0x165e69);
    jaw.rotation.z = -1.05;
    root.add(stem, jaw);
  } else if (id === 'turret-grease') {
    root.add(mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.54, 16), 0xf0b84e, [0, 0.28, 0], 0x634200));
    root.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.22, 12), dark, [0, 0.66, 0]));
    root.add(mesh(new THREE.TorusGeometry(0.1, 0.026, 7, 18), steel, [0, 0.76, 0]));
  } else if (id === 'pulse-solder') {
    const handle = mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.58, 14), red, [0, 0.33, 0], 0x61151c);
    handle.rotation.z = -0.45;
    const tip = mesh(new THREE.ConeGeometry(0.055, 0.48, 8), steel, [0.19, 0.64, 0]);
    tip.rotation.z = Math.PI * 0.28;
    root.add(handle, tip);
  } else if (id === 'spare-gears') {
    for (const [x, y, radius] of [[-0.16, 0.34, 0.18], [0.16, 0.58, 0.22]] as Array<[number, number, number]>) {
      const gear = mesh(new THREE.TorusGeometry(radius, 0.05, 8, 18), gold, [x, y, 0], 0x664300);
      root.add(gear, mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10), dark, [x, y, -0.04]));
    }
  } else if (id === 'copper-coil') {
    for (const y of [0.25, 0.37, 0.49, 0.61]) {
      const coil = mesh(new THREE.TorusGeometry(0.26, 0.035, 8, 24), 0xd57b43, [0, y, 0], 0x613018);
      coil.rotation.x = Math.PI / 2;
      root.add(coil);
    }
  } else if (id === 'lens-kit') {
    root.add(mesh(new THREE.BoxGeometry(0.68, 0.42, 0.2), dark, [0, 0.22, 0]));
    const lens = mesh(new THREE.TorusGeometry(0.19, 0.055, 8, 22), cyan, [0, 0.48, -0.08], 0x176977);
    root.add(lens, mesh(new THREE.CircleGeometry(0.14, 18), 0x4f96ad, [0, 0.48, -0.1], 0x154b61));
  } else if (id === 'welding-gel') {
    root.add(mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.64, 16), 0x58c2bd, [0, 0.34, 0], 0x155f60));
    root.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.13, 12), steel, [0, 0.72, 0]));
    root.add(mesh(new THREE.TorusGeometry(0.13, 0.028, 7, 18), gold, [0, 0.43, -0.22]));
  } else if (id === 'blueprint-chip') {
    root.add(mesh(new THREE.BoxGeometry(0.54, 0.7, 0.08), 0x527497, [0, 0.39, 0], 0x173751));
    for (const x of [-0.14, 0, 0.14]) root.add(mesh(new THREE.BoxGeometry(0.07, 0.4, 0.035), cyan, [x, 0.39, -0.07], 0x145566));
    root.add(mesh(new THREE.SphereGeometry(0.065, 10, 8), gold, [0, 0.63, -0.1], 0x634200));
  } else if (id === 'field-crane') {
    const mast = mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), gold, [-0.22, 0.47, 0], 0x624000);
    const boom = mesh(new THREE.BoxGeometry(0.66, 0.1, 0.1), gold, [0.08, 0.87, 0], 0x624000);
    const cable = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 6), steel, [0.37, 0.6, 0]);
    root.add(mast, boom, cable, mesh(new THREE.BoxGeometry(0.26, 0.12, 0.24), dark, [-0.22, 0.1, 0]));
  } else {
    const belt = mesh(new THREE.TorusGeometry(0.42, 0.095, 8, 28, Math.PI * 1.45), 0x76543d, [0, 0.5, 0]);
    belt.rotation.z = -0.7;
    root.add(belt, mesh(new THREE.BoxGeometry(0.38, 0.35, 0.2), gold, [0.28, 0.27, 0]));
    root.add(mesh(new THREE.BoxGeometry(0.1, 0.75, 0.1), steel, [-0.2, 0.62, 0]));
  }
  return root;
}

class ThumbnailRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, WIDTH / HEIGHT, 0.1, 30);
  private current: THREE.Object3D | null = null;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(1.25);
    this.renderer.setSize(WIDTH, HEIGHT, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.shadowMap.enabled = true;
    this.scene.add(new THREE.HemisphereLight(0xd8f4ff, 0x142032, 3));
    const key = new THREE.DirectionalLight(0xffeed7, 4.5);
    key.position.set(-2.4, 4, -3);
    this.scene.add(key);
    const rim = new THREE.PointLight(0x63e8f1, 8, 7, 2);
    rim.position.set(2.5, 1.6, 1.4);
    this.scene.add(rim);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(0.95, 40),
      new THREE.MeshPhysicalMaterial({ color: 0x14283a, roughness: 0.45, metalness: 0.18, transparent: true, opacity: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  render(key: string, object: THREE.Object3D, type: 'avatar' | 'turret' | 'building' | 'supply'): string {
    const cached = thumbnailCache.get(key);
    if (cached) {
      disposeObject(object);
      return cached;
    }
    if (this.current) {
      this.scene.remove(this.current);
      disposeObject(this.current);
    }
    this.current = object;
    this.scene.add(object);
    if (type === 'avatar') {
      // 귀·모자·꼬리까지 한 카드 안에 남도록 여백을 의도적으로 남긴다.
      object.scale.setScalar(0.76);
      object.rotation.y = -0.2;
      object.position.y = 0.02;
      this.camera.position.set(0, 0.88, -4.42);
      this.camera.lookAt(0, 0.84, 0);
    } else if (type === 'turret') {
      // 카드와 좌측 피팅룸은 동일한 정면 구도·모델을 사용한다. 위에서 내려다본
      // 기존 각도는 작은 카드에서 원형 받침대만 보이는 문제가 있었다.
      object.scale.setScalar(1.72);
      object.rotation.y = 0;
      object.position.y = 0.03;
      this.camera.position.set(0, 1.01, -4.05);
      this.camera.lookAt(0, 0.58, 0);
    } else if (type === 'supply') {
      // 보급품은 세로형 카드에서도 위·아래가 잘리지 않는 작은 정물 구도로 통일한다.
      object.scale.setScalar(1.04);
      object.rotation.y = -0.3;
      object.position.y = 0.02;
      this.camera.position.set(1.75, 1.12, -4.15);
      this.camera.lookAt(0, 0.42, 0);
    } else {
      object.scale.setScalar(1.62);
      object.rotation.y = -0.52;
      object.position.y = 0.03;
      this.camera.position.set(2.05, 1.45, -3.25);
      this.camera.lookAt(0, 0.42, 0);
    }
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const image = this.renderer.domElement.toDataURL('image/webp', 0.84);
    thumbnailCache.set(key, image);
    return image;
  }
}

let renderer: ThumbnailRenderer | null = null;

const getRenderer = (): ThumbnailRenderer => (renderer ??= new ThumbnailRenderer());

function buildingState(kind: BuildingKind, skinId = ''): BuildingState {
  return {
    id: `catalog:${kind}`,
    kind,
    roomId: 'catalog',
    ownerId: 'catalog',
    skinId,
    tile: { x: 0, y: 0 },
    level: 1,
    cooldown: 0,
    hp: 100,
  };
}

function setImage(image: HTMLImageElement, source: string): void {
  if (!image.isConnected) return;
  image.src = source;
  image.classList.add('ready');
}

export interface CatalogArtOptions {
  appearance?: AvatarAppearance;
  turretSkins?: TurretSkinLoadout;
}

interface CatalogArtHost {
  querySelectorAll<E extends Element = Element>(selectors: string): NodeListOf<E>;
}

/** 현재 화면에 있는 카드만 실제 게임 모델로 그려, 모바일 WebGL 부하를 제한한다. */
export function hydrateCatalogArt(host: CatalogArtHost, options: CatalogArtOptions = {}): void {
  const turretSkins = options.turretSkins ?? DEFAULT_TURRET_SKINS;
  host.querySelectorAll<HTMLImageElement>('[data-cosmetic-art]').forEach((image) => {
    try {
      const id = image.dataset.cosmeticArt ?? '';
      const item = cosmeticById(id);
      if (!item) return;
      if (item.slot === 'turret' && item.turretKind) {
        const model = createTurretPreviewModel(item.turretKind, item.id);
        setImage(image, getRenderer().render(`turret:${id}`, model, 'turret'));
        return;
      }
      if (item.slot === 'character') {
        setImage(image, `/assets/sprites/survivors/${item.id}/concept.png`);
        return;
      }
      const productUrl = cosmeticProductUrl(item.id);
      if (productUrl) {
        setImage(image, productUrl);
        return;
      }
      setImage(image, `data:image/svg+xml;charset=UTF-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><circle cx="64" cy="64" r="36" fill="none" stroke="#82909a" stroke-width="7" opacity=".72"/></svg>')}`);
    } catch (error) {
      console.warn(`Cosmetic thumbnail unavailable: ${image.dataset.cosmeticArt ?? ''}`, error);
    }
  });
  host.querySelectorAll<HTMLImageElement>('[data-building-art]').forEach((image) => {
    const kind = image.dataset.buildingArt as BuildingKind;
    if (!kind) return;
    // 3D 캔버스가 일시적으로 복구 중이어도 설치 선택지 자체는 식별 가능해야 한다.
    setImage(image, buildingFallbackArt(kind));
    // 인게임은 이미 메인 Three.js 캔버스를 계속 렌더링한다. 모바일에서 두 번째
    // WebGL 캔버스를 열면 컨텍스트가 밀려 빈 배경만 남을 수 있으므로, 설치 모달은
    // 동일한 설비 실루엣의 SVG 카드 이미지를 안정적으로 사용한다.
    if (image.closest('[data-build-panel]')) return;
    try {
      const kind = image.dataset.buildingArt as BuildingKind;
      const skinId = kind in turretSkins ? turretSkins[kind as keyof TurretSkinLoadout] : '';
      const model = createBuildingModel(buildingState(kind, skinId)).root;
      setImage(image, getRenderer().render(`building:${kind}:${skinId}`, model, 'building'));
    } catch (error) {
      console.warn(`Building thumbnail unavailable: ${kind}`, error);
    }
  });
  host.querySelectorAll<HTMLImageElement>('[data-supply-art]').forEach((image) => {
    try {
      const id = image.dataset.supplyArt as ConsumableId;
      if (!id) return;
      setImage(image, getRenderer().render(`supply:${id}`, createSupplyModel(id), 'supply'));
    } catch (error) {
      console.warn(`Supply thumbnail unavailable: ${image.dataset.supplyArt ?? ''}`, error);
    }
  });
}
