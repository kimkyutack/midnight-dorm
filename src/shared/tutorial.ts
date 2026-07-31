import type {
  BuildingState,
  MapDefinition,
  Tile,
  TutorialStep,
} from "./types";

const tileKey = (tile: Pick<Tile, "x" | "y">): string =>
  `${tile.x},${tile.y}`;

const distance = (
  left: Pick<Tile, "x" | "y">,
  right: Pick<Tile, "x" | "y">,
): number => Math.hypot(left.x - right.x, left.y - right.y);

/**
 * Returns the one authoritative build tile used by the first-match lesson.
 * Keeping this choice shared prevents the client highlight and server guard
 * from drifting apart when buildings are added between tutorial steps.
 */
export function tutorialGuidedBuildTile(
  map: MapDefinition,
  buildings: readonly BuildingState[],
  roomId: string,
  step: TutorialStep,
  ownerId: string,
): Tile | null {
  if (
    step !== "build-turret" &&
    step !== "build-generator" &&
    step !== "build-net"
  )
    return null;
  const room = map.rooms.find((candidate) => candidate.id === roomId);
  if (!room) return null;
  const occupied = new Set(buildings.map((building) => tileKey(building.tile)));
  const available = room.buildTiles
    .filter((tile) => !occupied.has(tileKey(tile)))
    .map((tile) => ({ ...tile, roomId }))
    .sort((left, right) => left.y - right.y || left.x - right.x);
  if (available.length === 0) return null;

  const ownedTurret = buildings.find(
    (building) =>
      building.roomId === roomId &&
      building.ownerId === ownerId &&
      building.kind === "basic-turret",
  );
  const ownedGenerator = buildings.find(
    (building) =>
      building.roomId === roomId &&
      building.ownerId === ownerId &&
      building.kind === "generator",
  );
  const anchor =
    step === "build-turret"
      ? room.door
      : step === "build-net"
        ? (ownedTurret?.tile ?? room.door)
        : (ownedTurret?.tile ?? room.bed);

  return [...available].sort((left, right) => {
    const leftDistance = distance(left, anchor);
    const rightDistance = distance(right, anchor);
    if (step === "build-generator" && ownedGenerator) {
      return rightDistance - leftDistance || left.y - right.y || left.x - right.x;
    }
    return leftDistance - rightDistance || left.y - right.y || left.x - right.x;
  })[0] ?? null;
}
