import type { GameEvent } from './types';

/**
 * Combat damage is already authoritative in snapshots. Rapid turret events
 * exist only to replay muzzle/projectile visuals, so sending several shots
 * from the same turret inside one network frame wastes bandwidth and client
 * work without changing gameplay.
 */
export function compactRealtimeEvents(events: readonly GameEvent[]): GameEvent[] {
  const retained: Array<{ event: GameEvent; index: number }> = [];
  const turretBySource = new Map<string, { event: GameEvent; index: number }>();

  events.forEach((event, index) => {
    if (event.kind !== 'turret-fire') {
      retained.push({ event, index });
      return;
    }
    const sourceKey =
      event.sourceId ??
      `${event.position?.x ?? 'x'}:${event.position?.y ?? 'y'}:${event.buildingKind ?? ''}`;
    turretBySource.set(sourceKey, { event, index });
  });

  retained.push(...turretBySource.values());
  retained.sort((left, right) => left.index - right.index);
  return retained.map(({ event }) => event);
}
