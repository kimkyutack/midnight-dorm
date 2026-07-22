import * as THREE from 'three';
import type { AvatarAppearance, RankId, TurretKind } from '../../shared/types';
import { createGhostPreviewModel, createPlayerRig, createTurretPreviewModel } from './ThreeGameView';

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
  private readonly homePresentation: boolean;
  private previewObject: THREE.Group | null = null;
  private homeRig: ReturnType<typeof createPlayerRig> | null = null;
  private homeGhost: ReturnType<typeof createGhostPreviewModel> | null = null;
  private animationFrame = 0;
  private yaw = 0;
  private pointerId: number | null = null;
  private pointerX = 0;
  private pointerStartX = 0;
  private pointerMoved = false;
  private destroyed = false;

  constructor(host: HTMLElement, appearance: AvatarAppearance, rank: RankId, color = 0x78dff1) {
    this.host = host;
    this.homePresentation = host.classList.contains('home-avatar-model');
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

    this.camera.position.set(0, this.homePresentation ? 0.83 : 1.01, -4.55);
    this.camera.lookAt(0, this.homePresentation ? 0.69 : 0.86, 0);
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
    floor.visible = !this.homePresentation;
    this.scene.add(floor);
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 0.9, 48),
      new THREE.MeshBasicMaterial({ color: 0x71e5ec, transparent: true, opacity: 0.58, side: THREE.DoubleSide }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.01;
    halo.visible = !this.homePresentation;
    this.scene.add(halo);

    this.updateAppearance(appearance, rank, color);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this.onPointerUp);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.resize();
    if (this.homePresentation) this.animationFrame = requestAnimationFrame(this.animateHome);
  }

  updateAppearance(appearance: AvatarAppearance, rank: RankId, color = 0x78dff1): void {
    const nextRig = createPlayerRig(appearance, rank, color, false);
    nextRig.root.rotation.y = this.yaw;
    // 피팅룸·로비 모두 머리/귀가 프레임에 닿지 않도록 실제 리그보다 여유 있게 잡는다.
    nextRig.root.scale.setScalar(this.homePresentation ? 0.4 : 0.82);
    const groundRing = nextRig.root.getObjectByName('avatar-ground-ring');
    if (groundRing) groundRing.visible = !this.homePresentation;
    this.homeRig = this.homePresentation ? nextRig : null;
    if (this.homePresentation) {
      const chaseGroup = new THREE.Group();
      const ghost = createGhostPreviewModel('wanderer');
      // 이 프리뷰 카메라는 -Z에서 바라보므로 월드 X가 화면 좌우와 반대로 보인다.
      // 도망자는 화면 왼쪽, 추격자는 충분히 떨어진 화면 오른쪽에 둔다.
      nextRig.root.position.x = 0.9;
      nextRig.avatar.rotation.y = -Math.PI * 0.18;
      ghost.root.position.set(-0.92, -0.02, 0.04);
      // 원래 홈 캐릭터의 75% 크기, 최종 캐릭터 대비 약 1.5배 높이의 귀신.
      ghost.root.scale.setScalar(0.49);
      ghost.body.rotation.y = -Math.PI * 0.16;
      chaseGroup.add(nextRig.root, ghost.root);
      this.homeGhost = ghost;
      this.replacePreview(chaseGroup);
      this.renderer.domElement.dataset.homePlayerScale = '0.435';
      this.renderer.domElement.dataset.homeGhostScale = '0.49';
      this.renderer.domElement.dataset.homeGhostVariant = 'wanderer';
    } else {
      this.homeGhost = null;
      this.replacePreview(nextRig.root);
      delete this.renderer.domElement.dataset.homePlayerScale;
      delete this.renderer.domElement.dataset.homeGhostScale;
      delete this.renderer.domElement.dataset.homeGhostVariant;
    }
    this.renderer.domElement.dataset.previewKind = 'avatar';
    delete this.renderer.domElement.dataset.turretKind;
    delete this.renderer.domElement.dataset.skinId;
    this.render();
  }

  updateTurret(kind: TurretKind, skinId: string): void {
    this.homeRig = null;
    this.homeGhost = null;
    const turret = createTurretPreviewModel(kind, skinId);
    turret.rotation.y = this.yaw;
    turret.position.y = 0.03;
    turret.scale.setScalar(1.72);
    this.replacePreview(turret);
    this.renderer.domElement.dataset.previewKind = 'turret';
    this.renderer.domElement.dataset.turretKind = kind;
    this.renderer.domElement.dataset.skinId = skinId;
    this.render();
  }

  setView(view: AvatarView): void {
    this.yaw = VIEW_YAW[view];
    this.renderer.domElement.dataset.avatarView = view;
    if (this.previewObject) this.previewObject.rotation.y = this.yaw;
    this.render();
  }

  getRotation(): number { return this.yaw; }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('pointercancel', this.onPointerUp);
    if (this.previewObject) {
      this.scene.remove(this.previewObject);
      disposeObject(this.previewObject);
      this.previewObject = null;
      this.homeRig = null;
      this.homeGhost = null;
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
    this.pointerStartX = event.clientX;
    this.pointerMoved = false;
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId || !this.previewObject) return;
    if (!this.pointerMoved && Math.abs(event.clientX - this.pointerStartX) < 3) return;
    if (!this.pointerMoved) {
      this.pointerMoved = true;
      this.host.classList.add('dragging');
      this.renderer.domElement.setPointerCapture(event.pointerId);
    }
    const dx = event.clientX - this.pointerX;
    this.pointerX = event.clientX;
    this.yaw += dx * 0.012;
    this.renderer.domElement.dataset.avatarView = 'custom';
    this.previewObject.rotation.y = this.yaw;
    this.render();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.host.classList.remove('dragging');
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
    if (this.previewObject && this.previewObject.parent !== this.scene) this.scene.add(this.previewObject);
    this.render();
  };

  private replacePreview(next: THREE.Group): void {
    const previous = this.previewObject;
    this.previewObject = next;
    this.scene.add(next);
    if (previous) {
      this.scene.remove(previous);
      disposeObject(previous);
    }
  }

  private resize(): void {
    if (this.destroyed) return;
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    if (this.homePresentation) {
      const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
      const fitWidthDistance = 1.55 / Math.max(0.01, Math.tan(halfFov) * this.camera.aspect);
      const distance = Math.max(4.35, fitWidthDistance);
      this.camera.position.set(0, 0.83, -distance);
      this.camera.lookAt(0, 0.69, 0);
    }
    this.camera.updateProjectionMatrix();
    this.render();
  }

  private render(): void {
    if (!this.destroyed) this.renderer.render(this.scene, this.camera);
  }

  private readonly animateHome = (time: number): void => {
    if (this.destroyed) return;
    const rig = this.homeRig;
    if (rig) {
      const stride = Math.sin(time * 0.018) * 0.82;
      const ninjaArms = -1.18 + Math.sin(time * 0.018 + 0.7) * 0.07;
      rig.avatar.rotation.x = -0.13;
      rig.avatar.rotation.y = -Math.PI * 0.18;
      rig.avatar.rotation.z = Math.sin(time * 0.009) * 0.035;
      rig.avatar.position.y = Math.abs(Math.sin(time * 0.018)) * 0.055;
      rig.leftArm.rotation.x = ninjaArms;
      rig.rightArm.rotation.x = ninjaArms;
      rig.leftLeg.rotation.x = -stride;
      rig.rightLeg.rotation.x = stride;
    }
    if (this.homeGhost) {
      const runCycle = Math.sin(time * 0.016);
      // 화면 기준 왼쪽으로 추격하므로 팔을 월드 +X(카메라에서 보이는 진행 방향)로 뻗는다.
      // 어깨가 번갈아 흔들려 단순 부유가 아니라 붙잡으려 달리는 실루엣으로 보인다.
      this.homeGhost.body.position.y = Math.abs(runCycle) * 0.065;
      this.homeGhost.body.rotation.z = runCycle * 0.035;
      this.homeGhost.leftArm.position.y = 1.2;
      this.homeGhost.rightArm.position.y = 1.08;
      this.homeGhost.leftArm.position.z = -0.38;
      this.homeGhost.rightArm.position.z = -0.42;
      this.homeGhost.leftArm.rotation.z = 1.02 - runCycle * 0.1;
      this.homeGhost.rightArm.rotation.z = 2.06 + runCycle * 0.1;
      this.homeGhost.leftArm.rotation.x = 0.04 - runCycle * 0.05;
      this.homeGhost.rightArm.rotation.x = -0.04 + runCycle * 0.05;
    }
    this.render();
    this.animationFrame = requestAnimationFrame(this.animateHome);
  };
}
