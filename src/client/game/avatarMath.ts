/** Three.js 아바타의 로컬 정면(-Z)을 월드 이동 벡터에 맞추는 회전각. */
export const movementFacingYaw = (dx: number, dz: number): number => Math.atan2(-dx, -dz);

/** -PI~PI 경계에서도 목표까지 가장 짧은 방향으로 향하는 각도 차이. */
export const shortestAngleDelta = (current: number, target: number): number =>
  Math.atan2(Math.sin(target - current), Math.cos(target - current));

/** 일반 숫자 보간 대신 원형 각도를 최단 경로로 감쇠한다. */
export const dampFacingYaw = (current: number, target: number, speed: number, dt: number): number =>
  current + shortestAngleDelta(current, target) * (1 - Math.exp(-speed * dt));
