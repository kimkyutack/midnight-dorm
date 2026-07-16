import * as THREE from 'three';
import type { AvatarAppearance, RankId } from '../../shared/types';
import { createPlayerRig, type PlayerRig } from './ThreeGameView';

export type AvatarView = 'front' | 'side' | 'back';

const VIEW_YAW: Record<AvatarView, number> = {
  front: 0,
  side: -Math.PI / 2,
  back: Math.PI,
};

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

/** 고정 배율의 커스텀 전용 3D 피팅룸. 드래그와 앞/옆/뒤 버튼으로만 회전한다. */
export class AvatarPreview3D {
  private readonly host: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.1, 30);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly resizeObserver: ResizeObserver;
  private rig: PlayerRig | null = null;
  private yaw = 0;
  private pointerId: number | null = null;
  private pointerX = 0;
  private destroyed = false;

  constructor(host: HTMLElement, appearance: AvatarAppearance, rank: RankId, color = 0x78dff1) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'custom-avatar-canvas';
    this.renderer.domElement.dataset.avatarView = 'front';
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.setAttribute('aria-label', '회전 가능한 3D 캐릭터 미리보기');
    this.host.insertBefore(this.renderer.domElement, this.host.firstChild);

    this.camera.position.set(0, 1.12, -4.25);
    this.camera.lookAt(0, 0.9, 0);
    this.scene.add(new THREE.HemisphereLight(0xcbefff, 0x182235, 2.8));
    const key = new THREE.DirectionalLight(0xfff1dd, 4.4);
    key.position.set(-2.5, 4.6, -3.2);
    key.castShadow = true;
    this.scene.add(key);
    const rim = new THREE.PointLight(0x6cecff, 12, 7, 2);
    rim.position.set(2.1, 1.8, 1.8);
    this.scene.add(rim);
    const warm = new THREE.PointLight(0xff9e74, 4.2, 5, 2);
    warm.position.set(-2, 0.8, -1.2);
    this.scene.add(warm);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(0.82, 48),
      new THREE.MeshPhysicalMaterial({ color: 0x152734, roughness: 0.32, metalness: 0.18, transparent: true, opacity: 0.86 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 0.9, 48),
      new THREE.MeshBasicMaterial({ color: 0x71e5ec, transparent: true, opacity: 0.58, side: THREE.DoubleSide }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.01;
    this.scene.add(halo);

    this.updateAppearance(appearance, rank, color);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this.onPointerUp);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.resize();
  }

  updateAppearance(appearance: AvatarAppearance, rank: RankId, color = 0x78dff1): void {
    if (this.rig) {
      this.scene.remove(this.rig.root);
      disposeObject(this.rig.root);
    }
    this.rig = createPlayerRig(appearance, rank, color, false);
    this.rig.root.rotation.y = this.yaw;
    this.rig.root.scale.setScalar(1.12);
    this.scene.add(this.rig.root);
    this.render();
  }

  setView(view: AvatarView): void {
    this.yaw = VIEW_YAW[view];
    this.renderer.domElement.dataset.avatarView = view;
    if (this.rig) this.rig.root.rotation.y = this.yaw;
    this.render();
  }

  getRotation(): number { return this.yaw; }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('pointercancel', this.onPointerUp);
    if (this.rig) {
      this.scene.remove(this.rig.root);
      disposeObject(this.rig.root);
      this.rig = null;
    }
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.pointerId = event.pointerId;
    this.pointerX = event.clientX;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.host.classList.add('dragging');
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId || !this.rig) return;
    const dx = event.clientX - this.pointerX;
    this.pointerX = event.clientX;
    this.yaw += dx * 0.012;
    this.renderer.domElement.dataset.avatarView = 'custom';
    this.rig.root.rotation.y = this.yaw;
    this.render();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.host.classList.remove('dragging');
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
  };

  private resize(): void {
    if (this.destroyed) return;
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  private render(): void {
    if (!this.destroyed) this.renderer.render(this.scene, this.camera);
  }
}
