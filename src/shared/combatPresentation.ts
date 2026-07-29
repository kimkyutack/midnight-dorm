import type { GhostState, PlayerState } from './types';

/**
 * HUD danger follows the server-authoritative target rather than a client
 * distance estimate. Teleporters and fast ghosts can move between snapshots,
 * but their target remains stable until they retreat or retarget.
 */
export function isPlayerUnderGhostAttack(
  player: PlayerState,
  ghosts: readonly GhostState[],
): boolean {
  if (!player.alive) return false;
  return ghosts.some(
    (ghost) =>
      ghost.hp > 0 &&
      !ghost.retreating &&
      !ghost.healing &&
      (ghost.targetPlayerId === player.id ||
        (Boolean(player.roomId) && ghost.targetRoomId === player.roomId)),
  );
}
