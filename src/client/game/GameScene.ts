import Phaser from 'phaser';
import { BALANCE } from '../../shared/balance';
import type { BuildingState, GameEvent, GameSnapshot, GhostState, MapDefinition, PlayerState, Tile, Vec2 } from '../../shared/types';
import { createRuntimeTextures } from './textures';

const TILE = 32;

interface ScenePayload {
  map: MapDefinition;
  playerId: string;
  snapshot: GameSnapshot;
}

interface EntityView {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Sprite;
  hp: Phaser.GameObjects.Graphics;
  target: Vec2;
}

interface BuildingView {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Sprite;
  barrel: Phaser.GameObjects.Rectangle | null;
  level: Phaser.GameObjects.Text;
}

interface DragState {
  id: number;
  x: number;
  y: number;
  scrollX: number;
  scrollY: number;
  moved: boolean;
}

export interface SceneSelection {
  type: 'bed' | 'door' | 'building';
  targetId: string;
  roomId: string;
  buildingId?: string;
}

export class GameScene extends Phaser.Scene {
  private mapData!: MapDefinition;
  private playerId = '';
  private snapshotData!: GameSnapshot;
  private readonly playerViews = new Map<string, EntityView>();
  private readonly buildingViews = new Map<string, BuildingView>();
  private readonly doorViews = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly ghostViews = new Map<string, EntityView>();
  private localInput: Vec2 = { x: 0, y: 0 };
  private selectedTile: Tile | null = null;
  private selectionGraphics: Phaser.GameObjects.Graphics | null = null;
  private effects: Phaser.GameObjects.GameObject[] = [];
  private drag: DragState | null = null;
  private cameraInitialized = false;
  private focusedRoomId: string | null = null;

  constructor() { super('game'); }

  init(data: ScenePayload): void {
    this.mapData = data.map;
    this.playerId = data.playerId;
    this.snapshotData = data.snapshot;
  }

