import Phaser from 'phaser';
import { BALANCE } from '../../shared/balance';
import type { BuildingState, GameEvent, GameSnapshot, MapDefinition, PlayerState, Tile, Vec2 } from '../../shared/types';
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

export class GameScene extends Phaser.Scene {
  private mapData!: MapDefinition;
  private playerId = '';
  private snapshotData!: GameSnapshot;
  private readonly playerViews = new Map<string, EntityView>();
  private readonly buildingViews = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly doorViews = new Map<string, Phaser.GameObjects.Sprite>();
  private ghostView: EntityView | null = null;
  private localInput: Vec2 = { x: 0, y: 0 };
  private selectedTile: Tile | null = null;
  private selectionGraphics: Phaser.GameObjects.Graphics | null = null;
  private effects: Phaser.GameObjects.Sprite[] = [];

  constructor() { super('game'); }

  init(data: ScenePayload): void {
    this.mapData = data.map;
    this.playerId = data.playerId;
    this.snapshotData = data.snapshot;
  }

  create(): void {
    createRuntimeTextures(this);
    this.cameras.main.setBackgroundColor(0x090b1a);
    this.drawMap();
    this.selectionGraphics = this.add.graphics().setDepth(7);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => this.selectTile(pointer));
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
    if (this.ghostView) {
      this.ghostView.container.x = Phaser.Math.Linear(this.ghostView.container.x, this.ghostView.target.x * TILE + TILE / 2, factor);
      this.ghostView.container.y = Phaser.Math.Linear(this.ghostView.container.y, this.ghostView.target.y * TILE + TILE / 2, factor);
      this.ghostView.body.y = Math.sin(this.time.now / 180) * 3;
      this.ghostView.body.rotation = Math.sin(this.time.now / 420) * .04;
    }
  }

  setLocalInput(input: Vec2): void { this.localInput = input; }

  updateSnapshot(snapshot: GameSnapshot, events: GameEvent[]): void {
    this.snapshotData = snapshot;
    this.syncPlayers(snapshot.players);
    this.syncGhost(snapshot);
    this.syncBuildings(snapshot.buildings);
    this.syncDoors(snapshot);
    for (const event of events) this.playEvent(event);
  }

  private drawMap(): void {
    for (const tile of this.mapData.walkable) {
      const inCorridor = tile.y >= this.mapData.corridor.y && tile.y < this.mapData.corridor.y + this.mapData.corridor.height;
      this.add.image(tile.x * TILE + TILE / 2, tile.y * TILE + TILE / 2, inCorridor ? 'corridor' : 'floor').setDepth(0);
    }
    for (const room of this.mapData.rooms) {
      for (const tile of room.buildTiles) this.add.image(tile.x * TILE + TILE / 2, tile.y * TILE + TILE / 2, 'build-tile').setDepth(1);
      this.add.image(room.bed.x * TILE + TILE / 2, room.bed.y * TILE + TILE / 2, 'bed').setDepth(3);
      const label = this.add.text((room.bounds.x + room.bounds.width / 2) * TILE, (room.bounds.y + .55) * TILE, `새벽 ${room.id.split('-')[1]}호`, {
        color: '#8890bd', fontFamily: 'sans-serif', fontSize: '12px', fontStyle: 'bold',
      }).setOrigin(.5).setDepth(2);
      label.setAlpha(.75);
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

  private syncGhost(snapshot: GameSnapshot): void {
    const ghost = snapshot.ghost;
    if (!this.ghostView) {
      const glow = this.add.ellipse(0, 18, 58, 26, 0x8e73ff, .14);
      const body = this.add.sprite(0, 0, 'ghost');
      const hp = this.add.graphics();
      const container = this.add.container(ghost.position.x * TILE + TILE / 2, ghost.position.y * TILE + TILE / 2, [glow, body, hp]).setDepth(11);
      this.ghostView = { container, body, hp, target: { ...ghost.position } };
    }
    this.ghostView.target = { ...ghost.position };
    this.ghostView.body.setTint(ghost.rage ? 0xff829f : 0xffffff);
    const ratio = ghost.hp / Math.max(1, ghost.maxHp);
    this.ghostView.hp.clear().fillStyle(0x100b1c, .9).fillRoundedRect(-25, -38, 50, 6, 3).fillStyle(0xff668c).fillRoundedRect(-25, -38, 50 * ratio, 6, 3);
  }

  private syncBuildings(buildings: BuildingState[]): void {
    const active = new Set(buildings.map((building) => building.id));
    for (const building of buildings) {
      let sprite = this.buildingViews.get(building.id);
      if (!sprite) {
        sprite = this.add.sprite(building.tile.x * TILE + TILE / 2, building.tile.y * TILE + TILE / 2, `building-${building.kind}`).setDepth(6).setScale(0);
        this.tweens.add({ targets: sprite, scale: 1, duration: 260, ease: 'Back.Out' });
        this.buildingViews.set(building.id, sprite);
      }
      sprite.setData('buildingId', building.id).setData('level', building.level);
    }
    for (const [id, sprite] of this.buildingViews) if (!active.has(id)) { sprite.destroy(); this.buildingViews.delete(id); }
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
    if (!event.position || !['ghost-hit', 'door-hit', 'player-hit', 'death', 'build'].includes(event.kind)) return;
    const sprite = this.add.sprite(event.position.x * TILE + TILE / 2, event.position.y * TILE + TILE / 2, 'hit').setDepth(20).setScale(.3);
    if (event.kind === 'build') sprite.setTint(0x68efa4);
    if (event.kind === 'death') sprite.setTint(0xff668c).setScale(1.4);
    this.effects.push(sprite);
    this.tweens.add({ targets: sprite, alpha: 0, scale: sprite.scale * 2.2, angle: 50, duration: 320, onComplete: () => { sprite.destroy(); this.effects = this.effects.filter((item) => item !== sprite); } });
    if (event.kind === 'door-hit') this.cameras.main.shake(75, .0025);
  }

  private selectTile(pointer: Phaser.Input.Pointer): void {
    const tile = { x: Math.floor(pointer.worldX / TILE), y: Math.floor(pointer.worldY / TILE) };
    const room = this.mapData.rooms.find((candidate) => candidate.buildTiles.some((buildTile) => buildTile.x === tile.x && buildTile.y === tile.y));
    if (!room) return;
    this.selectedTile = { ...tile, roomId: room.id };
    this.selectionGraphics?.clear().lineStyle(3, 0xffd36f, .95).strokeRoundedRect(tile.x * TILE + 2, tile.y * TILE + 2, TILE - 4, TILE - 4, 6);
    window.dispatchEvent(new CustomEvent<Tile>('dorm:tile-selected', { detail: this.selectedTile }));
  }

  private cleanup(): void {
    this.input.removeAllListeners();
    for (const view of this.playerViews.values()) view.container.destroy(true);
    this.playerViews.clear();
    this.buildingViews.clear();
    this.doorViews.clear();
    this.effects = [];
    this.ghostView = null;
  }
}
