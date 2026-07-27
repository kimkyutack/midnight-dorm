/** Three.js 아바타의 로컬 정면(-Z)을 월드 이동 벡터에 맞추는 회전각. */
export const movementFacingYaw = (dx: number, dz: number): number => Math.atan2(-dx, -dz);

/**
 * Rendering corrections can briefly move an actor opposite to its intended
 * direction while a server snapshot catches up.  Keep the sprite facing the
 * held input (or authoritative velocity) so a smooth position correction
 * never looks like an automatic U-turn.
 */
export const facingDeltaForMotion = (
  renderedDx: number,
  renderedDz: number,
  intent?: { x: number; y: number },
): { x: number; z: number } =>
  intent && Math.hypot(intent.x, intent.y) > 0.0001
    ? { x: intent.x, z: intent.y }
    : { x: renderedDx, z: renderedDz };

/** -PI~PI 경계에서도 목표까지 가장 짧은 방향으로 향하는 각도 차이. */
export const shortestAngleDelta = (current: number, target: number): number =>
  Math.atan2(Math.sin(target - current), Math.cos(target - current));

/** 일반 숫자 보간 대신 원형 각도를 최단 경로로 감쇠한다. */
export const dampFacingYaw = (current: number, target: number, speed: number, dt: number): number =>
  current + shortestAngleDelta(current, target) * (1 - Math.exp(-speed * dt));
