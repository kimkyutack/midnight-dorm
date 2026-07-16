/** Three.js 아바타의 로컬 정면(-Z)을 월드 이동 벡터에 맞추는 회전각. */
export const movementFacingYaw = (dx: number, dz: number): number => Math.atan2(-dx, -dz);
