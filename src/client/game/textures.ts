import Phaser from 'phaser';
import type { BuildingKind } from '../../shared/types';

function texture(scene: Phaser.Scene, key: string, width: number, height: number, draw: (graphics: Phaser.GameObjects.Graphics) => void): void {
  if (scene.textures.exists(key)) return;
  const graphics = scene.add.graphics();
  draw(graphics);
  graphics.generateTexture(key, width, height);
  graphics.destroy();
}

export function createRuntimeTextures(scene: Phaser.Scene): void {
  texture(scene, 'floor', 32, 32, (g) => {
    g.fillStyle(0x252a4a).fillRect(0, 0, 32, 32);
    g.fillStyle(0x2d3357).fillRect(1, 1, 30, 30);
    g.lineStyle(1, 0x3d456f, .4).strokeRect(.5, .5, 31, 31);
    g.fillStyle(0xffffff, .035).fillCircle(7, 8, 2).fillCircle(25, 21, 1);
  });
  texture(scene, 'corridor', 32, 32, (g) => {
    g.fillStyle(0x151a35).fillRect(0, 0, 32, 32);
    g.fillStyle(0x1d2342).fillRect(1, 1, 30, 30);
    g.lineStyle(1, 0x55618f, .28).lineBetween(0, 16, 32, 16);
    g.fillStyle(0x6c72b4, .09).fillRoundedRect(7, 5, 18, 22, 4);
  });
  texture(scene, 'wall', 32, 32, (g) => {
    g.fillStyle(0x080a18, .7).fillRoundedRect(3, 5, 29, 27, 5);
    g.fillStyle(0x55567b).fillRoundedRect(1, 1, 29, 27, 5);
    g.fillStyle(0x73769e).fillRoundedRect(3, 3, 25, 10, 3);
    g.lineStyle(2, 0x343750, .7).lineBetween(2, 15, 30, 15).lineBetween(10, 15, 10, 27).lineBetween(22, 3, 22, 14);
  });
  texture(scene, 'build-tile', 28, 28, (g) => {
    g.fillStyle(0x5be5ff, .055).fillRoundedRect(1, 1, 26, 26, 5);
    g.lineStyle(1, 0x5be5ff, .24).strokeRoundedRect(1, 1, 26, 26, 5);
    g.lineStyle(1, 0xffffff, .12).lineBetween(10, 14, 18, 14).lineBetween(14, 10, 14, 18);
  });
  texture(scene, 'bed', 42, 34, (g) => {
    g.fillStyle(0x090b18, .55).fillEllipse(22, 29, 38, 10);
    g.fillStyle(0x513e81).fillRoundedRect(3, 8, 36, 21, 6);
    g.fillStyle(0xa889e9).fillRoundedRect(5, 6, 34, 14, 5);
    g.fillStyle(0xe4d8ff).fillRoundedRect(7, 7, 12, 9, 4);
    g.fillStyle(0x6fe2e9, .65).fillRoundedRect(20, 9, 17, 8, 3);
    g.fillStyle(0x2d234a).fillRect(5, 26, 4, 6).fillRect(33, 26, 4, 6);
  });
  texture(scene, 'door', 30, 38, (g) => {
    g.fillStyle(0x080a18, .7).fillRoundedRect(4, 4, 26, 34, 4);
    g.fillStyle(0x8b5962).fillRoundedRect(1, 1, 26, 34, 4);
    g.fillStyle(0xc77f75).fillRoundedRect(4, 4, 20, 28, 3);
    g.lineStyle(2, 0x6b3b4d).strokeRoundedRect(7, 7, 14, 21, 2);
    g.fillStyle(0xffd36f).fillCircle(20, 18, 2);
  });
  texture(scene, 'player', 36, 48, (g) => {
    g.fillStyle(0x060712, .55).fillEllipse(18, 43, 28, 8);
    g.fillStyle(0xffffff).fillRoundedRect(8, 11, 20, 28, 9);
    g.fillStyle(0xdfe8ff).fillCircle(18, 10, 10);
    g.fillStyle(0x4b416c).fillRoundedRect(10, 5, 16, 7, 5);
    g.fillStyle(0xffffff).fillCircle(14, 10, 4).fillCircle(22, 10, 4);
    g.fillStyle(0x15152b).fillCircle(14, 10, 1.8).fillCircle(22, 10, 1.8);
    g.fillStyle(0xffffff).fillRoundedRect(3, 19, 7, 16, 4).fillRoundedRect(26, 19, 7, 16, 4);
    g.fillStyle(0x31294f).fillRoundedRect(9, 34, 7, 10, 3).fillRoundedRect(20, 34, 7, 10, 3);
    g.lineStyle(2, 0x25213f).strokeRoundedRect(8, 11, 20, 28, 9);
  });
  texture(scene, 'ghost', 56, 62, (g) => {
    g.fillStyle(0x03040d, .55).fillEllipse(28, 57, 44, 9);
    g.fillStyle(0x1b1838).fillRoundedRect(8, 8, 40, 42, 19);
    g.fillStyle(0x6656aa).fillRoundedRect(11, 7, 34, 39, 16);
    g.fillStyle(0x9d89dc, .46).fillEllipse(28, 18, 26, 20);
    g.fillStyle(0x0a0b1d).fillEllipse(21, 22, 9, 12).fillEllipse(36, 22, 9, 12);
    g.fillStyle(0xff6a96).fillCircle(22, 22, 3).fillCircle(35, 22, 3);
    g.fillStyle(0xffffff, .7).fillCircle(21, 21, 1).fillCircle(34, 21, 1);
    g.lineStyle(3, 0x2c244f).lineBetween(13, 41, 7, 55).lineBetween(23, 43, 20, 58).lineBetween(34, 43, 37, 58).lineBetween(44, 40, 50, 54);
    g.lineStyle(2, 0xc8baff, .35).strokeRoundedRect(11, 7, 34, 39, 16);
  });
  const ghostStyles = {
    wanderer: { robe: 0x2a203d, skin: 0xb6b0c5, eye: 0xff244f, accent: 0x5d335f },
    swift: { robe: 0x26151d, skin: 0xd5c2c2, eye: 0xffd15f, accent: 0x8d2435 },
    brute: { robe: 0x221b18, skin: 0x8f8b79, eye: 0xff3b2f, accent: 0x684128 },
    caster: { robe: 0x17152f, skin: 0x9e9ac4, eye: 0xc66cff, accent: 0x473986 },
    'twin-a': { robe: 0x252134, skin: 0xd0c9d8, eye: 0x5edfff, accent: 0x51406d },
    'twin-b': { robe: 0x301a29, skin: 0xc8b8c2, eye: 0xff537f, accent: 0x71344f },
  } as const;
  for (const [variant, style] of Object.entries(ghostStyles)) {
    texture(scene, `ghost-${variant}`, 68, 76, (g) => {
      const brute = variant === 'brute';
      const swift = variant === 'swift';
      g.fillStyle(0x010106, .65).fillEllipse(34, 70, brute ? 62 : 48, 10);
      g.fillStyle(0x06050b).fillTriangle(8, 69, 20, 31, 29, 70).fillTriangle(24, 70, 35, 28, 43, 72).fillTriangle(40, 70, 49, 32, 62, 69);
      g.fillStyle(style.robe).fillTriangle(brute ? 5 : 13, 66, 23, 25, brute ? 65 : 56, 66);
      g.fillStyle(style.accent, .8).fillTriangle(20, 63, 31, 31, 36, 67).fillTriangle(36, 67, 43, 30, 51, 64);
      g.lineStyle(brute ? 8 : 5, style.skin, .92).lineBetween(19, 34, swift ? 3 : 7, 59).lineBetween(49, 34, swift ? 66 : 61, 60);
      g.lineStyle(2, 0x170910, 1).lineBetween(swift ? 3 : 7, 59, 2, 67).lineBetween(swift ? 3 : 7, 59, 9, 68)
        .lineBetween(swift ? 66 : 61, 60, 58, 69).lineBetween(swift ? 66 : 61, 60, 67, 68);
      g.fillStyle(style.skin).fillEllipse(34, 23, brute ? 38 : 31, brute ? 35 : 38);
      g.fillStyle(0x08060c).fillTriangle(15, 19, 19, 2, 27, 13).fillTriangle(24, 12, 33, 0, 39, 13).fillTriangle(38, 12, 50, 3, 49, 21);
      g.fillStyle(0x08060c).fillEllipse(27, 22, brute ? 11 : 9, 14).fillEllipse(42, 22, brute ? 11 : 9, 14);
      g.fillStyle(style.eye).fillCircle(28, 24, 2.6).fillCircle(41, 24, 2.6);
      g.fillStyle(0xffffff, .9).fillCircle(27, 23, .8).fillCircle(40, 23, .8);
      g.fillStyle(0x18050a).fillEllipse(34, 36, brute ? 18 : 15, brute ? 12 : 10);
      g.fillStyle(0xf1e8dc).fillTriangle(27, 32, 31, 32, 29, 38).fillTriangle(33, 31, 37, 31, 35, 38).fillTriangle(39, 32, 43, 32, 41, 38);
      if (variant === 'caster') {
        g.lineStyle(2, style.eye, .8).strokeCircle(34, 25, 23).lineBetween(12, 25, 56, 25).lineBetween(34, 2, 34, 48);
      }
      if (variant.startsWith('twin')) {
        g.lineStyle(2, 0x351324, 1).lineBetween(20, 12, 47, 42);
        if (variant === 'twin-b') g.lineStyle(2, 0xffffff, .7).arc(34, 34, 10, .2, Math.PI - .2);
      }
      g.lineStyle(1, 0xf4efff, .2).strokeEllipse(34, 23, brute ? 38 : 31, brute ? 35 : 38);
    });
  }
  texture(scene, 'hit', 32, 32, (g) => {
    g.lineStyle(3, 0xffe591, .9).lineBetween(16, 1, 16, 10).lineBetween(16, 22, 16, 31).lineBetween(1, 16, 10, 16).lineBetween(22, 16, 31, 16);
    g.fillStyle(0xff668c, .7).fillCircle(16, 16, 7);
  });
  texture(scene, 'bullet', 12, 12, (g) => {
    g.fillStyle(0x5be5ff, .25).fillCircle(6, 6, 6);
    g.fillStyle(0xf3feff).fillCircle(6, 6, 3);
  });
  texture(scene, 'bullet-shell', 18, 8, (g) => {
    g.fillStyle(0xff9d4f, .25).fillEllipse(5, 4, 10, 8);
    g.fillStyle(0xffe09b).fillRoundedRect(5, 1, 11, 6, 3);
    g.fillStyle(0xffffff).fillCircle(15, 4, 2);
  });
  texture(scene, 'bullet-rapid', 14, 6, (g) => {
    g.fillStyle(0x63e8ff, .3).fillRoundedRect(0, 0, 14, 6, 3);
    g.fillStyle(0xf3feff).fillRoundedRect(5, 1, 8, 4, 2);
  });

  const icons: Record<Exclude<BuildingKind, 'bed' | 'reinforced-door'>, number> = {
    'basic-turret': 0x62d7ff, 'rapid-turret': 0xffcb66, 'frost-turret': 0x9be9ff, generator: 0x73efa0,
    'arc-turret': 0xf2b2ff,
    'repair-drone': 0xff8eb3, 'electric-coil': 0xc58cff, 'floor-trap': 0xe06d73, 'shield-device': 0x94a9ff,
    'lucky-machine': 0xff6b9d,
  };
  for (const [kind, color] of Object.entries(icons)) {
    texture(scene, `building-${kind}`, 38, 38, (g) => {
      g.fillStyle(0x050712, .55).fillEllipse(20, 33, 32, 8);
      g.fillStyle(0x292d51).fillCircle(19, 20, 15);
      g.fillStyle(color).fillCircle(19, 18, 11);
      g.fillStyle(0xffffff, .55).fillCircle(16, 15, 4);
      g.lineStyle(3, 0x15172d).strokeCircle(19, 18, 11);
      if (kind.includes('turret')) g.fillStyle(0x252743).fillRoundedRect(17, 1, 5, 14, 2);
      if (kind === 'generator') g.lineStyle(2, 0xffffff, .75).lineBetween(18, 9, 14, 18).lineBetween(14, 18, 21, 18).lineBetween(21, 18, 17, 27);
      if (kind === 'repair-drone') g.lineStyle(2, 0xffffff, .8).lineBetween(12, 18, 26, 18).lineBetween(19, 11, 19, 25);
      if (kind === 'floor-trap') g.fillStyle(0x1b1932).fillTriangle(8, 29, 15, 16, 19, 29).fillTriangle(18, 29, 25, 15, 29, 29);
      if (kind === 'lucky-machine') g.fillStyle(0x130f27).fillRect(13, 13, 12, 12).fillStyle(0xffffff).fillCircle(19, 19, 3);
    });
  }
  texture(scene, 'minimap-human', 10, 10, (g) => g.fillStyle(0x5be5ff).fillCircle(5, 5, 4).lineStyle(1, 0xffffff).strokeCircle(5, 5, 4));
  texture(scene, 'minimap-ghost', 12, 12, (g) => g.fillStyle(0xff668c).fillTriangle(6, 1, 11, 11, 1, 11));
}
