import type { SeededRandom } from "../shared/rng";

/**
 * Ranked fill-ins use player-like aliases so the matchmaking roster does not
 * look like a debug lobby. The room seed feeds the picker, which keeps a
 * reconnect stable while still producing a different lineup per match.
 */
export const RANKED_BOT_NICKNAMES = [
  "Hero",
  "Anna",
  "Luna",
  "Mango",
  "Nova",
  "Raven",
  "Mochi",
  "Pixel",
  "Sunny",
  "Echo",
  "Jade",
  "Milo",
  "Coco",
  "Daisy",
  "Robin",
  "붉은악마",
  "짜파게티요리사",
  "달빛사냥꾼",
  "새벽라면",
  "민트초코단장",
  "퇴근요정",
  "구름한입",
  "별빛기사",
  "감자왕",
  "복도대장",
  "문지기",
  "야간반장",
  "고양이집사",
  "달리는호두",
  "졸린펭귄",
  "보라번개",
  "황금참치",
  "우주토끼",
  "초코우유",
  "용감한만두",
  "새벽배송",
  "파도타기",
  "네온유령",
  "하늘고래",
  "불꽃주먹",
] as const;

export function rankedBotNickname(
  rng: Pick<SeededRandom, "pick" | "int">,
  occupiedNames: Iterable<string>,
): string {
  const occupied = new Set(occupiedNames);
  const available = RANKED_BOT_NICKNAMES.filter(
    (nickname) => !occupied.has(nickname),
  );
  if (available.length > 0) return rng.pick(available);

  const base = rng.pick(RANKED_BOT_NICKNAMES);
  let candidate = `${base}${rng.int(10, 99)}`;
  while (occupied.has(candidate)) {
    candidate = `${base}${rng.int(100, 999)}`;
  }
  return candidate;
}