  create(): void {
    createRuntimeTextures(this);
    const camera = this.cameras.main;
    camera.setBackgroundColor(0x05060f).setBounds(0, 0, this.mapData.width * TILE, this.mapData.height * TILE).setZoom(1.45);
    this.drawMap();
    this.selectionGraphics = this.add.graphics().setDepth(15);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => this.beginDrag(pointer));
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => this.moveDrag(pointer));
    this.input.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => this.endDrag(pointer));
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, (pointer: Phaser.Input.Pointer) => this.endDrag(pointer));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.updateSnapshot(this.snapshotData, []);
  }

  override update(_time: number, delta: number): void {
    const factor = 1 - Math.exp(-delta / 75);
    for (const [id, view] of this.playerViews) {
      if (id === this.playerId && (this.localInput.x || this.localInput.y)) {
        view.container.x += this.localInput.x * BALANCE.player.speed * TILE * delta / 1_000;
        view.container.y += this.localInput.y * BALANCE.player.speed * TILE * delta / 1_000;
      }
      view.container.x = Phaser.Math.Linear(view.container.x, view.target.x * TILE + TILE / 2, id === this.playerId ? factor * .45 : factor);
      view.container.y = Phaser.Math.Linear(view.container.y, view.target.y * TILE + TILE / 2, id === this.playerId ? factor * .45 : factor);
      view.body.rotation = Math.sin(this.time.now / 170 + view.container.x) * .025;
    }
    for (const [id, view] of this.ghostViews) {
      view.container.x = Phaser.Math.Linear(view.container.x, view.target.x * TILE + TILE / 2, factor);
      view.container.y = Phaser.Math.Linear(view.container.y, view.target.y * TILE + TILE / 2, factor);
      view.body.y = Math.sin(this.time.now / 125 + id.length) * 3;
      view.body.rotation = Math.sin(this.time.now / 250 + id.length) * .065;
    }
    for (const [id, view] of this.buildingViews) {
      if (!view.barrel) continue;
      const building = this.snapshotData.buildings.find((candidate) => candidate.id === id);
      if (!building) continue;
      const nearest = this.snapshotData.ghosts.filter((ghost) => ghost.hp > 0)
        .sort((a, b) => Phaser.Math.Distance.BetweenPoints(building.tile, a.position) - Phaser.Math.Distance.BetweenPoints(building.tile, b.position))[0];
      if (nearest) view.barrel.rotation = Phaser.Math.Angle.Between(building.tile.x, building.tile.y, nearest.position.x, nearest.position.y) + Math.PI / 2;
    }
  }

  setLocalInput(input: Vec2): void { this.localInput = input; }

  updateSnapshot(snapshot: GameSnapshot, events: GameEvent[]): void {
    this.snapshotData = snapshot;
    this.syncPlayers(snapshot.players);
    this.syncGhosts(snapshot.ghosts ?? [snapshot.ghost]);
    this.syncBuildings(snapshot.buildings);
    this.syncDoors(snapshot);
    for (const event of events) this.playEvent(event);
    const local = snapshot.players.find((player) => player.id === this.playerId);
    const newlyAssigned = Boolean(local?.roomId && local.roomId !== this.focusedRoomId);
    if (local && (!this.cameraInitialized || newlyAssigned)) {
      this.cameras.main.centerOn(local.position.x * TILE + TILE / 2, local.position.y * TILE + TILE / 2);
      this.cameraInitialized = true;
      this.focusedRoomId = local.roomId;
    }
  }

  private drawMap(): void {
    for (const tile of this.mapData.walkable) {
      const inCorridor = tile.y >= this.mapData.corridor.y && tile.y < this.mapData.corridor.y + this.mapData.corridor.height;
      this.add.image(tile.x * TILE + TILE / 2, tile.y * TILE + TILE / 2, inCorridor ? 'corridor' : 'floor').setDepth(0);
    }
    const zone = this.mapData.respawnZone;
    this.add.rectangle((zone.x + zone.width / 2) * TILE, (zone.y + zone.height / 2) * TILE, zone.width * TILE, zone.height * TILE, 0x7c1531, .32)
      .setStrokeStyle(3, 0xff315f, .6).setDepth(1);
    this.add.text((zone.x + zone.width / 2) * TILE, (zone.y + .45) * TILE, '☠ 귀환·회복 구역', {
      color: '#ff728f', fontFamily: 'sans-serif', fontSize: '11px', fontStyle: 'bold', stroke: '#13030a', strokeThickness: 3,
    }).setOrigin(.5).setDepth(2);
    for (const room of this.mapData.rooms) {
      for (const tile of room.buildTiles) this.add.image(tile.x * TILE + TILE / 2, tile.y * TILE + TILE / 2, 'build-tile').setDepth(1);
      this.add.image(room.bed.x * TILE + TILE / 2, room.bed.y * TILE + TILE / 2, 'bed').setDepth(3);
      this.add.text(room.door.x * TILE + TILE / 2, (room.door.y + (room.door.y < this.mapData.corridor.y ? -.7 : .7)) * TILE, `${room.id.split('-')[1]}호 · ${room.shape}`, {
        color: '#aeb4de', fontFamily: 'sans-serif', fontSize: '10px', fontStyle: 'bold', stroke: '#090b1a', strokeThickness: 3,
      }).setOrigin(.5).setDepth(4).setAlpha(.85);
    }
    for (const wall of this.mapData.walls) this.add.image(wall.x * TILE + TILE / 2, wall.y * TILE + TILE / 2, 'wall').setDepth(5);
    this.physics.world.setBounds(0, 0, this.mapData.width * TILE, this.mapData.height * TILE);
  }

  private syncPlayers(players: PlayerState[]): void {
    const active = new Set(players.map((player) => player.id));
    for (const player of players) {
      let view = this.playerViews.get(player.id);
      if (!view) {
        const shadow = this.add.ellipse(0, 17, 29, 9, 0x04050c, .45);
        const body = this.add.sprite(0, 0, 'player').setTint(player.color);
        const name = this.add.text(0, -35, player.nickname, { color: '#ffffff', fontFamily: 'sans-serif', fontSize: '11px', fontStyle: 'bold', stroke: '#090b1a', strokeThickness: 4 }).setOrigin(.5);
        const hp = this.add.graphics();
        const container = this.add.container(player.position.x * TILE + TILE / 2, player.position.y * TILE + TILE / 2, [shadow, body, name, hp]).setDepth(10);
        view = { container, body, hp, target: { ...player.position } };
        this.playerViews.set(player.id, view);
      }
      view.target = { ...player.position };
      view.container.setAlpha(player.alive ? (player.connected ? 1 : .55) : .22);
      view.hp.clear().fillStyle(0x161728, .9).fillRoundedRect(-18, -27, 36, 5, 2).fillStyle(player.hp / player.maxHp > .35 ? 0x68efa4 : 0xff668c).fillRoundedRect(-18, -27, 36 * player.hp / player.maxHp, 5, 2);
      if (player.id === this.playerId) view.container.setDepth(12);
    }
    for (const [id, view] of this.playerViews) if (!active.has(id)) { view.container.destroy(true); this.playerViews.delete(id); }
  }

  private syncGhosts(ghosts: GhostState[]): void {
    const active = new Set(ghosts.map((ghost) => ghost.id));
    for (const ghost of ghosts) {
      let view = this.ghostViews.get(ghost.id);
      if (!view) {
        const glow = this.add.ellipse(0, 20, 68, 30, 0xc21c43, .2);
        const body = this.add.sprite(0, 0, `ghost-${ghost.variant}`);
        const name = this.add.text(0, -49, ghost.displayName, { color: '#ffb4c2', fontFamily: 'sans-serif', fontSize: '10px', fontStyle: 'bold', stroke: '#12030a', strokeThickness: 4 }).setOrigin(.5);
        const hp = this.add.graphics();
        const container = this.add.container(ghost.position.x * TILE + TILE / 2, ghost.position.y * TILE + TILE / 2, [glow, body, name, hp]).setDepth(11);
        view = { container, body, hp, target: { ...ghost.position } };
        this.ghostViews.set(ghost.id, view);
      }
      view.target = { ...ghost.position };
      view.container.setAlpha(ghost.hp > 0 ? (ghost.healing ? .62 : 1) : .12);
      view.body.setTint(ghost.retreating ? 0x8790b8 : ghost.rage ? 0xff355f : 0xffffff);
      const ratio = ghost.hp / Math.max(1, ghost.maxHp);
      view.hp.clear().fillStyle(0x100b1c, .95).fillRoundedRect(-28, -39, 56, 7, 3)
        .fillStyle(ghost.retreating ? 0x8494bb : 0xff315f).fillRoundedRect(-28, -39, 56 * ratio, 7, 3);
    }
    for (const [id, view] of this.ghostViews) if (!active.has(id)) { view.container.destroy(true); this.ghostViews.delete(id); }
  }

  private syncBuildings(buildings: BuildingState[]): void {
    const active = new Set(buildings.map((building) => building.id));
    for (const building of buildings) {
      let view = this.buildingViews.get(building.id);
      if (!view) {
        const body = this.add.sprite(0, 0, `building-${building.kind}`);
        const isTurret = ['basic-turret', 'rapid-turret', 'frost-turret'].includes(building.kind);
        const barrel = isTurret ? this.add.rectangle(0, -8, 5, 21, building.kind === 'frost-turret' ? 0xa8f3ff : 0xe6e9ff).setOrigin(.5, 1) : null;
        const level = this.add.text(13, 10, '', { color: '#ffffff', backgroundColor: '#17192d', fontFamily: 'sans-serif', fontSize: '9px', fontStyle: 'bold', padding: { x: 3, y: 1 } }).setOrigin(.5);
        const pieces: Phaser.GameObjects.GameObject[] = [body];
        if (barrel) pieces.push(barrel);
        pieces.push(level);
        const container = this.add.container(building.tile.x * TILE + TILE / 2, building.tile.y * TILE + TILE / 2, pieces).setDepth(6).setScale(0);
        this.tweens.add({ targets: container, scale: 1, duration: 260, ease: 'Back.Out' });
        view = { container, body, barrel, level };
        this.buildingViews.set(building.id, view);
      }
      view.level.setText(`Lv.${building.level}`);
    }
    for (const [id, view] of this.buildingViews) if (!active.has(id)) { view.container.destroy(true); this.buildingViews.delete(id); }
  }

  private syncDoors(snapshot: GameSnapshot): void {
    for (const room of snapshot.rooms) {
      const mapRoom = this.mapData.rooms.find((candidate) => candidate.id === room.id);
      if (!mapRoom) continue;
      let door = this.doorViews.get(room.id);
      if (!door) {
        door = this.add.sprite(mapRoom.door.x * TILE + TILE / 2, mapRoom.door.y * TILE + TILE / 2, 'door').setDepth(6);
        this.doorViews.set(room.id, door);
      }
      door.setAlpha(room.doorHp > 0 ? 1 : .16).setTint(room.shieldUntil > snapshot.elapsed ? 0x8da8ff : 0xffffff);
      door.setScale(1 + (room.doorLevel - 1) * .08);
    }
  }

  private playEvent(event: GameEvent): void {
    if (event.kind === 'turret-fire' && event.position && event.targetPosition) {
      const from = { x: event.position.x * TILE + TILE / 2, y: event.position.y * TILE + TILE / 2 };
      const to = { x: event.targetPosition.x * TILE + TILE / 2, y: event.targetPosition.y * TILE + TILE / 2 };
      if (event.buildingKind === 'frost-turret') {
        const laser = this.add.graphics().setDepth(19).lineStyle(5, 0x91efff, .92).lineBetween(from.x, from.y, to.x, to.y).lineStyle(1, 0xffffff, 1).lineBetween(from.x, from.y, to.x, to.y);
        this.effects.push(laser);
        this.tweens.add({ targets: laser, alpha: 0, duration: 180, onComplete: () => this.removeEffect(laser) });
      } else if (event.buildingKind === 'electric-coil') {
        const pulse = this.add.circle(to.x, to.y, 8, 0xc98aff, .2).setStrokeStyle(4, 0xdbb1ff, .95).setDepth(19);
        this.effects.push(pulse);
        this.tweens.add({ targets: pulse, scale: 3.2, alpha: 0, duration: 260, onComplete: () => this.removeEffect(pulse) });
      } else {
        const projectile = this.add.sprite(from.x, from.y, event.buildingKind === 'rapid-turret' ? 'bullet-rapid' : 'bullet-shell').setDepth(20);
        projectile.rotation = Phaser.Math.Angle.Between(from.x, from.y, to.x, to.y);
        this.effects.push(projectile);
        this.tweens.add({ targets: projectile, x: to.x, y: to.y, duration: event.buildingKind === 'rapid-turret' ? 105 : 190, ease: 'Quad.In', onComplete: () => this.removeEffect(projectile) });
      }
      return;
    }
    if (!event.position || !['ghost-hit', 'door-hit', 'player-hit', 'death', 'build', 'ghost-level-up', 'ghost-skill'].includes(event.kind)) return;
    const sprite = this.add.sprite(event.position.x * TILE + TILE / 2, event.position.y * TILE + TILE / 2, 'hit').setDepth(20).setScale(.3);
    if (event.kind === 'build') sprite.setTint(0x68efa4);
    if (event.kind === 'death' || event.kind === 'ghost-level-up') sprite.setTint(0xff315f).setScale(1.4);
    if (event.kind === 'ghost-skill') sprite.setTint(0xc27bff).setScale(1.8);
    this.effects.push(sprite);
    this.tweens.add({ targets: sprite, alpha: 0, scale: sprite.scale * 2.2, angle: 50, duration: 320, onComplete: () => this.removeEffect(sprite) });
    if (event.kind === 'door-hit') this.cameras.main.shake(75, .0025);
  }

  private removeEffect(effect: Phaser.GameObjects.GameObject): void {
    effect.destroy();
    this.effects = this.effects.filter((item) => item !== effect);
  }

  private beginDrag(pointer: Phaser.Input.Pointer): void {
    this.drag = { id: pointer.id, x: pointer.x, y: pointer.y, scrollX: this.cameras.main.scrollX, scrollY: this.cameras.main.scrollY, moved: false };
  }

  private moveDrag(pointer: Phaser.Input.Pointer): void {
    if (!this.drag || this.drag.id !== pointer.id || !pointer.isDown) return;
    const dx = pointer.x - this.drag.x;
    const dy = pointer.y - this.drag.y;
    if (Math.hypot(dx, dy) > 7) this.drag.moved = true;
    if (!this.drag.moved) return;
    const zoom = this.cameras.main.zoom;
    this.cameras.main.setScroll(this.drag.scrollX - dx / zoom, this.drag.scrollY - dy / zoom);
  }

  private endDrag(pointer: Phaser.Input.Pointer): void {
    if (!this.drag || this.drag.id !== pointer.id) return;
    const wasMoved = this.drag.moved;
    this.drag = null;
    if (!wasMoved) this.selectAt(pointer.x, pointer.y);
  }

  private selectAt(screenX: number, screenY: number): void {
    const world = this.cameras.main.getWorldPoint(screenX, screenY);
    const tile = { x: Math.floor(world.x / TILE), y: Math.floor(world.y / TILE) };
    const building = this.snapshotData.buildings.find((candidate) => candidate.tile.x === tile.x && candidate.tile.y === tile.y);
    if (building) {
      this.highlight(tile);
      window.dispatchEvent(new CustomEvent<SceneSelection>('dorm:target-selected', { detail: { type: 'building', targetId: building.id, buildingId: building.id, roomId: building.roomId } }));
      return;
    }
    const bedRoom = this.mapData.rooms.find((room) => room.bed.x === tile.x && room.bed.y === tile.y);
    if (bedRoom) {
      this.highlight(tile);
      window.dispatchEvent(new CustomEvent<SceneSelection>('dorm:target-selected', { detail: { type: 'bed', targetId: `bed:${bedRoom.id}`, roomId: bedRoom.id } }));
      return;
    }
    const doorRoom = this.mapData.rooms.find((room) => room.door.x === tile.x && room.door.y === tile.y);
    if (doorRoom) {
      this.highlight(tile);
      window.dispatchEvent(new CustomEvent<SceneSelection>('dorm:target-selected', { detail: { type: 'door', targetId: `door:${doorRoom.id}`, roomId: doorRoom.id } }));
      return;
    }
    const room = this.mapData.rooms.find((candidate) => candidate.buildTiles.some((buildTile) => buildTile.x === tile.x && buildTile.y === tile.y));
    if (!room) return;
    this.selectedTile = { ...tile, roomId: room.id };
    this.highlight(tile);
    window.dispatchEvent(new CustomEvent<Tile>('dorm:tile-selected', { detail: this.selectedTile }));
  }

  private highlight(tile: Vec2): void {
    this.selectionGraphics?.clear().lineStyle(3, 0xffd36f, .95).strokeRoundedRect(tile.x * TILE + 2, tile.y * TILE + 2, TILE - 4, TILE - 4, 6);
  }

  private cleanup(): void {
    this.input.removeAllListeners();
    for (const view of this.playerViews.values()) view.container.destroy(true);
    for (const view of this.ghostViews.values()) view.container.destroy(true);
    for (const view of this.buildingViews.values()) view.container.destroy(true);
    this.playerViews.clear();
    this.ghostViews.clear();
    this.buildingViews.clear();
    this.doorViews.clear();
    this.effects = [];
  }
}
