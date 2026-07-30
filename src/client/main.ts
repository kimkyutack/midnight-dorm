import {
  BALANCE,
  buildingStats,
  maxBuildingLevel,
  upgradeCost,
  upgradeRequirement,
} from "../shared/balance";
import {
  DRAW_COSTS,
  combinedItemEffects,
  getRandomItem,
} from "../shared/randomItems";
import {
  SHOP_CONSUMABLES,
  shopConsumableById,
} from "../shared/shopConsumables";
import {
  characterTrait,
  characterTraitForAppearance,
  drawLimitForAppearance,
} from "../shared/characterTraits";
import { turretSkinTrait } from "../shared/turretSkinTraits";
import { isPlayerUnderGhostAttack } from "../shared/combatPresentation";
import {
  characterAvailable,
  cosmeticAvailable,
  cosmeticById,
  cosmeticsForSlot,
  customizationReward,
  CYBERPUNK_LASER_TURRET_SKIN_ID,
  CYBERPUNK_NEON_TILE_SKIN_ID,
  DEFAULT_TILE_SKIN_ID,
  LIFEGUARD_PARASOL_TURRET_SKIN_ID,
  defaultSkinForCharacter,
  SURFER_WATER_TURRET_SKIN_ID,
  tileSkinTextureUrl,
  turretSkinAssetUrl,
} from "../shared/customization";
import {
  rankBadgeImage,
  rankBenefits,
  getStage,
  rankedBadgeImage,
  RANKED_TIER_LABEL,
  rankLabel,
  stagesThrough,
  TIME_ATTACK_EXPIRED_MESSAGE,
} from "../shared/progression";
import { stageThemeFor } from "../shared/stageThemes";
import {
  APP_RELEASE_VERSION,
  isUpdateAvailable,
  type AppUpdate,
} from "../shared/appUpdates";
import type {
  AccountProfile,
  AvatarAppearance,
  BuildingKind,
  CosmeticSlot,
  ConsumableId,
  GameEvent,
  GameSnapshot,
  GameStatus,
  MapDefinition,
  PlayMode,
  PlayerState,
  ProfileDisplayMode,
  RankedTier,
  RankId,
  QuickChatPhrase,
  StageId,
  Tile,
  TutorialStep,
  Vec2,
} from "../shared/types";
import type {
  DirectMessage,
  SocialInvite,
  SocialPerson,
  SocialSnapshot,
} from "../shared/social";
import { SynthAudio, type BackgroundTrack } from "./audio";
import {
  equipCosmetic,
  getAccount,
  loginAccount,
  logoutAccount,
  purchaseCosmetic,
  purchaseConsumable,
  registerAccount,
  setProfileAvatar,
  setProfileDisplayMode,
  setSelectedPlayMode,
} from "./auth";
import { ThreeGameView, type SceneSelection } from "./game/ThreeGameView";
import { AvatarPreview3D, type AvatarView } from "./game/AvatarPreview3D";
import { AvatarPreview2D } from "./game/AvatarPreview2D";
import { hydrateCatalogArt } from "./game/CatalogThumbnail3D";
import { GameNetwork } from "./network";
import { loadProfile, saveProfile } from "./storage";
import { setupMobileViewportCompatibility } from "./viewport";
import "./styles.css";

setupMobileViewportCompatibility();

declare global {
  interface Window {
    __DORM_TEST__?: {
      snapshot: GameSnapshot | null;
      map: MapDefinition | null;
      playerId: string;
      move: (dx: number, dy: number) => void;
      interact: () => void;
      buildFirst: (kind: BuildingKind) => boolean;
      disconnect: () => void;
      cameraMode: () => "follow" | "free" | "none";
      cameraZoom: () => number;
      cameraYaw: () => number;
      renderedPosition: () => Vec2 | null;
      performanceStats: () => ReturnType<ThreeGameView["getPerformanceStats"]> | null;
      stressVisuals: () => number;
      resumeRendering: () => void;
    };
  }
}

const app = document.querySelector<HTMLDivElement>("#app")!;
if (!app) throw new Error("App root is missing");

const profile = loadProfile();
const audio = new SynthAudio();
audio.setVolume(profile.volume);
audio.setMusicVolume(profile.musicVolume);
audio.setMusicMuted(!profile.musicEnabled);
let network: GameNetwork | null = null;
let game: ThreeGameView | null = null;
let customAvatarPreview: AvatarPreview2D | AvatarPreview3D | null = null;
let snapshot: GameSnapshot | null = null;
let mapData: MapDefinition | null = null;
let playerId = "";
let previousGameStatus: GameStatus | null = null;
let countdownWarningTimer = 0;
let account: AccountProfile | null = null;
interface MailboxMessage {
  id: string;
  scope: "global" | "personal" | "reward";
  subject: string;
  body: string;
  rewardPoints: number;
  createdAt: number;
  expiresAt: number | null;
  readAt: number | null;
  claimedAt: number | null;
}
let mailboxUnreadCount = 0;
let socialUnreadCount = 0;
let socialSocket: WebSocket | null = null;
let socialReconnectTimer = 0;
interface SocialRealtimeEvent {
  type?: "ready" | "friend-request" | "friend-accepted" | "message" | "invite";
  fromAccountId?: string;
}
let socialModalRealtimeRefresh: ((event: SocialRealtimeEvent) => void) | null =
  null;
let customizeReturnView: "home" | "room-menu" = "home";
const SURFER_MONG_SKIN_ID = "skin-look-puppy-surfer";
const LIFEGUARD_RAON_SKIN_ID = "skin-look-tiger-lifeguard";
const NEON_RIDER_LULU_SKIN_ID = "skin-look-cat-neon-rider";
const CYBER_DRIVER_KONG_SKIN_ID = "skin-look-hamster-cyber-driver";
const SUMMER_SPECIAL_PROMO_DISMISSED_KEY =
  "midnight-dorm:promo:summer-special-skins:v1";
const CYBERPUNK_SPECIAL_PROMO_DISMISSED_KEY =
  "midnight-dorm:promo:cyberpunk-special-skins:v1";
let skinLaunchPromoShownThisSession = false;
type HomePlayMode = PlayMode | "ranked";
let homePlayMode: HomePlayMode = "solo";
const homeStageSelection: Partial<Record<PlayMode, StageId>> = {};
let selectedTile: Tile | null = null;
let selectedTarget: SceneSelection | null = null;
let soulVialTargetingId: string | null = null;
// The arm request and the following turret click can happen before the next
// authoritative snapshot returns. Keep this short-lived optimistic state so a
// stale frame cannot swallow the player's first turret selection.
let soulVialArmPendingId: string | null = null;
interface BuildingMoveRequest {
  buildingId: string;
  roomId: string;
  tile: Tile;
}
let currentView = "";
let inputSequence = 0;
let inputVector: Vec2 = { x: 0, y: 0 };
let lastMovementSentAt = 0;
let pendingMovementTimer = 0;
let movementKeepaliveTimer = 0;
let tileSelectionBlockedUntil = 0;
let buildPanelInputBlockedUntil = 0;
const pendingActions = new Map<string, number>();
let ping = 0;
let resultRecorded = false;
let toastTimer = 0;
let timeAttackExpiredTimer = 0;
let deathNoticeTimer = 0;
let rankedQueuePollTimer = 0;
const e2eMode = new URLSearchParams(location.search).get("e2e") === "1";
const automationMode =
  new URLSearchParams(location.search).get("automation") === "1";
const testShellMode = e2eMode || automationMode;
const devMode = new URLSearchParams(location.search).get("dev") === "1";
const freshMode = new URLSearchParams(location.search).get("fresh") === "1";
let updatePromptOpen = false;
// Prediction runs locally; a 12.5Hz intent stream is enough for the server
// and avoids flooding an unstable mobile network with pointer-move packets.
const MOVEMENT_SEND_INTERVAL_MS = 80;
const ACTION_DEBOUNCE_MS = 650;
const BUILD_PANEL_OPEN_GUARD_MS = 420;
const BUILD_POINTER_ARM_WINDOW_MS = 1_600;
const BUILD_KINDS: Exclude<BuildingKind, "bed" | "reinforced-door">[] = [
  "basic-turret",
  "frost-turret",
  "generator",
  "repair-drone",
  "electric-coil",
  "shield-device",
  "lucky-machine",
  "gem-core",
  "ghost-net",
  "range-amplifier",
  "overload-capacitor",
  "turret-enhancer",
  "door-anchor",
  "reflect-mirror",
  "power-panel",
  "cursed-contract",
  "soul-vial",
  "hide-and-seek-doll",
];

/** Gold tab is deliberately ordered from core economy to one-shot strategy. */
const GOLD_BUILD_ORDER: BuildingKind[] = [
  "basic-turret",
  "generator",
  "repair-drone",
  "lucky-machine",
  "golden-turret",
  "hide-and-seek-doll",
  "power-panel",
  "soul-vial",
  "cursed-contract",
];

const BUILDING_PANEL_ICONS: Record<BuildingKind, string> = {
  bed: "▰",
  "reinforced-door": "▣",
  "basic-turret": "◉",
  "rapid-turret": "✦",
  "frost-turret": "❄",
  "arc-turret": "ϟ",
  "golden-turret": "♛",
  generator: "⚡",
  "repair-drone": "✚",
  "electric-coil": "⌁",
  "shield-device": "⬡",
  "lucky-machine": "✧",
  "gem-core": "◈",
  "ghost-net": "#",
  "range-amplifier": "◎",
  "overload-capacitor": "ϟ",
  "turret-enhancer": "✦",
  "door-anchor": "⚓",
  "reflect-mirror": "◈",
  "power-panel": "▦",
  "cursed-contract": "✧",
  "soul-vial": "◉",
  "hide-and-seek-doll": "◌",
  "starter-grave": "†",
  "random-item": "✦",
};

interface RoomStatusResponse {
  exists: boolean;
  status: GameStatus;
  players: number;
}

interface RankedQueueResponse {
  status: "waiting" | "matched" | "idle";
  elapsedSeconds: number;
  playerCount: number;
  requiredPlayers: number;
  ratingWindow: number;
  players: Array<{
    accountId: string;
    nickname: string;
    rating: number;
    avatarUrl: string | null;
    tier: RankedTier;
    placementCompleted: number;
  }>;
  roomCode?: string;
  botCount?: number;
}

const isResumableRoom = (status: GameStatus): boolean =>
  status === "LOBBY" ||
  status === "RANKED_INTRO" ||
  status === "GHOST_INTRO" ||
  status === "EVENT_INTRO" ||
  status === "COUNTDOWN" ||
  status === "PLAYING" ||
  status === "OVERTIME";
const isJoinableRoom = (status: GameStatus): boolean =>
  status === "LOBBY" || status === "COUNTDOWN";

async function getRoomStatus(code: string): Promise<RoomStatusResponse> {
  const response = await fetch(`/api/rooms/${code}/status`);
  const data = (await response
    .json()
    .catch(() => null)) as Partial<RoomStatusResponse> | null;
  if (!response.ok || !data?.exists || !data.status)
    throw new Error("존재하지 않거나 만료된 방입니다.");
  return data as RoomStatusResponse;
}

function forgetRoom(code: string): void {
  delete profile.reconnectTokens[code];
  if (profile.recentRoomCode === code) profile.recentRoomCode = "";
  saveProfile(profile);
}

/**
 * A cold-start WebSocket failure usually means an old room/session survived a
 * deployment while its realtime instance did not. Do not leave that browser
 * retrying on the loading screen: clear the local resume data, request a
 * server logout, and require credentials before any future auto-resume.
 */
function invalidateRealtimeSession(
  failedNetwork: GameNetwork,
  code: string,
): void {
  if (network !== failedNetwork) return;
  failedNetwork.close();
  network = null;
  forgetRoom(code);
  profile.mustReauthenticate = true;
  saveProfile(profile);
  destroyGame();
  snapshot = null;
  mapData = null;
  playerId = "";
  selectedTile = null;
  selectedTarget = null;
  inputVector = { x: 0, y: 0 };
  resultRecorded = false;
  stopSocialRealtime();
  account = null;
  authScreen();
  toast("실시간 연결을 복구하지 못했습니다. 다시 로그인해주세요.");
  void logoutAccount().catch(() => undefined);
}

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ] as string,
  );
const formatTime = (seconds: number): string =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const rankIdentityHtml = (rank: RankId, badgeClass = ""): string =>
  `<span class="rank-identity rank-${rank}"><img class="rank-badge ${badgeClass}" src="${rankBadgeImage(rank)}" alt="" aria-hidden="true" /><b>${rankLabel(rank)}</b></span>`;

interface ProfileDisplayInfo {
  mode: ProfileDisplayMode;
  modeLabel: string;
  rankText: string;
  labelText: string;
  badgeUrl: string;
  badgeAlt: string;
  className: string;
}

function accountProfileDisplayInfo(
  currentAccount: AccountProfile,
  mode: ProfileDisplayMode = currentAccount.profileDisplayMode,
): ProfileDisplayInfo {
  if (mode === "ranked") {
    const rankText = `${currentAccount.ranked.seasonId} ${RANKED_TIER_LABEL[currentAccount.ranked.tier]}`;
    return {
      mode,
      modeLabel: `${currentAccount.ranked.seasonId} 랭크전`,
      rankText,
      labelText: rankText,
      badgeUrl: rankedBadgeImage(currentAccount.ranked.tier),
      badgeAlt: `${RANKED_TIER_LABEL[currentAccount.ranked.tier]} 랭크 뱃지`,
      className: `ranked-profile tier-${currentAccount.ranked.tier}`,
    };
  }
  const rank =
    mode === "multiplayer"
      ? currentAccount.multiplayerRank
      : currentAccount.soloRank;
  const modeLabel = mode === "multiplayer" ? "친구랑하기" : "혼자하기";
  return {
    mode,
    modeLabel,
    rankText: rankLabel(rank),
    labelText: rankLabel(rank),
    badgeUrl: rankBadgeImage(rank),
    badgeAlt: `${rankLabel(rank)} 등급 뱃지`,
    className: `rank-border-${rank}`,
  };
}

function playerProfileDisplayInfo(player: PlayerState): ProfileDisplayInfo {
  if (player.profileDisplayMode === "ranked") {
    const rankText = `${player.profileRankedSeasonId ?? "S1"} ${RANKED_TIER_LABEL[player.profileRankedTier]}`;
    return {
      mode: "ranked",
      modeLabel: `${player.profileRankedSeasonId ?? "S1"} 랭크전`,
      rankText,
      labelText: rankText,
      badgeUrl: rankedBadgeImage(player.profileRankedTier),
      badgeAlt: `${RANKED_TIER_LABEL[player.profileRankedTier]} 랭크 뱃지`,
      className: `ranked-profile tier-${player.profileRankedTier}`,
    };
  }
  const rank =
    player.profileDisplayMode === "multiplayer"
      ? player.multiplayerRank
      : player.soloRank;
  const modeLabel =
    player.profileDisplayMode === "multiplayer" ? "친구랑하기" : "혼자하기";
  return {
    mode: player.profileDisplayMode,
    modeLabel,
    rankText: rankLabel(rank),
    labelText: rankLabel(rank),
    badgeUrl: rankBadgeImage(rank),
    badgeAlt: `${rankLabel(rank)} 등급 뱃지`,
    className: `rank-border-${rank}`,
  };
}

const profileBadgeHtml = (
  display: ProfileDisplayInfo,
  badgeClass = "",
): string =>
  `<span class="rank-identity ${display.className}"><img class="rank-badge ${badgeClass}" src="${display.badgeUrl}" alt="${escapeHtml(display.badgeAlt)}" /><b>${escapeHtml(display.rankText)}</b></span>`;
const DEFAULT_PROFILE_AVATAR = "/assets/ui/default-profile.svg";
const profileAvatarHtml = (
  avatarUrl: string | null | undefined,
  className = "player-face profile-avatar",
): string =>
  `<img class="${className}" src="${escapeHtml(avatarUrl || DEFAULT_PROFILE_AVATAR)}" alt="" />`;
const playerPortraitHtml = (player: PlayerState): string =>
  // The same default profile artwork is used everywhere.  Falling back to a
  // character face in-game made the lobby/home identity appear to change.
  profileAvatarHtml(player.profileAvatarUrl);

function backgroundTrackForView(view: string): BackgroundTrack | null {
  if (view === "game") return "ingame";
  if (
    view === "home" ||
    view === "shop" ||
    view === "room-menu" ||
    view === "lobby" ||
    view === "ranked-queue" ||
    view === "result"
  ) {
    return "main";
  }
  return null;
}

type TutorialTopic = "battle" | "modes" | "points" | "ranked" | "time-attack";

interface TutorialDefinition {
  eyebrow: string;
  image: string;
  imageAlt: string;
  intro: string;
  label: string;
  steps: Array<{ title: string; description: string }>;
  title: string;
}

/** Short, spoiler-free warnings shown before the preparation countdown. */
const GHOST_THREAT_POSTERS: Readonly<
  Record<string, { title: string; warning: string }>
> = {
  wanderer: {
    title: "복도 순찰자",
    warning: "느리지만 끈질깁니다. 문 앞에서 방심하지 마세요.",
  },
  swift: {
    title: "목 꺾인 질주귀",
    warning: "순식간에 거리를 좁힙니다. 문 가까이는 특히 위험합니다.",
  },
  brute: {
    title: "굶주린 거구",
    warning: "느리지만 문을 세게 두드립니다. 튼튼한 방어가 필요합니다.",
  },
  caster: {
    title: "눈먼 봉인술사",
    warning: "병동의 기능을 봉인합니다. 자원과 수리를 미리 준비하세요.",
  },
  "twin-a": {
    title: "울보 쌍둥이",
    warning: "쌍둥이가 서로 다른 방을 노립니다. 동료와 방어를 나누세요.",
  },
  "twin-b": {
    title: "웃는 쌍둥이",
    warning: "쌍둥이가 서로 다른 방을 노립니다. 동료와 방어를 나누세요.",
  },
  teleporter: {
    title: "문틈 도약귀",
    warning: "갑자기 내 문 앞으로 도약합니다. 방어선의 빈틈을 조심하세요.",
  },
  undead: {
    title: "무덤의 산모",
    warning: "작은 미니미를 불러옵니다. 여러 적을 동시에 막아야 합니다.",
  },
  giant: {
    title: "천장 닿는 거인",
    warning: "한 번의 문 공격이 묵직합니다. 문 보강을 서두르세요.",
  },
  demolisher: {
    title: "웃는 해체귀",
    warning: "문을 오래 두드리면 마나를 모아 방 안의 건물을 철거합니다. 붉은 준비 동작을 놓치지 마세요.",
  },
  wallpaper: {
    title: "오염 도배귀",
    warning: "문을 두드려 마나를 채우면 방 안 세 타일을 오염시켜 설비를 멈춥니다. 보랏빛 준비 동작을 조심하세요.",
  },
};

const TUTORIAL_ORDER: TutorialTopic[] = [
  "battle",
  "modes",
  "points",
  "ranked",
  "time-attack",
];

const TUTORIALS: Record<TutorialTopic, TutorialDefinition> = {
  battle: {
    label: "인게임",
    eyebrow: "IN-GAME BASICS",
    title: "내 방을 끝까지 지키세요",
    intro:
      "불이 꺼진 복도에서 먼저 빈 방을 찾으세요. 방을 점유한 뒤에는 문과 건물을 강화해 귀신을 막아야 합니다.",
    image: "/assets/tutorial/room-defense-guide.webp",
    imageAlt: "문과 포탑으로 구성된 익명 방어실",
    steps: [
      {
        title: "암전 속 방 찾기",
        description:
          "귀신 소개가 끝나면 내 주변 두 칸만 보입니다. 귀신이 빛 안에 들어오면 추격하므로, 빈 방 안으로 들어가 시야를 끊고 침대 가까이에서 잠자기를 누르세요.",
      },
      {
        title: "문과 복도 조명",
        description:
          "방에 들어가면 문이 닫히고 안쪽 문 앞으로 가면 다시 열립니다. 침대를 점유하면 내 방이 밝아지며, 30초 뒤에는 복도 조명이 모두 켜집니다.",
      },
      {
        title: "설치와 강화",
        description:
          "내 방의 빈 ＋ 타일에서 설치합니다. 업그레이드 가능한 건물에는 작은 화살표가 나타납니다.",
      },
      {
        title: "전략 건물",
        description:
          "포탑만 많다고 지켜낼 수 없어요. 서리 스프레이, 그물 등 특수 건물들을 이용해 나만의 전략을 만드세요.",
      },
    ],
  },
  modes: {
    label: "방식",
    eyebrow: "PLAY MODES",
    title: "상황에 맞는 방식 선택",
    intro:
      "홈의 플레이 방식 버튼에서 혼자하기, 친구랑하기, 랭크전을 바꿀 수 있습니다.",
    image: "/assets/tutorial/ranked-coop-guide.webp",
    imageAlt: "서로 다른 방에서 협력하는 익명 생존자들",
    steps: [
      {
        title: "혼자하기",
        description:
          "생존 봇 3명과 함께 일반 스테이지를 진행합니다. 혼자하기 전용 등급과 스테이지가 기록됩니다.",
      },
      {
        title: "친구랑하기",
        description:
          "초대 코드로 친구와 실시간 협동합니다. 친구랑하기 전용 진행도와 등급이 따로 쌓입니다.",
      },
      {
        title: "랭크전",
        description:
          "4인 자동 대기열에서 같은 시즌 계약을 진행합니다. 일반 성장과 별도의 시즌 RP와 순위를 사용합니다.",
      },
    ],
  },
  points: {
    label: "포인트",
    eyebrow: "POINTS & REWARDS",
    title: "승리 보상과 포인트",
    intro:
      "커스텀 포인트는 게임을 클리어하면 얻는 영구 재화입니다. 골드와 전기는 한 판 안에서만 사용됩니다.",
    image: "/assets/tutorial/rewards-points-guide.webp",
    imageAlt: "침대, 코인, 전기 구슬과 보상 상자가 있는 익명 방",
    steps: [
      {
        title: "클리어 보상",
        description:
          "승리하면 스테이지에 따라 80P부터 최대 500P까지 받습니다. 타임어택 클리어는 보너스가 적용됩니다.",
      },
      {
        title: "사용처",
        description:
          "포인트로 캐릭터·완성형 스킨을 영구 구매하고, 전술 보급품은 수량 단위로 구매합니다.",
      },
      {
        title: "판 안 자원",
        description:
          "골드와 전기는 해당 게임에서만 쓰입니다. 침대, 발전기, 보석, 랜덤 보상으로 확보하세요.",
      },
    ],
  },
  ranked: {
    label: "랭크전",
    eyebrow: "RANKED CONTRACT",
    title: "14일 시즌 랭크전",
    intro:
      "랭크전은 같은 계약 조건에서 협동 실력을 겨루는 4인 시즌 모드입니다.",
    image: "/assets/tutorial/ranked-coop-guide.webp",
    imageAlt: "네 방에서 귀신을 함께 막는 익명 랭크전 장면",
    steps: [
      {
        title: "참가 조건",
        description:
          "혼자하기 노말 5 클리어와 일반 게임 완료 10회가 필요합니다. 첫 완료 전에는 Unranked로 표시됩니다.",
      },
      {
        title: "대기열",
        description:
          "비슷한 실력을 가진 4명의 생존자가 모이면 자동 시작합니다.",
      },
      {
        title: "시즌 순위",
        description:
          "계약별 최고 기록 중 상위 5개가 시즌 순위를 만듭니다. 시즌은 2주마다 집계와 보상 후 초기화됩니다.",
      },
    ],
  },
  "time-attack": {
    label: "타임어택",
    eyebrow: "LIMITED EVENT",
    title: "시간 안에 귀신을 처치하세요",
    intro:
      "악몽 이상 일반 스테이지에서는 일정 확률로 타임어택이 시작될 수 있습니다.",
    image: "/assets/tutorial/time-attack-guide.webp",
    imageAlt: "붉은 시간 경보 아래 커진 귀신과 방어실",
    steps: [
      {
        title: "시작 연출",
        description: "화면에 'TIME ATTACK'이 표시되며 게임이 시작됩니다.",
      },
      {
        title: "5분 제한",
        description:
          "준비 시간이 끝나면 5분 안에 귀신을 처치하고 탈출해야 합니다. 좌측 하단 타이머를 확인하세요.",
      },
      {
        title: "오버타임",
        description:
          "시간이 끝나면 귀신이 커지고, 이후 점차 HP·공격력·공격속도가 강해집니다. 클리어하면 포인트와 XP 보너스를 받습니다.",
      },
    ],
  },
};

const TUTORIAL_TOPIC_FOR_VIEW: Partial<Record<string, TutorialTopic>> = {};

function guideIconMarkup(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 10.5v5M12 7.5h.01"/></svg>';
}

function guideButtonMarkup(
  topic: TutorialTopic,
  className = "page-guide-button",
): string {
  return `<button class="${className}" data-page-guide data-guide-topic="${topic}" aria-label="${TUTORIALS[topic].title} 도움말">${guideIconMarkup()}</button>`;
}

function bindPageGuides(scope: Element = app): void {
  scope
    .querySelectorAll<HTMLButtonElement>("[data-page-guide]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        audio.play("button");
        showTutorial(
          (button.dataset.guideTopic as TutorialTopic | undefined) ?? "battle",
        );
      }),
    );
}

function showTutorial(initialTopic: TutorialTopic = "battle"): void {
  let activeTopic = initialTopic;
  const modal = dismissibleModal(
    '<section class="tutorial-sheet" role="dialog" aria-modal="true" aria-labelledby="tutorial-title"><header><div><small>FIELD GUIDE</small><h2 id="tutorial-title">생존 가이드</h2></div><button data-modal-close aria-label="닫기">×</button></header><nav class="tutorial-tabs" aria-label="가이드 주제"></nav><div class="tutorial-content"></div></section>',
    "tutorial-modal",
  );
  const render = (): void => {
    const tutorial = TUTORIALS[activeTopic];
    const tabs = modal.querySelector<HTMLElement>(".tutorial-tabs");
    const content = modal.querySelector<HTMLElement>(".tutorial-content");
    if (!tabs || !content) return;
    tabs.innerHTML = TUTORIAL_ORDER.map(
      (topic) =>
        `<button class="${topic === activeTopic ? "active" : ""}" data-tutorial-topic="${topic}" aria-pressed="${topic === activeTopic}">${TUTORIALS[topic].label}</button>`,
    ).join("");
    content.innerHTML = `<figure class="tutorial-scene"><img src="${tutorial.image}" alt="${tutorial.imageAlt}"/><figcaption><span>${tutorial.eyebrow}</span><h3>${tutorial.title}</h3><p>${tutorial.intro}</p></figcaption></figure><ol class="tutorial-steps">${tutorial.steps.map((step, index) => `<li><b>${String(index + 1).padStart(2, "0")}</b><div><strong>${step.title}</strong><p>${step.description}</p></div></li>`).join("")}</ol>`;
    tabs
      .querySelectorAll<HTMLButtonElement>("[data-tutorial-topic]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          activeTopic = button.dataset.tutorialTopic as TutorialTopic;
          render();
        }),
      );
  };
  render();
}

function setContent(view: string, html: string): void {
  if (view !== "ranked-queue" && rankedQueuePollTimer) {
    window.clearTimeout(rankedQueuePollTimer);
    rankedQueuePollTimer = 0;
  }
  customAvatarPreview?.destroy();
  customAvatarPreview = null;
  currentView = view;
  audio.setBackgroundTrack(backgroundTrackForView(view));
  app.dataset.view = view;
  const guideTopic = TUTORIAL_TOPIC_FOR_VIEW[view];
  const floatingGuide =
    guideTopic && view !== "home" ? guideButtonMarkup(guideTopic) : "";
  app.innerHTML = `${html}${floatingGuide}<button class="btn icon-btn" data-settings aria-label="설정">⚙</button><div class="toast" id="toast"></div>`;
  app.querySelector("[data-settings]")?.addEventListener("click", showSettings);
  bindPageGuides();
}

function loading(): void {
  setContent(
    "loading",
    loadingMarkup("병동에 들어가는 중", "잠시 후 불 꺼진 복도가 열립니다."),
  );
}

function loadingMarkup(title: string, detail: string): string {
  return `<main class="boot-screen"><div class="boot-backdrop" aria-hidden="true"></div><header class="boot-brand"><i aria-hidden="true">☾</i><span>심야 병동</span></header><section class="boot-status" role="status"><small>LOADING</small><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p><div class="boot-progress" aria-hidden="true"><i></i></div></section></main>`;
}

function desktopNotice(): void {
  setContent(
    "desktop",
    `<main class="screen"><section class="panel compact desktop-card"><div class="desktop-icon">📱</div><span class="eyebrow">MOBILE ONLY</span><h2>모바일 전용 게임입니다</h2><p class="subtitle">휴대폰 브라우저에서 세로 또는 가로 모드로 플레이하세요. 개발 환경에서는 주소 끝에 <strong>?dev=1</strong>을 붙일 수 있습니다.</p></section></main>`,
  );
}

function openingTeaser(complete: () => void): void {
  if (testShellMode || profile.openingSeen) {
    complete();
    return;
  }
  currentView = "opening";
  audio.setBackgroundTrack(null);
  app.dataset.view = "opening";
  app.innerHTML = `<main class="opening-teaser"><div class="teaser-film"></div><section class="teaser-title"><span class="eyebrow">A MIDNIGHT SURVIVAL</span><h1>심야 병동</h1><p data-teaser-copy>문이 닫히기 전에, 살아남을 방을 찾아라.</p></section><button class="teaser-skip" data-teaser-skip>건너뛰기</button><div class="teaser-progress"><i></i></div></main>`;
  const copy = app.querySelector<HTMLElement>("[data-teaser-copy]");
  const lines = [
    "문이 닫히기 전에, 살아남을 방을 찾아라.",
    "침대가 깨어나면 새벽의 방어가 시작된다.",
    "하지만 복도에는 이미 누군가가 있다.",
  ];
  let line = 0;
  const copyTimer = window.setInterval(() => {
    line += 1;
    if (copy && lines[line]) {
      copy.classList.add("changing");
      window.setTimeout(() => {
        copy.textContent = lines[line] ?? "";
        copy.classList.remove("changing");
      }, 180);
    }
  }, 1_850);
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    window.clearInterval(copyTimer);
    window.clearTimeout(autoTimer);
    profile.openingSeen = true;
    saveProfile(profile);
    app.querySelector(".opening-teaser")?.classList.add("closing");
    window.setTimeout(() => {
      loading();
      complete();
    }, 420);
  };
  const autoTimer = window.setTimeout(finish, 6_700);
  app.querySelector("[data-teaser-skip]")?.addEventListener("click", finish);
}

function homeScreen(): void {
  if (!account) {
    authScreen();
    return;
  }
  const currentAccount = account;
  const selectedNormalRank =
    homePlayMode === "multiplayer"
      ? currentAccount.multiplayerRank
      : currentAccount.soloRank;
  const profileDisplay = accountProfileDisplayInfo(currentAccount);
  const profileAvatar =
    currentAccount.profileAvatarUrl ?? DEFAULT_PROFILE_AVATAR;
  const benefits = rankBenefits(selectedNormalRank);
  const stage = selectedHomeStage(currentAccount, homePlayMode);
  const modeLabel =
    homePlayMode === "solo"
      ? "혼자하기"
      : homePlayMode === "multiplayer"
        ? "친구랑하기"
        : "랭크전";
  const stageLabel =
    homePlayMode === "ranked"
      ? `${currentAccount.ranked.seasonId} 시즌 계약`
      : stage.label;
  const perk = `${benefits.speedMultiplier > 1 ? `이동 +${Math.round((benefits.speedMultiplier - 1) * 100)}%` : "기본 이동"} · 문 Lv.15 · 포탑 Lv.15`;
  setContent(
    "home",
    `<main class="game-home"><div class="home-atmosphere"></div><header class="home-topbar"><div class="home-profile-stack"><button class="home-account in-game-label ${profileDisplay.className}" data-profile-display-picker aria-haspopup="dialog" aria-label="프로필 설정"><div class="home-profile-photo"><img src="${escapeHtml(profileAvatar)}" alt="${escapeHtml(currentAccount.nickname)} 프로필 사진"/></div><div><span>프로필 설정</span><strong>${escapeHtml(currentAccount.nickname)} <img class="home-inline-badge rank-badge" src="${profileDisplay.badgeUrl}" alt="${escapeHtml(profileDisplay.badgeAlt)}"/></strong><small>${escapeHtml(profileDisplay.labelText)}</small><em>인게임 라벨 · 변경</em></div></button><div class="home-profile-quick-actions" aria-label="홈 빠른 메뉴"><button class="home-update-notice" data-app-updates aria-haspopup="dialog" aria-label="업데이트 내역"><img src="/assets/ui/update-megaphone.png?v=${APP_RELEASE_VERSION}" alt=""/></button><button class="home-hard-refresh" data-force-refresh aria-haspopup="dialog" aria-label="강력 새로고침" title="강력 새로고침"><span aria-hidden="true">↻</span></button><button class="home-ad-free" data-ad-free aria-label="광고 제거 예정"><img src="/assets/ui/ad-free-badge.png?v=${APP_RELEASE_VERSION}" alt=""/></button><button class="home-ranking-shortcut" data-ranking aria-label="랭킹"><img src="/assets/ui/ranking-podium.png?v=${APP_RELEASE_VERSION}" alt=""/></button>${guideButtonMarkup("battle", "home-guide")}</div></div><div class="home-utility"><strong>✦ ${currentAccount.customPoints.toLocaleString()} P</strong><button class="home-social" data-social aria-label="친구와 채팅">${homeUtilityIcon("social")}<b class="home-social-unread ${socialUnreadCount > 0 ? "visible" : ""}" aria-hidden="true"></b></button><button class="home-mailbox" data-mailbox aria-label="우편함">${homeUtilityIcon("mail")}<b class="home-mail-unread ${mailboxUnreadCount > 0 ? "visible" : ""}" aria-hidden="true"></b></button><button data-home-settings aria-label="설정">${homeUtilityIcon("settings")}</button></div></header><section class="home-avatar-showcase" aria-label="병원 복도를 천천히 걷는 내 캐릭터"><div class="home-avatar-model" data-home-avatar></div></section><button class="home-stage-summary" data-home-stage-picker aria-label="스테이지 난이도 선택" ${homePlayMode === "ranked" ? "disabled" : ""}><span>${homePlayMode === "ranked" ? "시즌 계약" : "현재 스테이지"}</span><strong>${stageLabel}</strong><small>${modeLabel} · ${homePlayMode === "ranked" ? `배치 ${Math.min(5, currentAccount.ranked.placementCompleted)}/5 · ${currentAccount.ranked.eligible ? "참가 가능" : "참가 조건 확인"}` : perk}</small><i>⌄</i></button><footer class="home-actions"><div class="home-launch"><button class="home-mode-select" data-home-mode-picker aria-haspopup="dialog"><span>${homePlayMode === "solo" ? "☾" : homePlayMode === "multiplayer" ? "◎" : "♛"}</span><div><small>플레이 방식</small><strong>${modeLabel}</strong></div><i>⌄</i></button><button class="game-start" data-stage-start data-testid="home-stage-start"><i>⚔</i><span><small>${stageLabel}</small>${homePlayMode === "ranked" ? "계약 시작" : "스테이지 시작"}</span></button></div><nav class="home-footer-nav" aria-label="게임 메뉴"><button data-shop aria-label="상점">${homeFooterIcon("shop")}</button><button class="active" data-stage-menu aria-label="스테이지">${homeFooterIcon("stage")}</button><button data-customize aria-label="커스텀">${homeFooterIcon("custom")}</button></nav></footer></main>`,
  );
  const avatarHost = app.querySelector<HTMLElement>("[data-home-avatar]");
  if (avatarHost) {
    customAvatarPreview = new AvatarPreview2D(
      avatarHost,
      currentAccount.appearance,
      selectedNormalRank,
    );
  }
  app.querySelector("[data-stage-start]")?.addEventListener("click", () => {
    audio.play("button");
    if (homePlayMode === "ranked") void joinRankedQueue();
    else void createRoom(homePlayMode === "solo", stage.id);
  });
  app
    .querySelector("[data-home-mode-picker]")
    ?.addEventListener("click", () => {
      audio.play("button");
      showHomeModePicker();
    });
  app
    .querySelector("[data-profile-display-picker]")
    ?.addEventListener("click", () => {
      audio.play("button");
      showProfileDisplayPicker();
    });
  app.querySelector("[data-stage-menu]")?.addEventListener("click", () => {
    audio.play("button");
    showHomeStagePicker();
  });
  app
    .querySelector("[data-home-stage-picker]")
    ?.addEventListener("click", () => {
      audio.play("button");
      showHomeStagePicker();
    });
  app.querySelector("[data-shop]")?.addEventListener("click", () => {
    audio.play("button");
    shopScreen();
  });
  app.querySelector("[data-customize]")?.addEventListener("click", () => {
    audio.play("button");
    customizeReturnView = "home";
    customizationScreen();
  });
  app.querySelector("[data-ranking]")?.addEventListener("click", () => {
    audio.play("button");
    showRankingPreview();
  });
  app.querySelector("[data-mailbox]")?.addEventListener("click", () => {
    audio.play("button");
    void showMailbox();
  });
  app.querySelector("[data-social]")?.addEventListener("click", () => {
    audio.play("button");
    void showSocialHub();
  });
  app.querySelector("[data-ad-free]")?.addEventListener("click", () => {
    audio.play("button");
    toast("광고 제거 기능은 추후 제공됩니다.");
  });
  app
    .querySelector("[data-home-settings]")
    ?.addEventListener("click", showSettings);
  app.querySelector("[data-app-updates]")?.addEventListener("click", () => {
    audio.play("button");
    void showAppUpdateHistory();
  });
  app.querySelector("[data-force-refresh]")?.addEventListener("click", () => {
    audio.play("button");
    showForceRefreshPrompt();
  });
  void refreshMailboxUnreadCount();
  void refreshSocialUnreadCount();
  startSocialRealtime();
  showSkinLaunchPromoCarousel();
}

interface SkinLaunchCampaign {
  id: "summer" | "cyberpunk";
  dismissedKey: string;
  ownedSkinIds: readonly string[];
  targetSkinId: string;
  className: string;
  ariaLabel: string;
  imageUrl: string;
  imageAlt: string;
  eyebrow: string;
  title: string;
  body: string;
  footnote: string;
}

const SKIN_LAUNCH_CAMPAIGNS: readonly SkinLaunchCampaign[] = [
  {
    id: "summer",
    dismissedKey: SUMMER_SPECIAL_PROMO_DISMISSED_KEY,
    ownedSkinIds: [SURFER_MONG_SKIN_ID, LIFEGUARD_RAON_SKIN_ID],
    targetSkinId: LIFEGUARD_RAON_SKIN_ID,
    className: "summer-special-promo",
    ariaLabel: "썸머 특별 스킨 동시 출시",
    imageUrl: "/assets/cinematic/summer-special-skins-event.webp",
    imageAlt: "뒤집힐 듯 날아오른 서퍼 몽을 구하러 달려가는 해변 구조대 라온",
    eyebrow: "SUMMER SPECIAL SKINS",
    title: "썸머 특별 스킨<br/>동시 출시!",
    body: "파도를 타는 서퍼 몽과<br/>해변을 지키는 구조대 라온을 만나보세요.",
    footnote: "여름 한정 2종 · 각 5,000 P",
  },
  {
    id: "cyberpunk",
    dismissedKey: CYBERPUNK_SPECIAL_PROMO_DISMISSED_KEY,
    ownedSkinIds: [NEON_RIDER_LULU_SKIN_ID, CYBER_DRIVER_KONG_SKIN_ID],
    targetSkinId: NEON_RIDER_LULU_SKIN_ID,
    className: "cyberpunk-special-promo",
    ariaLabel: "사이버펑크 프리미엄 스킨 동시 출시",
    imageUrl: "/assets/cinematic/cyberpunk-premium-skins-event.webp",
    imageAlt: "네온 인라인을 타는 루루와 사이버 스포츠카를 모는 콩",
    eyebrow: "CYBERPUNK PREMIUM",
    title: "네온 시티를<br/>질주하라!",
    body: "네온 라이더 루루와<br/>사이버 드라이버 콩이 도착했습니다.",
    footnote: "프리미엄 2종 · 각 5,000 P",
  },
] as const;

function skinLaunchPromoDismissed(campaign: SkinLaunchCampaign): boolean {
  try {
    return window.localStorage.getItem(campaign.dismissedKey) === "1";
  } catch {
    return false;
  }
}

function permanentlyDismissSkinLaunchPromo(campaign: SkinLaunchCampaign): void {
  try {
    window.localStorage.setItem(campaign.dismissedKey, "1");
  } catch {
    // Private browsing can reject storage writes. The session guard still
    // prevents the promotion from reopening while this app instance is alive.
  }
}

function showSkinLaunchPromoCarousel(): void {
  if (
    !account ||
    !account.tutorialCompleted ||
    skinLaunchPromoShownThisSession
  ) return;
  const currentAccount = account;
  const campaigns = SKIN_LAUNCH_CAMPAIGNS.filter(
    (campaign) =>
      !skinLaunchPromoDismissed(campaign)
      && !campaign.ownedSkinIds.every((skinId) =>
        currentAccount.ownedCosmetics.includes(skinId),
      ),
  );
  if (!campaigns.length) return;
  skinLaunchPromoShownThisSession = true;
  let activeIndex = 0;
  const modal = document.createElement("div");
  modal.className = "modal-backdrop surfer-mong-promo-modal";
  const renderCampaign = (): void => {
    const campaign = campaigns[activeIndex];
    if (!campaign) {
      modal.remove();
      return;
    }
    const carouselControls =
      campaigns.length > 1
        ? `<nav class="skin-promo-carousel-nav" aria-label="출시 이벤트 이동"><button type="button" data-launch-promo-prev aria-label="이전 이벤트">‹</button><div>${campaigns
            .map(
              (_, index) =>
                `<button type="button" class="${index === activeIndex ? "active" : ""}" data-launch-promo-index="${index}" aria-label="${index + 1}번째 이벤트"${index === activeIndex ? ' aria-current="true"' : ""}></button>`,
            )
            .join("")}</div><button type="button" data-launch-promo-next aria-label="다음 이벤트">›</button></nav>`
        : "";
    modal.innerHTML = `<section class="surfer-mong-promo ${campaign.className}" role="dialog" aria-modal="true" aria-label="${campaign.ariaLabel}" data-launch-promo="${campaign.id}"><div class="surfer-mong-promo-art"><img src="${campaign.imageUrl}?v=${APP_RELEASE_VERSION}" alt="${campaign.imageAlt}"/><div class="surfer-mong-promo-copy"><span>${campaign.eyebrow}</span><h2>${campaign.title}</h2><p>${campaign.body}</p><small>${campaign.footnote}</small></div>${carouselControls}</div><footer><button type="button" class="surfer-promo-dismiss" data-launch-promo-dismiss>다시 보지 않기</button><button type="button" class="surfer-promo-shop" data-launch-promo-shop>스킨 보러 가기</button></footer></section>`;
  };
  renderCampaign();
  app.appendChild(modal);
  modal.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const campaign = campaigns[activeIndex];
    if (!campaign) return;
    if (target.closest("[data-launch-promo-dismiss]")) {
      audio.play("button");
      permanentlyDismissSkinLaunchPromo(campaign);
      campaigns.splice(activeIndex, 1);
      if (!campaigns.length) {
        modal.remove();
        return;
      }
      activeIndex %= campaigns.length;
      renderCampaign();
      return;
    }
    if (target.closest("[data-launch-promo-shop]")) {
      audio.play("button");
      modal.remove();
      shopScreen("skin", campaign.targetSkinId);
      return;
    }
    if (target.closest("[data-launch-promo-prev]")) {
      audio.play("button");
      activeIndex = (activeIndex - 1 + campaigns.length) % campaigns.length;
      renderCampaign();
      return;
    }
    if (target.closest("[data-launch-promo-next]")) {
      audio.play("button");
      activeIndex = (activeIndex + 1) % campaigns.length;
      renderCampaign();
      return;
    }
    const indexButton = target.closest<HTMLElement>("[data-launch-promo-index]");
    if (indexButton) {
      const nextIndex = Number(indexButton.dataset.launchPromoIndex);
      if (Number.isInteger(nextIndex) && campaigns[nextIndex]) {
        audio.play("button");
        activeIndex = nextIndex;
        renderCampaign();
      }
    }
  });
}

function homeUtilityIcon(kind: "mail" | "social" | "settings"): string {
  if (kind === "mail") {
    return '<svg class="home-utility-icon" viewBox="0 0 48 48" aria-hidden="true"><rect x="7" y="12" width="34" height="25" rx="5"/><path d="m9 16 15 12L39 16M9 34l10-10m20 10-10-10"/><path d="M15 8h18"/></svg>';
  }
  if (kind === "social") {
    return '<svg class="home-utility-icon" viewBox="0 0 48 48" aria-hidden="true"><circle cx="18" cy="18" r="7"/><path d="M5 39c1-8 6-12 13-12s12 4 13 12"/><circle cx="34" cy="20" r="5"/><path d="M30 30c7 0 11 3 13 9"/></svg>';
  }
  return '<svg class="home-utility-icon" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 9v4M24 35v4M39 24h-4M13 24H9M34.6 13.4l-2.8 2.8M16.2 31.8l-2.8 2.8M34.6 34.6l-2.8-2.8M16.2 16.2l-2.8-2.8"/><circle cx="24" cy="24" r="8"/><path d="M24 5.5c2.3 0 4.2 1.9 4.2 4.2l2.5 1c1.7-1.5 4.3-1.3 5.8.4 1.5 1.7 1.3 4.3-.4 5.8l1 2.5c2.3 0 4.2 1.9 4.2 4.2s-1.9 4.2-4.2 4.2l-1 2.5c1.5 1.7 1.3 4.3-.4 5.8-1.7 1.5-4.3 1.3-5.8-.4l-2.5 1c0 2.3-1.9 4.2-4.2 4.2s-4.2-1.9-4.2-4.2l-2.5-1c-1.7 1.5-4.3 1.3-5.8-.4-1.5-1.7-1.3-4.3.4-5.8l-1-2.5c-2.3 0-4.2-1.9-4.2-4.2s1.9-4.2 4.2-4.2l1-2.5c-1.5-1.7-1.3-4.3.4-5.8 1.7-1.5 4.3-1.3 5.8.4l2.5-1c0-2.3 1.9-4.2 4.2-4.2Z"/></svg>';
}

function gameActionIcon(kind: "bag" | "bed"): string {
  if (kind === "bag") {
    return '<svg class="game-action-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M18 22h28l5 33H13z"/><path d="M23 24v-5c0-6 4-10 9-10s9 4 9 10v5M20 35h24M27 42h10v8H27z"/><circle cx="20" cy="29" r="2"/><circle cx="44" cy="29" r="2"/></svg>';
  }
  return '<svg class="game-action-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M9 43h46v10H9zM13 26h38c3 0 5 2 5 5v12H8V31c0-3 2-5 5-5z"/><path d="M13 26v-8h15c4 0 7 3 7 7v1M14 53v4m36-4v4"/><circle cx="19" cy="22" r="4"/></svg>';
}

function homeFooterIcon(kind: "shop" | "stage" | "custom"): string {
  if (kind === "shop") {
    return '<svg class="home-nav-icon" viewBox="0 0 64 64" aria-hidden="true"><path class="icon-fill" d="M12 27h40v26H12z"/><path d="M9 26l5-15h36l5 15M16 27v26m32-26v26M8 53h48M24 53V37h16v16"/><path class="icon-accent" d="M11 26c0 5 8 5 8 0 0 5 8 5 8 0 0 5 10 5 10 0 0 5 8 5 8 0 0 5 8 5 8 0"/></svg>';
  }
  if (kind === "stage") {
    return '<svg class="home-nav-icon" viewBox="0 0 64 64" aria-hidden="true"><path class="icon-fill" d="M32 7 51 18v19c0 11-8 17-19 21-11-4-19-10-19-21V18z"/><path d="m20 43 24-24m-20-2 23 23M18 47l8-2-6-6zm28 0-8-2 6-6z"/><circle class="icon-accent" cx="32" cy="31" r="5"/></svg>';
  }
  return '<svg class="home-nav-icon" viewBox="0 0 64 64" aria-hidden="true"><path class="icon-fill" d="M13 31c0-12 8-21 19-21s19 9 19 21v18c-5 5-12 8-19 8s-14-3-19-8z"/><path d="M18 17 12 8l12 5m22 4 6-9-12 5M13 31c0-12 8-21 19-21s19 9 19 21v18c-5 5-12 8-19 8s-14-3-19-8z"/><circle cx="24" cy="31" r="3"/><circle cx="40" cy="31" r="3"/><path class="icon-accent" d="M28 41c2 2 6 2 8 0m-8-4 4 3 4-3"/></svg>';
}

function selectedHomeStage(
  currentAccount: AccountProfile,
  mode: HomePlayMode,
): ReturnType<typeof getStage> {
  const progressionMode: PlayMode =
    mode === "multiplayer" ? "multiplayer" : "solo";
  const stageIndex =
    progressionMode === "solo"
      ? currentAccount.soloStageIndex
      : currentAccount.multiplayerStageIndex;
  const unlocked = stagesThrough(stageIndex);
  const selected = unlocked.find(
    (candidate) => candidate.id === homeStageSelection[progressionMode],
  );
  const fallback = unlocked.at(-1) ?? getStage("easy-1");
  homeStageSelection[progressionMode] = (selected ?? fallback).id;
  return selected ?? fallback;
}

function dismissibleModal(markup: string, className: string): HTMLElement {
  const modal = document.createElement("div");
  modal.className = `modal-backdrop ${className}`;
  modal.innerHTML = markup;
  modal.addEventListener("pointerdown", (event) => {
    if (event.target === modal) modal.remove();
  });
  modal
    .querySelector("[data-modal-close]")
    ?.addEventListener("click", () => modal.remove());
  app.appendChild(modal);
  return modal;
}

async function withGlobalActionLoading<T>(
  message: string,
  action: () => Promise<T>,
): Promise<T> {
  app.querySelector("[data-action-loading]")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "global-action-loading";
  overlay.dataset.actionLoading = "";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.setAttribute("aria-busy", "true");
  overlay.innerHTML = `<div class="global-action-loading-card"><div class="spinner" aria-hidden="true"></div><strong>${escapeHtml(message)}</strong><small>잠시만 기다려주세요.</small></div>`;
  app.appendChild(overlay);
  try {
    return await action();
  } finally {
    overlay.remove();
  }
}

function confirmPointPurchase(options: {
  label: string;
  quantity?: number;
  pointCost: number;
  onConfirm: () => void;
}): void {
  const quantity = options.quantity ?? 1;
  const modal = dismissibleModal(
    `<section class="panel compact purchase-confirm" role="dialog" aria-modal="true" aria-labelledby="purchase-confirm-title"><span class="eyebrow">POINT PURCHASE</span><h2 id="purchase-confirm-title">구매하시겠습니까?</h2><p class="subtitle"><strong>${escapeHtml(options.label)}</strong>${quantity > 1 ? ` ${quantity}개` : ""}을(를) 구매합니다.</p><div class="purchase-confirm-cost">✦ ${options.pointCost.toLocaleString()} P</div><div class="purchase-confirm-actions"><button class="btn ghost" data-modal-close>취소</button><button class="btn gold" data-purchase-confirm>구매하기</button></div></section>`,
    "purchase-confirm-modal",
  );
  modal
    .querySelector<HTMLButtonElement>("[data-purchase-confirm]")
    ?.addEventListener("click", () => {
      modal.remove();
      options.onConfirm();
    });
}

function showHomeModePicker(): void {
  if (!account) return;
  const modal = dismissibleModal(
    `<section class="home-picker-sheet" role="dialog" aria-modal="true" aria-labelledby="mode-picker-title"><header><div><small>PLAY MODE</small><h2 id="mode-picker-title">플레이 방식 선택</h2></div><button data-modal-close aria-label="닫기">×</button></header><div class="home-mode-options"><button class="${homePlayMode === "solo" ? "selected" : ""}" data-home-mode="solo"><i>☾</i><span><strong>혼자하기</strong><small>생존 봇 3명과 함께 방어합니다.</small></span><b>선택</b></button><button class="${homePlayMode === "multiplayer" ? "selected" : ""}" data-home-mode="multiplayer"><i>◎</i><span><strong>친구랑하기</strong><small>친구와 실시간으로 협동합니다.</small></span><b>선택</b></button><button class="${homePlayMode === "ranked" ? "selected" : ""} ${account.ranked.eligible ? "" : "locked"}" data-home-mode="ranked" ${account.ranked.eligible ? "" : "disabled"}><i>♛</i><span><strong>랭크전</strong><small>${account.ranked.eligible ? `${account.ranked.seasonId} · 48시간 계약` : "혼자하기 노말 5 · 일반 10회 필요"}</small></span><b>${account.ranked.eligible ? "선택" : "잠김"}</b></button></div><div class="home-invite"><label for="invite-code">친구 방 초대 코드</label><div><input class="code-input" id="invite-code" type="text" maxlength="8" value="${escapeHtml(profile.recentRoomCode)}" placeholder="8자리 코드"/><button data-home-join>참가</button></div></div></section>`,
    "home-picker-modal",
  );
  modal.querySelectorAll<HTMLElement>("[data-home-mode]").forEach((button) =>
    button.addEventListener("click", () => {
      const next: HomePlayMode =
        button.dataset.homeMode === "ranked"
          ? "ranked"
          : button.dataset.homeMode === "multiplayer"
            ? "multiplayer"
            : "solo";
      void setSelectedPlayMode(next)
        .then((updated) => {
          account = updated;
          homePlayMode = next;
          modal.remove();
          homeScreen();
        })
        .catch((error) =>
          toast(
            error instanceof Error
              ? error.message
              : "플레이 방식을 저장하지 못했습니다.",
          ),
        );
    }),
  );
  modal
    .querySelector<HTMLInputElement>("#invite-code")
    ?.addEventListener("input", (event) => {
      const input = event.currentTarget as HTMLInputElement;
      input.value = input.value.toUpperCase().replace(/[^A-Z2-9]/g, "");
    });
  modal
    .querySelector("[data-home-join]")
    ?.addEventListener("click", () => void joinRoom());
}

async function compactProfileAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/"))
    throw new Error("이미지 파일만 선택할 수 있습니다.");
  if (file.size > 12 * 1024 * 1024)
    throw new Error("12MB 이하의 사진을 선택해주세요.");
  const sourceUrl = URL.createObjectURL(file);
  try {
    const source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(new Error("사진을 읽지 못했습니다. 다른 파일을 선택해주세요."));
      image.src = sourceUrl;
    });
    for (const side of [192, 160, 128]) {
      const canvas = document.createElement("canvas");
      canvas.width = side;
      canvas.height = side;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("사진을 처리할 수 없습니다.");
      const sourceSide = Math.min(source.naturalWidth, source.naturalHeight);
      const sx = (source.naturalWidth - sourceSide) / 2;
      const sy = (source.naturalHeight - sourceSide) / 2;
      context.drawImage(
        source,
        sx,
        sy,
        sourceSide,
        sourceSide,
        0,
        0,
        side,
        side,
      );
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", 0.82),
      );
      if (!blob || blob.size > 72 * 1024) continue;
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === "string"
            ? resolve(reader.result)
            : reject(new Error("사진을 처리하지 못했습니다."));
        reader.onerror = () => reject(new Error("사진을 처리하지 못했습니다."));
        reader.readAsDataURL(blob);
      });
    }
    throw new Error(
      "사진을 더 작게 압축하지 못했습니다. 다른 사진을 선택해주세요.",
    );
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function showProfileDisplayPicker(): void {
  if (!account) return;
  const currentAccount = account;
  const modes: readonly ProfileDisplayMode[] =
    currentAccount.ranked.contractsPlayed > 0
      ? ["solo", "multiplayer", "ranked"]
      : ["solo", "multiplayer"];
  const cards = modes
    .map((mode) => {
      const display = accountProfileDisplayInfo(currentAccount, mode);
      const selected = currentAccount.profileDisplayMode === mode;
      return `<button class="profile-display-option ${display.className} ${selected ? "selected" : ""}" data-profile-display-mode="${mode}" aria-pressed="${selected}"><img src="${display.badgeUrl}" alt="${escapeHtml(display.badgeAlt)}"/><span><em>${display.modeLabel}</em><strong>${escapeHtml(display.rankText)}</strong><small>${escapeHtml(display.labelText)} · ${escapeHtml(currentAccount.nickname)}</small></span><b>${selected ? "표시 중" : "선택"}</b></button>`;
    })
    .join("");
  const modal = dismissibleModal(
    `<section class="home-picker-sheet profile-display-sheet" role="dialog" aria-modal="true" aria-labelledby="profile-display-title"><header><div><small>PROFILE SETTINGS</small><h2 id="profile-display-title">프로필 설정</h2></div><button data-modal-close aria-label="닫기">×</button></header><section class="profile-photo-editor"><img src="${escapeHtml(currentAccount.profileAvatarUrl ?? DEFAULT_PROFILE_AVATAR)}" alt="${escapeHtml(currentAccount.nickname)} 프로필 사진"/><strong>${escapeHtml(currentAccount.nickname)}</strong><div><label class="btn ghost profile-photo-select">사진 선택<input type="file" accept="image/jpeg,image/png,image/webp" data-profile-photo-input/></label><button class="btn ghost" data-profile-avatar-reset ${currentAccount.profileAvatarUrl ? "" : "disabled"}>기본 이미지</button></div><small>사진은 정사각형으로 안전하게 축소되어 저장됩니다.</small></section><h3 class="profile-display-heading">인게임 라벨 설정</h3><p class="profile-display-intro">선택한 뱃지와 라벨은 모든 인게임 이름표에 표시됩니다. 플레이 방식과 전투 능력치는 바뀌지 않습니다.</p><div class="profile-display-options">${cards}</div><section class="profile-title-slot"><div><small>칭호</small><strong>칭호 없음</strong></div><p>시즌 보상이나 업적 칭호를 획득하면 이곳에서 표시할 칭호를 고를 수 있습니다.</p></section></section>`,
    "home-picker-modal profile-display-modal",
  );
  modal
    .querySelectorAll<HTMLButtonElement>("[data-profile-display-mode]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const next = button.dataset.profileDisplayMode as ProfileDisplayMode;
        button.disabled = true;
        void setProfileDisplayMode(next)
          .then((updated) => {
            account = updated;
            modal.remove();
            homeScreen();
            toast("인게임 라벨을 변경했습니다.");
          })
          .catch((error) => {
            button.disabled = false;
            toast(
              error instanceof Error
                ? error.message
                : "인게임 라벨을 저장하지 못했습니다.",
            );
          });
      }),
    );
  modal
    .querySelector<HTMLInputElement>("[data-profile-photo-input]")
    ?.addEventListener("change", (event) => {
      const input = event.currentTarget as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      input.disabled = true;
      void compactProfileAvatar(file)
        .then((avatarData) => setProfileAvatar(avatarData))
        .then((updated) => {
          account = updated;
          modal.remove();
          homeScreen();
          showProfileDisplayPicker();
          toast("프로필 사진을 저장했습니다.");
        })
        .catch((error) => {
          input.disabled = false;
          toast(
            error instanceof Error
              ? error.message
              : "프로필 사진을 저장하지 못했습니다.",
          );
        });
    });
  modal
    .querySelector<HTMLButtonElement>("[data-profile-avatar-reset]")
    ?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      void setProfileAvatar(null)
        .then((updated) => {
          account = updated;
          modal.remove();
          homeScreen();
          showProfileDisplayPicker();
          toast("기본 프로필 이미지로 되돌렸습니다.");
        })
        .catch((error) => {
          button.disabled = false;
          toast(
            error instanceof Error
              ? error.message
              : "프로필 사진을 변경하지 못했습니다.",
          );
        });
    });
}

function showHomeStagePicker(): void {
  if (!account) return;
  const currentAccount = account;
  const progressionMode: PlayMode =
    homePlayMode === "multiplayer" ? "multiplayer" : "solo";
  const unlocked = [...stagesThrough(
    progressionMode === "solo"
      ? currentAccount.soloStageIndex
      : currentAccount.multiplayerStageIndex,
  )].reverse();
  const selected = selectedHomeStage(currentAccount, homePlayMode);
  const modal = dismissibleModal(
    `<section class="home-picker-sheet stage-picker-sheet" role="dialog" aria-modal="true" aria-labelledby="stage-picker-title"><header><div><small>STAGE</small><h2 id="stage-picker-title">도전할 스테이지</h2></div><button data-modal-close aria-label="닫기">×</button></header><div class="home-stage-grid">${unlocked
      .map(
        (stage) =>
          `<button class="${stage.id === selected.id ? "selected" : ""}" data-home-stage="${stage.id}"><span>${stageThemeFor(stage.id).label}</span><strong>${stage.label}</strong></button>`,
      )
      .join("")}</div></section>`,
    "home-picker-modal",
  );
  modal.querySelectorAll<HTMLElement>("[data-home-stage]").forEach((button) =>
    button.addEventListener("click", () => {
      homeStageSelection[progressionMode] = button.dataset.homeStage as StageId;
      modal.remove();
      homeScreen();
    }),
  );
}

function showRankingPreview(): void {
  if (!account) return;
  const currentAccount = account;
  const hasPlayedRanked = currentAccount.ranked.contractsPlayed > 0;
  const rankedStatus = hasPlayedRanked
    ? RANKED_TIER_LABEL[currentAccount.ranked.tier]
    : "Unranked";
  const rankedStatusBadge = hasPlayedRanked
    ? rankedBadgeImage(currentAccount.ranked.tier)
    : rankBadgeImage("beginner");
  const crown =
    currentAccount.ranked.tier === "challenger" ||
    currentAccount.ranked.tier === "master"
      ? "gold"
      : currentAccount.ranked.tier === "diamond" ||
          currentAccount.ranked.tier === "platinum"
        ? "silver"
        : "bronze";
  const crownForPlacement = (
    placement: number,
  ): "gold" | "silver" | "bronze" | null =>
    placement === 1
      ? "gold"
      : placement <= 5
        ? "silver"
        : placement <= 20
          ? "bronze"
          : null;
  dismissibleModal(
    `<section class="home-picker-sheet ranking-sheet" role="dialog" aria-modal="true" aria-labelledby="ranking-title"><header><div><small>RANKING</small><h2 id="ranking-title">${currentAccount.ranked.seasonId} 랭킹</h2></div><button data-modal-close aria-label="닫기">×</button></header><div class="ranking-my-record ranked-my-record"><span><img src="${rankedStatusBadge}" alt="${rankedStatus}"/></span><div><small>내 랭크전 등급</small><strong>${escapeHtml(currentAccount.nickname)}${hasPlayedRanked ? `<img class="season-crown" src="/assets/ranks/crown-${crown}.png" alt="시즌 왕관"/>` : ""}</strong><p>${rankedStatus}${hasPlayedRanked ? ` · ${currentAccount.ranked.rating} RP` : ""} · 배치 ${Math.min(5, currentAccount.ranked.placementCompleted)}/5</p></div></div><p class="ranking-notice">2주 시즌 · 48시간 계약 7개 · 최고 5개 점수 반영. 시즌 종료 뒤 순위 보상과 한정 칭호를 지급합니다.</p><ol class="ranked-leaderboard" data-ranked-leaderboard><li>시즌 순위를 불러오는 중…</li></ol><div class="ranked-reward-strip"><span>1위 · 금 왕관</span><span>2~5위 · 은 왕관</span><span>6~20위 · 동 왕관</span></div></section>`,
    "home-picker-modal",
  );
  const board = document.querySelector<HTMLOListElement>(
    "[data-ranked-leaderboard]",
  );
  void fetch("/api/ranked/season")
    .then(async (response) =>
      response.ok
        ? (response.json() as Promise<{
            leaderboard?: Array<{
              avatarUrl: string | null;
              rank: number;
              nickname: string;
              rating: number;
              tier: keyof typeof RANKED_TIER_LABEL;
            }>;
          }>)
        : Promise.reject(new Error("랭킹 조회 실패")),
    )
    .then((data) => {
      if (!board) return;
      board.innerHTML = data.leaderboard?.length
        ? data.leaderboard
            .map((entry) => {
              const placementCrown = crownForPlacement(entry.rank);
              const crownImage = placementCrown
                ? `<img class="leader-crown" src="/assets/ranks/crown-${placementCrown}.png" alt="${entry.rank}위 왕관"/>`
                : "";
              const tierName = RANKED_TIER_LABEL[entry.tier];
              return `<li><div class="leader-first"><b class="leader-place">${entry.rank}</b>${profileAvatarHtml(entry.avatarUrl, "leader-avatar profile-avatar")}<span class="leader-name">${escapeHtml(entry.nickname)}${crownImage}</span></div><span class="leader-tier"><img src="${rankedBadgeImage(entry.tier)}" alt="${escapeHtml(tierName)}" style="margin-top: 5px;"/><strong>${entry.rating.toLocaleString()} RP</strong></span></li>`;
            })
            .join("")
        : "<li>아직 기록된 시즌 계약이 없습니다.</li>";
    })
    .catch(() => {
      if (board) board.innerHTML = "<li>시즌 순위를 불러오지 못했습니다.</li>";
    });
}

const CUSTOM_SLOT_LABELS: Record<CosmeticSlot, string> = {
  character: "캐릭터",
  skin: "스킨",
  tile: "타일",
  turret: "포탑",
};

function tilePreviewUrl(tileSkinId: string | undefined): string {
  return (
    tileSkinTextureUrl(tileSkinId) ??
    "/assets/environment/hospital-room-tile-v2.png"
  );
}

function modelPreviewHtml(
  turretMode = false,
  tileSkinId?: string,
  turretSkinId?: string,
  tileMode = false,
): string {
  if (tileMode) {
    if (!tileSkinId) {
      return `<div class="custom-avatar-stage tile-skin-preview-stage empty-tile-preview" data-avatar-preview><div class="tile-skin-preview-room" aria-hidden="true"></div></div>`;
    }
    return `<div class="custom-avatar-stage tile-skin-preview-stage" data-avatar-preview><div class="tile-skin-preview-room" data-tile-preview-room><img data-tile-preview src="${tilePreviewUrl(tileSkinId)}?v=${APP_RELEASE_VERSION}" alt="선택한 타일 스킨 미리보기"/></div></div>`;
  }
  if (turretMode) {
    const previewUrl =
      turretSkinAssetUrl(turretSkinId, 1) ??
      "/assets/buildings/cute-basic-turret-1.png";
    return `<div class="custom-avatar-stage turret-skin-preview-stage" data-avatar-preview><img data-turret-preview src="${previewUrl}?v=${APP_RELEASE_VERSION}" alt="선택한 포탑 스킨 Lv.1 미리보기"/><span>레벨별 외형 적용</span></div>`;
  }
  const aria = turretMode ? "포탑 보는 방향" : "캐릭터 보는 방향";
  return `<div class="custom-avatar-stage ${turretMode ? "turret-stage" : ""}" data-avatar-preview><div class="custom-view-switch" aria-label="${aria}"><button class="active" data-avatar-view="front">앞</button><button data-avatar-view="side">옆</button><button data-avatar-view="back">뒤</button></div></div>`;
}

function showLiveCosmeticPreview(
  itemId: string,
  fallbackAppearance: AvatarAppearance,
  rank: RankId,
): void {
  const item = cosmeticById(itemId);
  if (!item) return;
  const modal = dismissibleModal(
    `<section class="live-cosmetic-sheet" role="dialog" aria-modal="true" aria-labelledby="live-preview-title"><header><div><small>IN-GAME PREVIEW</small><h2 id="live-preview-title">${escapeHtml(item.label)}</h2></div><button data-modal-close aria-label="닫기">×</button></header><div class="live-cosmetic-stage" data-live-preview-stage></div><p>${escapeHtml(item.description)}</p></section>`,
    "live-cosmetic-modal",
  );
  const stage = modal.querySelector<HTMLElement>("[data-live-preview-stage]");
  if (!stage) return;
  let avatarPreview: AvatarPreview2D | null = null;
  if (item.slot === "tile") {
    stage.classList.add("tile");
    stage.innerHTML = `<div class="live-tile-room"><img src="${tilePreviewUrl(item.id)}?v=${APP_RELEASE_VERSION}" alt="${escapeHtml(item.label)} 인게임 타일"/><span></span></div>`;
  } else if (item.slot === "turret") {
    stage.classList.add("turret");
    const art =
      turretSkinAssetUrl(item.id, 1) ??
      "/assets/buildings/cute-basic-turret-1.png";
    stage.innerHTML = `<div class="live-turret-room"><img src="${art}?v=${APP_RELEASE_VERSION}" alt="${escapeHtml(item.label)} 인게임 포탑"/><i></i><b></b></div>`;
  } else {
    stage.classList.add("avatar");
    const previewAppearance: AvatarAppearance =
      item.slot === "character"
        ? {
            character: item.id,
            skin: defaultSkinForCharacter(item.id),
            tileSkin: fallbackAppearance.tileSkin,
          }
        : {
            character: item.characterId ?? fallbackAppearance.character,
            skin: item.id,
            tileSkin: fallbackAppearance.tileSkin,
          };
    avatarPreview = new AvatarPreview2D(stage, previewAppearance, rank);
  }
  const cleanup = (): void => {
    avatarPreview?.destroy();
    avatarPreview = null;
  };
  const removalObserver = new MutationObserver(() => {
    if (modal.isConnected) return;
    cleanup();
    removalObserver.disconnect();
  });
  removalObserver.observe(app, { childList: true });
  modal.querySelector("[data-modal-close]")?.addEventListener("click", cleanup, {
    once: true,
  });
  modal.addEventListener(
    "pointerdown",
    (event) => {
      if (event.target === modal) cleanup();
    },
  );
}

function cosmeticEntitled(
  item: NonNullable<ReturnType<typeof cosmeticById>>,
  currentAccount: AccountProfile,
): boolean {
  return cosmeticAvailable(
    item,
    currentAccount.displayRank,
    currentAccount.ownedCosmetics,
  );
}

function customizationScreen(activeSlot: CosmeticSlot = "character"): void {
  cosmeticCollectionScreen("customize", activeSlot);
}

function shopScreen(
  activeSlot: CosmeticSlot = "character",
  previewItemId?: string,
): void {
  cosmeticCollectionScreen("shop", activeSlot, previewItemId);
}

function supplyShopScreen(): void {
  if (!account) {
    authScreen();
    return;
  }
  const currentAccount = account;
  const cards = SHOP_CONSUMABLES.map((item) => {
    const quantity =
      currentAccount.consumables.find((owned) => owned.itemId === item.id)
        ?.quantity ?? 0;
    const categoryLabel =
      item.category === "assault"
        ? "공격"
        : item.category === "defense"
          ? "문 방어"
          : "포탑 강화";
    return `<article class="supply-card catalog-card supply-${item.category}"><div class="catalog-art supply-art"><img data-supply-art="${item.id}" alt="${escapeHtml(item.label)} 3D 상품 이미지" /></div><div class="supply-copy"><span>${categoryLabel}</span><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.description)}</p></div><div class="supply-actions"><small>보유 ${quantity}개</small><div><button data-supply-buy="${item.id}" data-supply-quantity="1">${item.price.toLocaleString()} P</button><button data-supply-buy="${item.id}" data-supply-quantity="5">5개</button></div></div></article>`;
  }).join("");
  setContent(
    "shop",
    `<main class="custom-screen shop-screen supply-shop-screen"><div class="custom-backdrop"></div><header class="custom-header"><button class="custom-back" data-supply-back aria-label="스토어로 돌아가기">‹</button><div><span>TACTICAL SUPPLY</span><h2>전술 보급</h2></div><div class="custom-wallet"><small>보유 포인트</small><strong>✦ ${currentAccount.customPoints.toLocaleString()} P</strong></div></header><section class="supply-brief"><div><span class="eyebrow">MATCH CONSUMABLES</span><h3>구매한 수량만큼, 실제 사용 때만 차감됩니다.</h3><p>각 보급품은 한 판에 한 번만 장착·사용할 수 있으며 랜덤 뽑기 보상과 중복되지 않습니다.</p></div><button class="btn ghost" data-cosmetic-store>외형 상점</button></section><section class="supply-grid">${cards}</section></main>`,
  );
  hydrateCatalogArt(app, {
    appearance: currentAccount.appearance,
    turretSkins: currentAccount.turretSkins,
  });
  app
    .querySelector("[data-supply-back]")
    ?.addEventListener("click", () => shopScreen());
  app
    .querySelector("[data-cosmetic-store]")
    ?.addEventListener("click", () => shopScreen());
  app
    .querySelectorAll<HTMLButtonElement>("[data-supply-buy]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const itemId = button.dataset.supplyBuy ?? "";
        const quantity = Number(button.dataset.supplyQuantity) as 1 | 5;
        const item = shopConsumableById(itemId);
        if (!item) return;
        confirmPointPurchase({
          label: item.label,
          quantity,
          pointCost: item.price * quantity,
          onConfirm: () => {
            void (async () => {
              try {
                account = await withGlobalActionLoading(
                  `${item.label} 구매 중`,
                  () => purchaseConsumable(itemId, quantity),
                );
                supplyShopScreen();
                toast(`${quantity}개를 보급함에 넣었습니다.`);
              } catch (error) {
                toast(
                  error instanceof Error
                    ? error.message
                    : "보급품을 구매하지 못했습니다.",
                );
              }
            })();
          },
        });
      }),
    );
}

function cosmeticCollectionScreen(
  screen: "customize" | "shop",
  activeSlot: CosmeticSlot,
  previewItemId?: string,
): void {
  if (!account) {
    authScreen();
    return;
  }
  const selectedSlot: CosmeticSlot =
    activeSlot === "skin" || activeSlot === "tile" || activeSlot === "turret"
      ? activeSlot
      : "character";
  const currentAccount = account;
  const appearance = currentAccount.appearance;
  const shopping = screen === "shop";
  const visibleSlots = Object.keys(CUSTOM_SLOT_LABELS) as CosmeticSlot[];
  const tabs = visibleSlots
    .map(
      (slot) =>
        `<button class="custom-tab ${slot === selectedSlot ? "active" : ""}" data-custom-slot="${slot}">${CUSTOM_SLOT_LABELS[slot]}</button>`,
    )
    .join("");
  const catalog = cosmeticsForSlot(selectedSlot).filter(
    (item) =>
      (shopping || cosmeticEntitled(item, currentAccount)) &&
      (selectedSlot !== "tile" || item.id !== DEFAULT_TILE_SKIN_ID) &&
      (selectedSlot !== "turret" ||
        item.id === CYBERPUNK_LASER_TURRET_SKIN_ID ||
        item.id === SURFER_WATER_TURRET_SKIN_ID ||
        item.id === LIFEGUARD_PARASOL_TURRET_SKIN_ID),
  );
  const displayCatalog =
    selectedSlot === "turret"
      ? [...catalog].sort((left, right) => {
          if (left.id === CYBERPUNK_LASER_TURRET_SKIN_ID) return -1;
          if (right.id === CYBERPUNK_LASER_TURRET_SKIN_ID) return 1;
          if (left.id === SURFER_WATER_TURRET_SKIN_ID) return -1;
          if (right.id === SURFER_WATER_TURRET_SKIN_ID) return 1;
          if (left.id === LIFEGUARD_PARASOL_TURRET_SKIN_ID) return -1;
          if (right.id === LIFEGUARD_PARASOL_TURRET_SKIN_ID) return 1;
          return 0;
        })
      : shopping && selectedSlot === "skin"
        ? [...catalog].sort((left, right) => {
            const premiumOrder = [
              NEON_RIDER_LULU_SKIN_ID,
              CYBER_DRIVER_KONG_SKIN_ID,
              SURFER_MONG_SKIN_ID,
              LIFEGUARD_RAON_SKIN_ID,
            ];
            const leftOrder = premiumOrder.indexOf(left.id);
            const rightOrder = premiumOrder.indexOf(right.id);
            if (leftOrder < 0 && rightOrder < 0) return 0;
            if (leftOrder < 0) return 1;
            if (rightOrder < 0) return -1;
            return leftOrder - rightOrder;
          })
        : catalog;
  const cards = displayCatalog
    .map((item) => {
      const selected =
        selectedSlot === "tile"
          ? (appearance.tileSkin ?? DEFAULT_TILE_SKIN_ID) === item.id
          : selectedSlot === "turret" && item.turretKind
            ? currentAccount.turretSkins[item.turretKind] === item.id
            : selectedSlot === "character" || selectedSlot === "skin"
              ? appearance[selectedSlot] === item.id
              : false;
      const premiumSurfer = item.id === SURFER_MONG_SKIN_ID;
      const premiumLifeguard = item.id === LIFEGUARD_RAON_SKIN_ID;
      const premiumNeonLulu = item.id === NEON_RIDER_LULU_SKIN_ID;
      const premiumCyberKong = item.id === CYBER_DRIVER_KONG_SKIN_ID;
      const premiumSkin =
        premiumSurfer
        || premiumLifeguard
        || premiumNeonLulu
        || premiumCyberKong;
      const initialCatalogPreviewId =
        selectedSlot === "skin"
          ? (previewItemId ?? NEON_RIDER_LULU_SKIN_ID)
          : selectedSlot === "tile"
            ? (previewItemId ?? CYBERPUNK_NEON_TILE_SKIN_ID)
            : selectedSlot === "turret"
              ? (previewItemId ?? CYBERPUNK_LASER_TURRET_SKIN_ID)
              : previewItemId;
      const initiallyPreviewed =
        shopping && item.id === initialCatalogPreviewId;
      const owned = currentAccount.ownedCosmetics.includes(item.id);
      const entitled = cosmeticEntitled(item, currentAccount);
      const requiresCharacter =
        item.slot === "skin" &&
        Boolean(item.characterId) &&
        !characterAvailable(
          item.characterId ?? "",
          currentAccount.displayRank,
          currentAccount.ownedCosmetics,
        );
      let action: "purchase" | "equip" | "unequip" | null = shopping
        ? null
        : "equip";
      let status = shopping ? "보유 중" : "착용";
      let locked = false;
      if (shopping && requiresCharacter) {
        action = null;
        status = "캐릭터 구매 필요";
        locked = true;
      } else if (shopping && item.unlock.kind === "points" && !owned) {
        action = "purchase";
        status = `${item.unlock.price.toLocaleString()} P`;
      } else if (shopping && item.unlock.kind === "rank" && !entitled) {
        status = `${rankLabel(item.unlock.rank)} 해금`;
        locked = true;
      } else if (shopping && item.unlock.kind === "rank") {
        status = "등급 보상";
      } else if (shopping && item.unlock.kind === "starter") {
        status = "기본 지급";
      } else if (!shopping && selected) {
        if (
          item.slot === "skin" ||
          (item.slot === "tile" && item.id !== DEFAULT_TILE_SKIN_ID)
        ) {
          action = "unequip";
          status = "착용 해제";
        } else {
          action = null;
          status = "착용 중";
        }
      }
      const actionButton = action
        ? `<button data-cosmetic-action="${action}" data-cosmetic-id="${item.id}">${status}</button>`
        : `<button disabled>${status}</button>`;
      const characterTraitInfo =
        item.slot === "character" ? characterTrait(item.id) : null;
      const skinTraitInfo =
        item.slot === "skin" && item.characterId
          ? characterTraitForAppearance({
              character: item.characterId,
              skin: item.id,
            })
          : null;
      const turretTraitInfo =
        item.slot === "turret"
          ? turretSkinTrait(item.id, item.turretKind)
          : null;
      const traitLabel =
        characterTraitInfo && characterTraitInfo.id !== "none"
          ? characterTraitInfo.label
          : skinTraitInfo && skinTraitInfo.id !== "none"
            ? skinTraitInfo.label
            : turretTraitInfo && item.unlock.kind !== "starter"
              ? turretTraitInfo.label
              : "";
      const traitDescription =
        characterTraitInfo?.description ??
        skinTraitInfo?.description ??
        turretTraitInfo?.description ??
        item.description;
      const authoredTurretArt =
        item.slot === "turret" ? turretSkinAssetUrl(item.id, 1) : undefined;
      const art =
        item.slot === "tile"
          ? `<div class="catalog-art cosmetic-art tile-skin-card-art" style="--swatch:${item.swatch}"><img class="ready" src="${tilePreviewUrl(item.id)}?v=${APP_RELEASE_VERSION}" alt="${escapeHtml(item.label)} 타일 미리보기" /></div>`
          : authoredTurretArt
            ? `<div class="catalog-art cosmetic-art turret-skin-card-art" style="--swatch:${item.swatch}"><img class="ready" src="${authoredTurretArt}?v=${APP_RELEASE_VERSION}" alt="${escapeHtml(item.label)} Lv.1 미리보기" />${traitLabel ? `<span class="trait-ribbon">${escapeHtml(traitLabel)}</span>` : ""}</div>`
            : premiumSurfer
              ? `<div class="catalog-art cosmetic-art surfer-mong-card-art" style="--swatch:${item.swatch}"><span class="surfer-mong-card-sprite" role="img" aria-label="${escapeHtml(item.label)} 파도타기 미리보기"></span>${traitLabel ? `<span class="trait-ribbon">${escapeHtml(traitLabel)}</span>` : ""}</div>`
              : premiumLifeguard
                ? `<div class="catalog-art cosmetic-art lifeguard-raon-card-art" style="--swatch:${item.swatch}"><span class="lifeguard-raon-card-sprite" role="img" aria-label="${escapeHtml(item.label)} 달리기 미리보기"></span>${traitLabel ? `<span class="trait-ribbon">${escapeHtml(traitLabel)}</span>` : ""}</div>`
                : premiumNeonLulu
                  ? `<div class="catalog-art cosmetic-art neon-rider-lulu-card-art" style="--swatch:${item.swatch}"><span class="neon-rider-lulu-card-sprite" role="img" aria-label="${escapeHtml(item.label)} 네온 스케이팅 미리보기"></span>${traitLabel ? `<span class="trait-ribbon">${escapeHtml(traitLabel)}</span>` : ""}</div>`
                  : premiumCyberKong
                    ? `<div class="catalog-art cosmetic-art cyber-driver-kong-card-art" style="--swatch:${item.swatch}"><span class="cyber-driver-kong-card-sprite" role="img" aria-label="${escapeHtml(item.label)} 사이버 드라이빙 미리보기"></span>${traitLabel ? `<span class="trait-ribbon">${escapeHtml(traitLabel)}</span>` : ""}</div>`
                : `<div class="catalog-art cosmetic-art" style="--swatch:${item.swatch}"><img data-cosmetic-art="${item.id}" alt="${escapeHtml(item.label)} 인게임 미리보기" />${traitLabel ? `<span class="trait-ribbon">${escapeHtml(traitLabel)}</span>` : ""}</div>`;
      return `<article class="cosmetic-card catalog-card ${selected ? "selected" : ""} ${locked ? "locked" : ""} ${initiallyPreviewed ? "previewing" : ""} ${premiumSkin ? "premium-skin-card" : ""} ${premiumSurfer ? "surfer-mong-card" : ""} ${premiumLifeguard ? "lifeguard-raon-card" : ""} ${premiumNeonLulu ? "neon-rider-lulu-card" : ""} ${premiumCyberKong ? "cyber-driver-kong-card" : ""}" data-cosmetic-preview="${item.id}" tabindex="0">${premiumSkin ? '<span class="cosmetic-new-badge" aria-label="신규 프리미엄 스킨">NEW</span>' : ""}${art}<div class="cosmetic-copy"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(traitDescription)}</small></div><div class="cosmetic-card-action">${actionButton}</div></article>`;
    })
    .join("");
  const character = cosmeticById(appearance.character);
  const activeSkin = cosmeticById(appearance.skin);
  const initialTilePreviewId = shopping
    ? (previewItemId ?? CYBERPUNK_NEON_TILE_SKIN_ID)
    : (previewItemId ??
      displayCatalog.find((item) => item.id === appearance.tileSkin)?.id ??
      displayCatalog[0]?.id);
  const initialTurretPreviewId = shopping
    ? (previewItemId ?? CYBERPUNK_LASER_TURRET_SKIN_ID)
    : (displayCatalog.find((item) => item.id === previewItemId)?.id ??
      displayCatalog.find(
        (item) =>
          item.turretKind &&
          currentAccount.turretSkins[item.turretKind] === item.id,
      )?.id ??
      displayCatalog[0]?.id);
  const initialPreviewItem =
    selectedSlot === "skin"
      ? shopping
        ? cosmeticById(previewItemId ?? NEON_RIDER_LULU_SKIN_ID)
        : undefined
      : selectedSlot === "tile"
        ? initialTilePreviewId
          ? cosmeticById(initialTilePreviewId)
          : undefined
        : selectedSlot === "turret"
          ? initialTurretPreviewId
            ? cosmeticById(initialTurretPreviewId)
            : undefined
          : undefined;
  const initialPreviewAppearance: AvatarAppearance =
    initialPreviewItem?.slot === "skin"
      ? {
          character: initialPreviewItem.characterId ?? appearance.character,
          skin: initialPreviewItem.id,
          tileSkin: appearance.tileSkin,
        }
      : appearance;
  const turretMode = selectedSlot === "turret";
  const tileMode = selectedSlot === "tile";
  const initialTurret = turretMode ? initialPreviewItem : undefined;
  const initialTrait = characterTraitForAppearance(initialPreviewAppearance);
  const initialTurretTrait = initialTurret?.turretKind
    ? turretSkinTrait(initialTurret.id, initialTurret.turretKind)
    : null;
  let livePreviewItemId =
    initialPreviewItem?.id ??
    (selectedSlot === "skin" ? activeSkin?.id : character?.id) ??
    appearance.character;
  setContent(
    screen,
    `<main class="custom-screen ${shopping ? "shop-screen" : "owned-custom-screen"}"><div class="custom-backdrop"></div><header class="custom-header"><button class="custom-back" data-custom-back aria-label="이전 화면">‹</button><div><span>${shopping ? "SHOP" : "MY LOCKER"}</span><h2>${shopping ? "외형 상점" : "내 보관함"}</h2></div>${shopping ? '<button class="custom-shop-switch" data-open-supplies>전술 보급</button>' : ""}<div class="custom-wallet"><small>보유 포인트</small><strong>✦ ${currentAccount.customPoints.toLocaleString()} P</strong></div></header><section class="custom-layout"><aside class="custom-preview">${modelPreviewHtml(turretMode, tileMode ? initialPreviewItem?.id : undefined, turretMode ? initialTurret?.id : undefined, tileMode)}<div><strong data-custom-preview-title>${tileMode && !initialPreviewItem ? "기본 타일 사용 중" : turretMode ? escapeHtml(initialTurret?.label ?? "수호포 · 병동형") : escapeHtml(initialPreviewItem?.label ?? activeSkin?.label ?? character?.label ?? currentAccount.nickname)}</strong><small data-custom-preview-copy>${tileMode && !initialPreviewItem ? "타일 스킨을 보유하면 이곳에서 장착할 수 있습니다." : turretMode ? escapeHtml(initialTurretTrait?.description ?? "기본 수호 포탑 Lv.1 외형입니다.") : escapeHtml(initialPreviewItem?.description ?? activeSkin?.description ?? initialTrait.description)}</small></div></aside><section class="custom-catalog"><nav>${tabs}</nav><div class="cosmetic-grid ${cards ? "" : "is-empty"}">${cards || `<p class="empty-collection">${selectedSlot === "turret" ? "보유한 포탑 스킨이 없습니다." : selectedSlot === "tile" ? "보유한 타일 스킨이 없습니다." : "보유한 캐릭터의<br/>완성형 스킨은 여기에 표시됩니다."}</p>`}</div></section></section></main>`,
  );
  const livePreviewButton = document.createElement("button");
  livePreviewButton.className = "custom-live-preview";
  livePreviewButton.type = "button";
  livePreviewButton.dataset.liveCosmeticPreview = "";
  livePreviewButton.setAttribute("aria-label", "인게임 연출 미리보기");
  livePreviewButton.innerHTML =
    '<span aria-hidden="true">▶</span><small>인게임</small>';
  const customPreview = app.querySelector(".custom-preview");
  customPreview?.insertBefore(livePreviewButton, customPreview.firstChild);
  livePreviewButton.addEventListener("click", () =>
    showLiveCosmeticPreview(
      livePreviewItemId,
      appearance,
      currentAccount.displayRank,
    ),
  );
  hydrateCatalogArt(app, {
    appearance,
    turretSkins: currentAccount.turretSkins,
  });
  app
    .querySelector("[data-open-supplies]")
    ?.addEventListener("click", supplyShopScreen);
  const previewHost = app.querySelector<HTMLElement>("[data-avatar-preview]");
  if (previewHost && !tileMode && !turretMode) {
    customAvatarPreview = new AvatarPreview2D(
      previewHost,
      initialPreviewAppearance,
      currentAccount.displayRank,
    );
  }
  app
    .querySelectorAll<HTMLButtonElement>("[data-avatar-view]")
    .forEach((button) =>
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        customAvatarPreview?.setView(button.dataset.avatarView as AvatarView);
        app
          .querySelectorAll("[data-avatar-view]")
          .forEach((candidate) =>
            candidate.classList.toggle("active", candidate === button),
          );
      }),
    );
  const showPreview = (itemId: string): void => {
    const item = cosmeticById(itemId);
    if (!item) return;
    livePreviewItemId = item.id;
    if (item.slot === "tile") {
      const tilePreview = app.querySelector<HTMLImageElement>(
        "[data-tile-preview]",
      );
      if (tilePreview) {
        tilePreview.src = `${tilePreviewUrl(item.id)}?v=${APP_RELEASE_VERSION}`;
        tilePreview.alt = `${item.label} 타일 미리보기`;
      }
    } else if (item.slot === "turret") {
      if (!item.turretKind) return;
      const turretPreview = app.querySelector<HTMLImageElement>(
        "[data-turret-preview]",
      );
      if (turretPreview) {
        turretPreview.src = `${
          turretSkinAssetUrl(item.id, 1) ??
          "/assets/buildings/cute-basic-turret-1.png"
        }?v=${APP_RELEASE_VERSION}`;
        turretPreview.alt = `${item.label} Lv.1 미리보기`;
      }
    } else {
      const previewAppearance: AvatarAppearance =
        item.slot === "character"
          ? {
              character: item.id,
              skin: defaultSkinForCharacter(item.id),
              tileSkin: appearance.tileSkin,
            }
          : item.slot === "skin"
            ? {
                character: item.characterId ?? appearance.character,
                skin: item.id,
                tileSkin: appearance.tileSkin,
              }
            : appearance;
      customAvatarPreview?.updateAppearance(
        previewAppearance,
        currentAccount.displayRank,
      );
    }
    app
      .querySelectorAll("[data-cosmetic-preview]")
      .forEach((candidate) =>
        candidate.classList.toggle(
          "previewing",
          (candidate as HTMLElement).dataset.cosmeticPreview === item.id,
        ),
      );
    setText("[data-custom-preview-title]", item.label);
    setText(
      "[data-custom-preview-copy]",
      item.slot === "character"
        ? characterTrait(item.id).description
        : item.slot === "turret"
          ? turretSkinTrait(item.id, item.turretKind).description
          : item.slot === "skin" &&
              item.characterId &&
              !characterAvailable(
                item.characterId,
                currentAccount.displayRank,
                currentAccount.ownedCosmetics,
              )
            ? `${cosmeticById(item.characterId)?.label ?? "해당 캐릭터"}를 먼저 보유해야 구매할 수 있습니다.`
            : shopping && !cosmeticEntitled(item, currentAccount)
              ? "미보유 아이템 미리보기 · 포인트는 차감되지 않습니다."
              : item.description,
    );
  };
  app
    .querySelectorAll<HTMLElement>("[data-cosmetic-preview]")
    .forEach((card) => {
      card.addEventListener("click", () =>
        showPreview(card.dataset.cosmeticPreview ?? ""),
      );
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          showPreview(card.dataset.cosmeticPreview ?? "");
        }
      });
    });
  app.querySelector("[data-custom-back]")?.addEventListener("click", () => {
    if (!shopping && customizeReturnView === "room-menu") roomMenu();
    else homeScreen();
  });
  app
    .querySelectorAll<HTMLElement>("[data-custom-slot]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        cosmeticCollectionScreen(
          screen,
          button.dataset.customSlot as CosmeticSlot,
        ),
      ),
    );
  app
    .querySelectorAll<HTMLButtonElement>("[data-cosmetic-action]")
    .forEach((button) =>
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const itemId = button.dataset.cosmeticId ?? "";
        const action = button.dataset.cosmeticAction;
        const item = cosmeticById(itemId);
        if (!item) return;
        if (action === "purchase" && item.unlock.kind === "points") {
          confirmPointPurchase({
            label: item.label,
            pointCost: item.unlock.price,
            onConfirm: () => {
              void (async () => {
                try {
                  account = await withGlobalActionLoading(
                    `${item.label} 구매 중`,
                    () => purchaseCosmetic(itemId),
                  );
                  shopScreen(selectedSlot, itemId);
                  toast("구매했습니다. 내 보관함에서 착용할 수 있습니다.");
                } catch (error) {
                  toast(
                    error instanceof Error
                      ? error.message
                      : "외형을 구매하지 못했습니다.",
                  );
                }
              })();
            },
          });
          return;
        }
        const originalLabel = button.textContent ?? "";
        button.disabled = true;
        button.textContent = "처리 중";
        void (async () => {
          try {
            account = await withGlobalActionLoading(
              action === "unequip"
                ? `${item.label} 착용 해제 중`
                : `${item.label} 착용 중`,
              () =>
                equipCosmetic(
                  action === "unequip"
                    ? item.slot === "tile"
                      ? DEFAULT_TILE_SKIN_ID
                      : currentAccount.appearance.character
                    : itemId,
                ),
            );
            customizationScreen(selectedSlot);
            toast(
              action === "unequip"
                ? item.slot === "tile"
                  ? "타일 스킨을 기본 타일로 변경했습니다."
                  : "스킨 착용을 해제했습니다."
                : "착용 상태를 저장했습니다.",
            );
          } catch (error) {
            button.disabled = false;
            button.textContent = originalLabel;
            toast(
              error instanceof Error
                ? error.message
                : "커스텀 상태를 저장하지 못했습니다.",
            );
          }
        })();
      }),
    );
}

function authScreen(mode: "login" | "register" = "login"): void {
  const registering = mode === "register";
  setContent(
    "auth",
    `<main class="auth-screen"><div class="auth-backdrop" aria-hidden="true"></div><header class="auth-logo"><span>HORROR CO-OP DEFENSE</span><h1>심야 병동</h1><p>문이 닫히기 전에 방을 찾고,<br>새벽이 올 때까지 살아남으세요.</p></header><section class="auth-sheet"><div class="auth-heading"><small>${registering ? "NEW SURVIVOR" : ""}</small><h2>${registering ? "계정생성" : ""}</h2></div><form id="auth-form" class="auth-form"><div class="auth-control"><label for="username">아이디</label><div><input id="username" type="text" minlength="4" maxlength="20" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="email" placeholder="영문 소문자·숫자 4~20자" /></div></div>${registering ? '<div class="auth-control"><label for="nickname">게임 닉네임</label><div><input id="nickname" type="text" minlength="2" maxlength="12" autocomplete="nickname" placeholder="게임에서 표시할 이름" /></div></div>' : ""}<div class="auth-control"><label for="password">비밀번호</label><div><input id="password" type="password" minlength="8" maxlength="72" autocomplete="${registering ? "new-password" : "current-password"}" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="email" placeholder="8자 이상" /><button type="button" class="auth-reveal" data-password-reveal aria-label="비밀번호 표시">보기</button></div></div><button class="auth-submit" type="submit">${registering ? "계정 만들고 시작" : "로그인하고 시작"}</button></form><button class="auth-switch" type="button" data-auth-tab="${registering ? "login" : "register"}" aria-label="${registering ? "로그인" : "새 계정"}"><span>${registering ? "이미 계정이 있나요?" : "처음 오셨나요?"}</span><strong>${registering ? "로그인" : "새 계정"}</strong></button></section><footer class="auth-footnote">계정에는 게임 진행도와 등급만 저장됩니다.</footer></main>`,
  );
  app
    .querySelector("[data-password-reveal]")
    ?.addEventListener("click", (event) => {
      const input = app.querySelector<HTMLInputElement>("#password");
      const button = event.currentTarget as HTMLButtonElement;
      if (!input) return;
      const revealing = input.type === "password";
      input.type = revealing ? "text" : "password";
      button.textContent = revealing ? "숨김" : "보기";
      button.setAttribute(
        "aria-label",
        revealing ? "비밀번호 숨기기" : "비밀번호 표시",
      );
    });
  app
    .querySelectorAll<HTMLElement>("[data-auth-tab]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        authScreen(
          button.dataset.authTab === "register" ? "register" : "login",
        ),
      ),
    );
  app
    .querySelector<HTMLFormElement>("#auth-form")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      audio.play("button");
      const username =
        app.querySelector<HTMLInputElement>("#username")?.value.trim() ?? "";
      const password =
        app.querySelector<HTMLInputElement>("#password")?.value ?? "";
      const nickname =
        app.querySelector<HTMLInputElement>("#nickname")?.value.trim() ?? "";
      connectionOverlay(
        registering ? "계정을 만드는 중…" : "계정에 로그인하는 중…",
      );
      void (
        registering
          ? registerAccount(username, nickname, password)
          : loginAccount(username, password)
      )
        .then((next) => {
          account = next;
          homePlayMode = next.selectedPlayMode;
          profile.nickname = next.nickname;
          profile.mustReauthenticate = false;
          saveProfile(profile);
          homeScreen();
        })
        .catch((error) => {
          authScreen(mode);
          toast(
            error instanceof Error ? error.message : "로그인할 수 없습니다.",
          );
        });
    });
}

function roomMenu(): void {
  if (!account) {
    authScreen();
    return;
  }
  const currentAccount = account;
  const benefits = rankBenefits(currentAccount.soloRank);
  const soloOptions = stagesThrough(currentAccount.soloStageIndex)
    .map(
      (stage) =>
        `<option value="${stage.id}" ${stage.index === currentAccount.soloStageIndex ? "selected" : ""}>${stage.label} · ${stageThemeFor(stage.id).label}</option>`,
    )
    .join("");
  const multiOptions = stagesThrough(currentAccount.multiplayerStageIndex)
    .map(
      (stage) =>
        `<option value="${stage.id}" ${stage.index === currentAccount.multiplayerStageIndex ? "selected" : ""}>${stage.label} · ${stageThemeFor(stage.id).label}</option>`,
    )
    .join("");
  const perk = `${benefits.speedMultiplier > 1 ? `이동속도 +${Math.round((benefits.speedMultiplier - 1) * 100)}%` : "기본 이동속도"} · 문 최대 Lv.15 · 포탑 최대 Lv.15`;
  setContent(
    "room-menu",
    `<main class="mode-select-screen"><div class="mode-backdrop"></div><header class="mode-header"><button class="mode-back" data-mode-back aria-label="게임 홈">‹</button><div><span class="eyebrow">PLAY</span><h2>플레이 방식 선택</h2></div><nav class="mode-tools"><button class="mode-custom" data-customize><span>✦ ${currentAccount.customPoints.toLocaleString()} P</span><strong>커스텀</strong></button><div class="mode-rank">${rankIdentityHtml(currentAccount.displayRank, "rank-badge-sm")}<span>${escapeHtml(currentAccount.nickname)}</span></div></nav></header><section class="mode-stage"><article class="mode-poster solo-poster"><div class="mode-icon">☾</div><div class="mode-copy"><h3>혼자하기</h3><p>세 명의 귀여운 생존 봇과 함께 방어합니다.</p></div><label>스테이지<select data-solo-stage>${soloOptions}</select></label><button class="mode-play" data-solo aria-label="봇과 혼자 시작">혼자 시작</button></article><article class="mode-poster multi-poster"><div class="mode-icon">◎</div><div class="mode-copy"><h3>친구랑하기</h3><p>친구와 각자의 방을 지키며 협동합니다.</p></div><label>스테이지<select data-multi-stage>${multiOptions}</select></label><button class="mode-play" data-create data-testid="create-room">새 방 만들기</button></article><aside class="invite-terminal"><div class="invite-copy"><span>FRIEND ROOM</span><strong>초대 코드로 참가</strong></div><div><input class="code-input" id="invite-code" type="text" maxlength="8" inputmode="text" aria-label="초대 코드로 참가" value="${escapeHtml(profile.recentRoomCode)}" placeholder="8자리 코드" /><button class="invite-join" data-join data-testid="join-room">참가</button></div><small>${perk}</small></aside></section></main>`,
  );
  app
    .querySelector(".mode-rank")
    ?.insertAdjacentHTML(
      "beforeend",
      '<button class="mode-logout" data-logout>로그아웃</button>',
    );
  app
    .querySelector("[data-create]")
    ?.addEventListener("click", () => void createRoom(false));
  app
    .querySelector("[data-solo]")
    ?.addEventListener("click", () => void createRoom(true));
  app
    .querySelector("[data-join]")
    ?.addEventListener("click", () => void joinRoom());
  app
    .querySelector("[data-mode-back]")
    ?.addEventListener("click", () => homeScreen());
  app.querySelector("[data-customize]")?.addEventListener("click", () => {
    customizeReturnView = "room-menu";
    customizationScreen();
  });
  app.querySelector("[data-logout]")?.addEventListener(
    "click",
    () =>
      void logoutAccount().then(() => {
        profile.mustReauthenticate = true;
        saveProfile(profile);
        stopSocialRealtime();
        account = null;
        network?.close();
        network = null;
        authScreen();
      }),
  );
  app
    .querySelector<HTMLInputElement>("#invite-code")
    ?.addEventListener("input", (event) => {
      const input = event.currentTarget as HTMLInputElement;
      input.value = input.value.toUpperCase().replace(/[^A-Z2-9]/g, "");
    });
}

async function createRoom(
  solo: boolean,
  requestedStageId?: StageId,
  ranked = false,
): Promise<void> {
  const returnView = currentView === "home" ? "home" : "room-menu";
  const selector = app.querySelector(
    solo ? "[data-solo-stage]" : "[data-multi-stage]",
  ) as HTMLSelectElement | null;
  const stageId =
    requestedStageId ?? ((selector?.value ?? "easy-1") as StageId);
  audio.play("button");
  connectionOverlay("방을 만드는 중…");
  try {
    const response = await fetch("/api/rooms/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        testMode: e2eMode,
        stageId,
        playMode: solo ? "solo" : "multiplayer",
        ranked,
      }),
    });
    const data = (await response.json()) as { code?: string; error?: string };
    if (!response.ok || !data.code)
      throw new Error(data.error ?? "방을 만들지 못했습니다.");
    profile.recentRoomCode = data.code;
    saveProfile(profile);
    connectToRoom(data.code, solo);
  } catch (error) {
    if (returnView === "home") homeScreen();
    else roomMenu();
    toast(
      error instanceof Error ? error.message : "서버에 연결할 수 없습니다.",
    );
  }
}

function stopRankedQueuePolling(): void {
  if (!rankedQueuePollTimer) return;
  window.clearTimeout(rankedQueuePollTimer);
  rankedQueuePollTimer = 0;
}

async function rankedQueueRequest(
  action: "join" | "status" | "leave",
): Promise<RankedQueueResponse | { left: boolean }> {
  const response = await fetch(`/api/ranked/queue/${action}`, {
    method: action === "status" ? "GET" : "POST",
    headers:
      action === "status" ? undefined : { "content-type": "application/json" },
    body: action === "join" ? JSON.stringify({ testMode: e2eMode }) : undefined,
  });
  const data = (await response.json().catch(() => null)) as
    | (RankedQueueResponse & { error?: string })
    | { left: boolean; error?: string }
    | null;
  const errorMessage = data && "error" in data ? data.error : undefined;
  if (!response.ok || !data)
    throw new Error(errorMessage || "랭크 대기열에 연결하지 못했습니다.");
  return data;
}

async function joinRankedQueue(): Promise<void> {
  try {
    const queue = (await rankedQueueRequest("join")) as RankedQueueResponse;
    renderRankedQueue(queue);
  } catch (error) {
    homeScreen();
    toast(
      error instanceof Error
        ? error.message
        : "랭크 대기열에 연결하지 못했습니다.",
    );
  }
}

async function refreshRankedQueue(): Promise<void> {
  try {
    const queue = (await rankedQueueRequest("status")) as RankedQueueResponse;
    if (currentView !== "ranked-queue") return;
    renderRankedQueue(queue);
  } catch (error) {
    if (currentView !== "ranked-queue") return;
    homeScreen();
    toast(
      error instanceof Error
        ? error.message
        : "랭크 대기열 연결이 끊어졌습니다.",
    );
  }
}

function renderRankedQueue(queue: RankedQueueResponse): void {
  stopRankedQueuePolling();
  if (queue.status === "matched" && queue.roomCode) {
    profile.recentRoomCode = queue.roomCode;
    saveProfile(profile);
    toast(
      queue.botCount
        ? `40초 대기 후 봇 ${queue.botCount}명이 보충되었습니다.`
        : "동일 등급대 생존자 4명이 매칭되었습니다.",
    );
    connectToRoom(queue.roomCode, false);
    return;
  }
  if (queue.status !== "waiting") {
    homeScreen();
    toast("랭크 대기열이 만료되었습니다. 다시 참여해주세요.");
    return;
  }
  const elapsed = formatTime(queue.elapsedSeconds);
  const slots = Array.from({ length: queue.requiredPlayers }, (_, index) => {
    const player = queue.players[index];
    if (player) {
      const isUnranked = player.placementCompleted < 1;
      const tierLabel = isUnranked
        ? "Unranked"
        : RANKED_TIER_LABEL[player.tier];
      const tierBadge = isUnranked
        ? rankBadgeImage("beginner")
        : rankedBadgeImage(player.tier);
      const queueMeta = isUnranked
        ? "첫 랭크전 배치 중"
        : `${player.rating} RP`;
      return `<li class="ranked-queue-player"><span class="queue-avatar">${profileAvatarHtml(player.avatarUrl, "queue-avatar profile-avatar")}</span><div><strong>${escapeHtml(player.nickname)}</strong><small>${queueMeta}</small></div><span class="queue-tier"><img src="${tierBadge}" alt="${escapeHtml(tierLabel)}"/><small>${tierLabel}</small></span></li>`;
    }
    return `<li class="ranked-queue-player vacant"><span class="queue-avatar">＋</span><div><strong>동일 등급 생존자 탐색 중</strong><small>현재 범위 ±${queue.ratingWindow} RP</small></div><b>SEARCH</b></li>`;
  }).join("");
  setContent(
    "ranked-queue",
    `<main class="ranked-queue-screen"><div class="ranked-queue-backdrop"></div><section class="ranked-queue-shell"><header><span class="eyebrow">RANKED MATCHMAKING</span><h1>${account?.ranked.seasonId ?? "S1"} 랭크전</h1><p>비슷한 랭크의 생존자 4명을 찾고 있습니다.</p></header><section class="ranked-queue-clock"><span>QUEUE TIME</span><strong>${elapsed}</strong><small>${queue.playerCount}/${queue.requiredPlayers} 명 참가</small></section><ol class="ranked-queue-players">${slots}</ol><footer><button class="btn danger" data-ranked-queue-cancel>대기열 취소</button><small>매칭이 완료되면 별도 준비 없이 자동으로 시작됩니다.</small></footer></section></main>`,
  );
  app
    .querySelector<HTMLButtonElement>("[data-ranked-queue-cancel]")
    ?.addEventListener("click", () => {
      stopRankedQueuePolling();
      void rankedQueueRequest("leave")
        .catch(() => undefined)
        .finally(() => homeScreen());
    });
  rankedQueuePollTimer = window.setTimeout(
    () => void refreshRankedQueue(),
    1_000,
  );
}

async function joinRoom(): Promise<void> {
  const returnView = currentView === "home" ? "home" : "room-menu";
  const code =
    app
      .querySelector<HTMLInputElement>("#invite-code")
      ?.value.trim()
      .toUpperCase() ?? "";
  if (!/^[A-Z2-9]{8}$/.test(code)) {
    toast("초대 코드 8자리를 확인해주세요.");
    return;
  }
  audio.play("button");
  connectionOverlay("초대 코드를 확인하는 중…");
  try {
    const room = await getRoomStatus(code);
    if (!isJoinableRoom(room.status)) {
      throw new Error(
        room.status === "PLAYING"
          ? "이미 시작된 게임입니다."
          : "이미 종료된 게임입니다. 새 방을 만들어주세요.",
      );
    }
    profile.recentRoomCode = code;
    saveProfile(profile);
    connectToRoom(code, false);
  } catch (error) {
    if (returnView === "home") homeScreen();
    else roomMenu();
    toast(error instanceof Error ? error.message : "방에 참가할 수 없습니다.");
  }
}

function connectToRoom(code: string, addSoloBots: boolean): void {
  network?.close();
  resultRecorded = false;
  const roomNetwork = new GameNetwork(
    code,
    profile.nickname,
    profile.deviceId,
    profile.reconnectTokens[code],
  );
  network = roomNetwork;
  let firstWelcome = true;
  roomNetwork.on("welcome", ({ playerId: id, map, snapshot: initial }) => {
    if (network !== roomNetwork) return;
    playerId = id;
    mapData = map;
    snapshot = initial;
    updateTestApi();
    profile.reconnectTokens[code] = roomNetwork.reconnectToken;
    saveProfile(profile);
    if (firstWelcome) {
      firstWelcome = false;
      renderForSnapshot(initial, true);
      if (addSoloBots && initial.hostId === id) {
        roomNetwork.addBot("easy");
        roomNetwork.addBot("normal");
        roomNetwork.addBot("normal");
      }
    } else {
      // A repeated welcome marks an authoritative reconnect boundary. Do not
      // keep a target captured from the pre-disconnect scene because that
      // object may have moved, changed, or been removed while offline.
      selectedTile = null;
      selectedTarget = null;
      soulVialTargetingId = null;
      soulVialArmPendingId = null;
      closeBuildPanel();
      game?.resetTransientInteraction();
      renderForSnapshot(initial, false);
      game?.updateSnapshot(initial, []);
    }
    updateTestApi();
  });
  roomNetwork.on("snapshot", ({ snapshot: next, events }) => {
    if (network !== roomNetwork) return;
    const previous = snapshot;
    snapshot = next;
    const armedSoulVialId = next.players.find(
      (player) => player.id === playerId,
    )?.armedSoulVialId;
    if (armedSoulVialId) {
      soulVialTargetingId = armedSoulVialId;
      soulVialArmPendingId = null;
    } else if (!soulVialArmPendingId) {
      soulVialTargetingId = null;
    }
    updateTestApi();
    renderForSnapshot(next, false);
    game?.updateSnapshot(next, events);
    playEvents(events);
    refreshSelectionPanel(previous);
    updateTestApi();
  });
  roomNetwork.on("connection", ({ state, attempt }) => {
    if (network === roomNetwork) updateConnection(state, attempt);
  });
  roomNetwork.on("error", ({ message, fatal }) => {
    if (network !== roomNetwork) return;
    if (fatal && firstWelcome) {
      invalidateRealtimeSession(roomNetwork, code);
      return;
    }
    if (soulVialArmPendingId) {
      soulVialTargetingId = null;
      soulVialArmPendingId = null;
    }
    game?.resetSleepInteraction();
    toast(message);
    refreshSelectionPanel(null);
  });
  roomNetwork.on("roomExit", ({ reason }) => {
    if (network !== roomNetwork) return;
    const message =
      reason === "kicked"
        ? "방장에 의해 방에서 나왔습니다."
        : reason === "room-closed"
          ? "마지막 플레이어가 나가 방이 종료되었습니다."
          : "방에서 나왔습니다.";
    exitRoomToMenu(message);
  });
  roomNetwork.on("ping", ({ milliseconds }) => {
    if (network !== roomNetwork) return;
    ping = milliseconds;
    updateHud();
  });
  roomNetwork.on("quickChat", ({ playerId: speakerId, phrase }) => {
    if (network !== roomNetwork || !snapshot) return;
    const speaker = snapshot.players.find((player) => player.id === speakerId);
    if (speaker) showQuickChatBubble(speaker.nickname, phrase);
  });
  roomNetwork.on("gameChat", ({ playerId: speakerId, message }) => {
    if (network !== roomNetwork || !snapshot) return;
    const speaker = snapshot.players.find((player) => player.id === speakerId);
    if (speaker) showQuickChatBubble(speaker.nickname, message);
  });
  roomNetwork.connect();
}

function lobbyScreen(state: GameSnapshot): void {
  destroyGame();
  const stage = getStage(state.stageId);
  const rankedLobby = Boolean(state.ranked);
  const roomRule =
    state.playMode === "multiplayer"
      ? "방 12개 · 방마다 25칸 · 침대 2개 · 공동 건설/강화"
      : "방 12개 · 방마다 20~25칸 · 다중 순환 경로";
  const roomCode =
    state.playMode === "multiplayer" && !rankedLobby
      ? `<div class="lobby-code"><div><span>ROOM CODE</span><small>코드를 눌러 복사</small></div><strong data-copy data-testid="room-code">${state.roomCode}</strong></div>`
      : "";
  setContent(
    "lobby",
    `<main class="lobby-screen ${state.playMode === "solo" ? "solo-lobby" : "multiplayer-lobby"} ${rankedLobby ? "ranked-lobby" : ""}"><div class="lobby-backdrop"></div><section class="lobby-shell"><header class="lobby-header"><div><span class="eyebrow">${rankedLobby ? `${state.ranked?.seasonId} 랭크 매치` : state.playMode === "solo" ? "혼자하기" : "친구랑하기"} · ${stageThemeFor(state.stageId).label}</span><p>${rankedLobby ? "대기열 배정 인원이 모두 연결되면 준비 없이 자동으로 시작됩니다." : state.playMode === "solo" ? "생존자 봇과 장비를 점검하세요." : "친구와 같은 방을 쓰거나 각자 다른 루트를 지킬 수 있습니다."}</p></div><div class="lobby-stage"><strong>${state.stageLabel}</strong></div></header>${roomCode}<section class="lobby-content"><div><div class="lobby-section-title"><strong>생존자 명단</strong><span>${state.players.length}/4 READY CHECK</span></div><div class="players" id="players" data-testid="players"></div></div><aside class="lobby-brief"><span>${rankedLobby ? "RANKED CONTRACT" : "NIGHT BRIEF"}</span><strong>${roomRule}</strong><p>등급 침대 보너스만큼 귀신도 강해집니다. 쌍둥이는 서로 다른 방과 문을 노릴 수 있습니다.</p><div><i style="width:${Math.min(100, 28 + state.stageIndex * 0.55)}%"></i></div><small>귀신 성장 HP +${Math.round(stage.levelHpGrowth * 100)}% · 공격 +${Math.round(stage.levelDamageGrowth * 100)}%</small></aside></section><section class="lobby-loadout" data-lobby-loadout></section><footer class="lobby-actions"><button class="btn danger" data-leave-room>방 나가기</button>${rankedLobby ? '<div class="ranked-lobby-autostart">랭크 대기열 완료 · 자동 시작 대기</div>' : `${state.playMode === "multiplayer" ? '<button class="btn ghost" data-lobby-invite>친구 초대</button>' : ""}<button class="btn ghost" data-ready>준비</button><button class="btn ghost" data-bot>봇 추가</button><button class="btn primary" data-start data-testid="start-game">게임 시작</button>`}</footer></section></main>`,
  );
  app.querySelector("[data-copy]")?.addEventListener("click", () => {
    void navigator.clipboard?.writeText(state.roomCode);
    toast("초대 코드를 복사했습니다.");
  });
  app.querySelector("[data-ready]")?.addEventListener("click", () => {
    const me = snapshot?.players.find((player) => player.id === playerId);
    network?.ready(!me?.ready);
    audio.play("button");
  });
  app.querySelector("[data-bot]")?.addEventListener("click", () => {
    network?.addBot("normal");
    audio.play("button");
  });
  app.querySelector("[data-start]")?.addEventListener("click", () => {
    network?.start();
    audio.play("button");
  });
  app.querySelector("[data-lobby-invite]")?.addEventListener("click", () => {
    audio.play("button");
    void showSocialHub("friends", state.roomCode);
  });
  app
    .querySelector<HTMLButtonElement>("[data-leave-room]")
    ?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      button.textContent = "나가는 중…";
      network?.leaveRoom();
      audio.play("button");
    });
  updateLobby(state);
}

function updateLobby(state: GameSnapshot): void {
  const container = app.querySelector("#players");
  if (!container) return;
  container.innerHTML =
    state.players
      .map((player) => {
        const profileDisplay = playerProfileDisplayInfo(player);
        const hostAction =
          !state.ranked && state.hostId === playerId && player.id !== playerId
            ? player.isBot
              ? `<button class="member-action" data-remove-bot="${player.id}">봇 제거</button>`
              : `<button class="member-action danger" data-kick-player="${player.id}">추방</button>`
            : "";
        return `<article class="player-card ${profileDisplay.className}" data-player-id="${player.id}">${playerPortraitHtml(player)}<div class="player-copy"><strong>${profileBadgeHtml(profileDisplay, "rank-badge-xs")} <span class="player-name">${escapeHtml(player.nickname)}${state.hostId === player.id ? " ★" : ""}</span></strong><span>${player.isBot ? "대기열 보충 봇" : player.connected ? (state.ranked ? "랭크 매치 배정 참가자" : profileDisplay.labelText) : "재접속 대기"}</span></div><div class="member-controls"><b class="ready-badge">${state.ranked ? "MATCHED" : player.ready || player.id === state.hostId ? "READY" : "WAIT"}</b>${hostAction}</div></article>`;
      })
      .join("") +
    (state.players.length < 4
      ? `<article class="player-card" style="opacity:.42"><i class="player-face-empty" aria-hidden="true">+</i><div class="player-copy"><strong>${state.ranked ? "연결 대기" : "빈 침대"}</strong><span>${state.ranked ? "배정된 참가자를 기다리는 중" : "친구 또는 봇"}</span></div></article>`
      : "");
  container
    .querySelectorAll<HTMLButtonElement>("[data-remove-bot]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        network?.removeBot(button.dataset.removeBot ?? ""),
      ),
    );
  container
    .querySelectorAll<HTMLButtonElement>("[data-kick-player]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        button.disabled = true;
        button.textContent = "추방 중…";
        network?.kickPlayer(button.dataset.kickPlayer ?? "");
      }),
    );
  const me = state.players.find((player) => player.id === playerId);
  const ready = app.querySelector<HTMLButtonElement>("[data-ready]");
  if (ready) ready.textContent = me?.ready ? "준비 취소" : "준비";
  const host = state.hostId === playerId;
  const start = app.querySelector<HTMLButtonElement>("[data-start]");
  const bot = app.querySelector<HTMLButtonElement>("[data-bot]");
  if (start) {
    start.disabled = !host;
    start.textContent = host ? "게임 시작" : "방장 대기 중";
  }
  if (bot) bot.disabled = !host || state.players.length >= 4;
  const loadout = app.querySelector<HTMLElement>("[data-lobby-loadout]");
  if (!loadout || !me) return;
  const owned = me.consumables
    .map((entry) => ({ entry, definition: shopConsumableById(entry.itemId) }))
    .filter(
      (
        entry,
      ): entry is {
        entry: (typeof me.consumables)[number];
        definition: NonNullable<ReturnType<typeof shopConsumableById>>;
      } => Boolean(entry.definition),
    );
  const selected = new Set(me.consumableLoadout);
  loadout.innerHTML = `<header><div><span class="eyebrow">TACTICAL LOADOUT</span><strong>전술 보급 장착 <small>${selected.size}/3</small></strong></div><button class="btn ghost" data-open-supply-shop>상점</button></header>${owned.length ? `<div class="loadout-items">${owned.map(({ entry, definition }) => `<button class="loadout-item ${selected.has(definition.id) ? "selected" : ""}" data-loadout-id="${definition.id}" aria-pressed="${selected.has(definition.id)}"><i>${definition.icon}</i><span><strong>${escapeHtml(definition.label)}</strong><small>${entry.quantity}개 보유 · ${escapeHtml(definition.description)}</small></span><b>${selected.has(definition.id) ? "장착" : "선택"}</b></button>`).join("")}</div><p>장착한 보급품은 한 판에 각각 한 번만 사용할 수 있습니다.</p>` : `<div class="loadout-empty"><span>아직 구매한 전술 보급이 없습니다.</span><button class="btn primary" data-open-supply-shop>전술 보급 상점</button></div>`}`;
  loadout
    .querySelectorAll<HTMLButtonElement>("[data-open-supply-shop]")
    .forEach((button) => button.addEventListener("click", supplyShopScreen));
  loadout
    .querySelectorAll<HTMLButtonElement>("[data-loadout-id]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const itemId = button.dataset.loadoutId as ConsumableId;
        const next = [...me.consumableLoadout];
        const index = next.indexOf(itemId);
        if (index >= 0) next.splice(index, 1);
        else if (next.length >= 3) {
          toast("전술 보급은 최대 3개까지 장착할 수 있습니다.");
          return;
        } else next.push(itemId);
        network?.setConsumableLoadout(next);
        audio.play("button");
      }),
    );
}

function gameScreen(state: GameSnapshot): void {
  const me = state.players.find((player) => player.id === playerId);
  const profileDisplay = me ? playerProfileDisplayInfo(me) : null;
  const stageBadge = profileDisplay
    ? profileBadgeHtml(profileDisplay, "rank-badge-game")
    : "";
  const stageRankLabel =
    profileDisplay && me
      ? `${escapeHtml(profileDisplay.labelText)} · ${escapeHtml(me.nickname)}`
      : "생존자";
  setContent(
    "game",
    `<main id="game-shell"><div id="game-root"></div><div class="render-mode">TOP-DOWN 2.5D · ${stageThemeFor(state.stageId).label}</div>${me ? `<button class="player-focus" data-focus-player aria-label="내 캐릭터 위치로 카메라 이동">${playerPortraitHtml(me)}<small>ME</small></button>` : ""}<div class="hud"><div class="stage-chip">${stageBadge}<div class="stage-copy"><span>${state.ranked ? `랭크전 · ${state.ranked.contractId}` : state.playMode === "solo" ? "혼자하기" : "친구랑하기"} · ${state.stageLabel}</span><strong>${stageRankLabel}</strong></div></div><div class="hud-group primary-stats"><div class="stat"><i>◆</i><span>골드</span><strong data-gold>0</strong></div><div class="stat"><i>⚡</i><span>전력</span><strong data-power>0</strong></div><div class="stat"><i>▣</i><span>문</span><strong data-door>—</strong></div></div><div class="hud-player-list hidden" data-hud-players aria-label="다른 생존자 위치"></div><div class="hud-group battle-stats"><div class="stat"><i>☾</i><span>귀신</span><strong data-ghost>Lv.1</strong></div><div class="stat"><i>🎁</i><span>뽑기</span><strong data-draw>0/${me ? drawLimitForAppearance(me.appearance) : 4}</strong></div><div class="stat"><i>◷</i><span>시간</span><strong data-time>00:00</strong></div></div><div class="network-pill" data-network data-testid="network">연결됨 · 0ms</div></div><aside class="ghost-threat-poster hidden" data-ghost-intro aria-live="polite"></aside><div class="countdown-start-notice hidden" data-countdown-warning role="status" aria-live="assertive">귀신이 움직입니다. 시간 안에 귀신을 피해 방에 숨어야 합니다.</div><div class="phase-banner" data-phase>준비 시간</div><aside class="first-match-guide hidden" data-first-match-guide aria-live="polite"></aside><div class="time-attack-clock hidden" data-time-attack></div><div class="time-attack-expired-notice hidden" data-time-attack-expired role="status" aria-live="assertive"></div><div class="camera-controls" aria-label="카메라 조작"><button data-camera="rotate-left" aria-label="카메라 축소">−</button><output data-camera-zoom>1.0×</output><button data-camera="zoom-in" aria-label="카메라 확대">＋</button></div><div class="controls"><div class="joystick" data-joystick><div class="joystick-knob"></div></div><div class="portrait-drag-hint"><i>↗</i><span>캐릭터를 누른 채<br>움직일 방향으로 드래그</span></div><div class="action-stack"><button class="round-btn secondary" data-quick-chat aria-label="팀 채팅">💬</button><button class="round-btn secondary hidden" data-inventory aria-label="가방">${gameActionIcon("bag")}</button><button class="round-btn" data-interact data-testid="interact" aria-label="침대 점유">${gameActionIcon("bed")}</button></div></div><aside class="build-panel hidden" data-build-panel></aside><div class="connection-overlay hidden" data-connection><div class="connection-card"><div class="spinner"></div><strong>연결을 복구하는 중</strong><p class="subtitle" data-reconnect-copy>30초 안에 기존 생존자로 돌아갑니다.</p></div></div></main>`,
  );
  const cameraZoomOut = app.querySelector<HTMLButtonElement>(
    '[data-camera="rotate-left"]',
  );
  if (cameraZoomOut) {
    cameraZoomOut.dataset.camera = "zoom-out";
    cameraZoomOut.setAttribute("aria-label", "카메라 축소");
  }
  const rankedIntro = document.createElement("aside");
  rankedIntro.className = "ranked-blackout-intro hidden";
  rankedIntro.dataset.rankedIntro = "";
  rankedIntro.setAttribute("aria-live", "polite");
  rankedIntro.innerHTML =
    '<div class="ranked-blackout-card"><img src="/assets/tutorial/ranked-blackout-intro.webp" alt="암전된 병동에서 빛을 밝히며 방을 찾는 생존자들"/><div><span>RANKED SURVIVAL</span><strong>어둠 속에서 먼저 방을 찾으세요</strong><p>랭크전 준비 시간에는 내 주변 2칸만 보입니다. 귀신의 시야를 피해 방 안으로 들어가 침대를 점유하세요.</p></div></div>';
  app.querySelector("#game-shell")?.appendChild(rankedIntro);
  const renderMode = app.querySelector<HTMLElement>(".render-mode");
  if (renderMode)
    renderMode.textContent = `TOP-DOWN 2.5D · ${stageThemeFor(state.stageId).label}`;
  app.querySelector("[data-interact]")?.remove();
  app
    .querySelectorAll(
      '[data-camera="rotate-left"], [data-camera="rotate-right"]',
    )
    .forEach((button) => button.remove());
  setupJoystick();
  const portraitDragCopy = app.querySelector<HTMLElement>(
    ".portrait-drag-hint span",
  );
  if (portraitDragCopy)
    portraitDragCopy.innerHTML = "화면을 누른 채<br>움직일 방향으로 드래그";
  app
    .querySelector("[data-inventory]")
    ?.addEventListener("click", showInventory);
  app
    .querySelector("[data-quick-chat]")
    ?.addEventListener("click", showQuickChatPicker);
  window.addEventListener(
    "dorm:tile-selected",
    onTileSelected as EventListener,
  );
  window.addEventListener(
    "dorm:target-selected",
    onTargetSelected as EventListener,
  );
  window.addEventListener(
    "dorm:building-drag-start",
    onBuildingDragStart as EventListener,
  );
  window.addEventListener(
    "dorm:building-move",
    onBuildingMove as EventListener,
  );
  window.addEventListener(
    "dorm:portrait-move",
    onPortraitMove as EventListener,
  );
  app
    .querySelector<HTMLElement>("#game-shell")
    ?.addEventListener("pointerdown", (event) => {
      const panel = app.querySelector<HTMLElement>("[data-build-panel]");
      if (
        !panel ||
        panel.classList.contains("hidden") ||
        panel.contains(event.target as Node)
      )
        return;
      closeBuildPanel();
    });
  if (!mapData) return;
  const gameRoot = app.querySelector<HTMLElement>("#game-root");
  if (!gameRoot) return;
  game = new ThreeGameView(gameRoot, {
    map: mapData,
    playerId,
    snapshot: state,
    onSleep: () => {
      // WebSocket messages are ordered. Flush a zero movement intent before
      // interact so a held touch cannot advance the authoritative position
      // after the client exposed the sleep prompt.
      inputVector = { x: 0, y: 0 };
      if (pendingMovementTimer) window.clearTimeout(pendingMovementTimer);
      pendingMovementTimer = 0;
      if (movementKeepaliveTimer)
        window.clearInterval(movementKeepaliveTimer);
      movementKeepaliveTimer = 0;
      sendMovement(true);
      network?.interact();
      audio.play("button");
    },
    onPickupLoot: (lootId) => {
      network?.pickupLoot(lootId);
      audio.play("button");
    },
  });
  app.querySelector("[data-focus-player]")?.addEventListener("click", () => {
    game?.focusLocalPlayer();
    audio.play("button");
  });
  // Playwright의 모바일 2-client 시나리오는 같은 프로세스에서 WebGL 장면을
  // 두 개 그린다. 자동화 중에는 네트워크/게임 상태만 진행하고 렌더 루프를
  // 멈춰 입력이 서버 시간보다 뒤처지지 않게 한다.
  if (document.hidden || automationMode) game.pause();
  const refreshCameraZoom = (): void => {
    const output = app.querySelector<HTMLOutputElement>("[data-camera-zoom]");
    if (output) output.value = `${game?.getCameraZoom().toFixed(1) ?? "1.0"}×`;
  };
  app.querySelectorAll<HTMLElement>("[data-camera]").forEach((button) =>
    button.addEventListener("click", () => {
      const action = button.dataset.camera;
      if (action === "zoom-in") game?.zoomBy(Math.SQRT2);
      else if (action === "zoom-out") game?.zoomBy(1 / Math.SQRT2);
      refreshCameraZoom();
      audio.play("button");
    }),
  );
  refreshCameraZoom();
  updateHud();
}

function renderForSnapshot(state: GameSnapshot, force: boolean): void {
  if (state.status === "LOBBY") {
    if (force || currentView !== "lobby") lobbyScreen(state);
    else updateLobby(state);
  } else if (
    state.status === "RANKED_INTRO" ||
    state.status === "GHOST_INTRO" ||
    state.status === "EVENT_INTRO" ||
    state.status === "COUNTDOWN" ||
    state.status === "PLAYING" ||
    state.status === "OVERTIME"
  ) {
    if (force || currentView !== "game") gameScreen(state);
    else updateHud();
  } else if (state.status === "VICTORY" || state.status === "DEFEAT") {
    if (force || currentView !== "result") resultScreen(state);
  }
}

function updateCountdownStartWarning(isCountdown: boolean): void {
  const warning = app.querySelector<HTMLElement>("[data-countdown-warning]");
  if (!warning) return;
  const enteringCountdown =
    isCountdown &&
    Boolean(snapshot?.ranked) &&
    previousGameStatus !== "COUNTDOWN";

  if (enteringCountdown) {
    if (countdownWarningTimer) window.clearTimeout(countdownWarningTimer);
    warning.hidden = false;
    warning.classList.remove("hidden", "is-visible");
    // Restart the entrance/fade animation when a new preparation phase begins.
    void warning.offsetWidth;
    warning.classList.add("is-visible");
    countdownWarningTimer = window.setTimeout(() => {
      warning.classList.remove("is-visible");
      warning.classList.add("hidden");
      countdownWarningTimer = 0;
    }, 2_500);
  } else if (!isCountdown) {
    if (countdownWarningTimer) window.clearTimeout(countdownWarningTimer);
    countdownWarningTimer = 0;
    warning.classList.remove("is-visible");
    warning.classList.add("hidden");
  }

  previousGameStatus = snapshot?.status ?? null;
}

const FIRST_MATCH_GUIDE_COPY: Record<
  TutorialStep,
  { index: number; title: string; description: string }
> = {
  "claim-bed": {
    index: 1,
    title: "안내된 빈 방에서 침대를 점유하세요",
    description: "침대 가까이 가면 나타나는 잠자기 버튼을 누르세요.",
  },
  "build-turret": {
    index: 2,
    title: "수호 포탑을 설치하세요",
    description: "빈 타일의 +를 누르면 지금 필요한 설비만 표시됩니다.",
  },
  "upgrade-bed": {
    index: 3,
    title: "침대를 Lv.2로 강화하세요",
    description: "침대가 매초 생산하는 골드가 늘어납니다.",
  },
  "upgrade-door": {
    index: 4,
    title: "문을 Lv.2로 강화하세요",
    description: "문이 버티는 동안 포탑이 귀신을 공격합니다.",
  },
  "upgrade-turret": {
    index: 5,
    title: "포탑을 Lv.2로 강화하세요",
    description: "훈련 귀신은 강화한 포탑 7발로 처치할 수 있습니다.",
  },
  retreat: {
    index: 6,
    title: "귀신의 후퇴와 회복을 확인하세요",
    description: "회색 HP는 후퇴 중인 체력입니다. 회복 전에 화력을 준비하세요.",
  },
  "build-generator": {
    index: 7,
    title: "달빛 발전기를 설치하세요",
    description: "지원 전력 450이 지급됐습니다. 전력 설비의 기반입니다.",
  },
  "build-frost": {
    index: 8,
    title: "서리 스프레이를 설치하세요",
    description: "귀신의 이동속도를 낮춰 포탑이 공격할 시간을 만드세요.",
  },
  "build-net": {
    index: 9,
    title: "그물 발사기를 설치하세요",
    description: "HP가 낮아진 귀신을 묶어 마지막 공격을 확정하세요.",
  },
  finish: {
    index: 10,
    title: "방어 준비 완료",
    description: "Lv.2 포탑의 다음 공격으로 훈련 귀신을 마무리하세요.",
  },
};

function updateFirstMatchGuide(current: GameSnapshot): void {
  const guide = app.querySelector<HTMLElement>("[data-first-match-guide]");
  if (!guide) return;
  const tutorial = current.tutorial;
  if (!tutorial?.active) {
    guide.classList.add("hidden");
    guide.innerHTML = "";
    return;
  }
  const copy = FIRST_MATCH_GUIDE_COPY[tutorial.step];
  const me = current.players.find((player) => player.id === playerId);
  const reservedRoom = mapData?.rooms.find(
    (room) => room.id === tutorial.reservedRoomId,
  );
  let direction = "";
  if (tutorial.step === "claim-bed" && me && reservedRoom) {
    const dx = reservedRoom.bed.x - me.position.x;
    const dy = reservedRoom.bed.y - me.position.y;
    direction =
      Math.abs(dx) > Math.abs(dy)
        ? dx >= 0
          ? "오른쪽"
          : "왼쪽"
        : dy >= 0
          ? "아래쪽"
          : "위쪽";
  }
  const paused = tutorial.pauseRemaining > 0;
  guide.classList.remove("hidden");
  guide.classList.toggle("retreat-lesson", paused);
  guide.innerHTML = paused
    ? `<div class="tutorial-retreat-card"><span>GHOST RETREAT</span><strong>귀신이 회복하러 후퇴합니다</strong><div class="tutorial-ghost-hp"><i style="width:30%"></i><b></b></div><p>회색으로 남은 HP는 퇴각 구간입니다.<br/>귀신은 리스폰 구역에서 회복한 뒤 다시 돌아옵니다.</p></div>`
    : `<div class="tutorial-guide-card"><b>${copy.index}/10</b><div><span>첫 생존 훈련${direction ? ` · ${direction} 방` : ""}</span><strong>${escapeHtml(copy.title)}</strong><p>${escapeHtml(copy.description)}</p></div></div>`;
}

function updateHud(): void {
  if (!snapshot || currentView !== "game") return;
  const movementIntroLocked =
    snapshot.status === "RANKED_INTRO" ||
    snapshot.status === "GHOST_INTRO" ||
    snapshot.status === "EVENT_INTRO";
  app
    .querySelector("#game-shell")
    ?.classList.toggle("intro-movement-locked", movementIntroLocked);
  if (movementIntroLocked) resetMovementForIntro();
  const me = snapshot.players.find((player) => player.id === playerId);
  const cameraZoomLocked = Boolean(snapshot.ranked && me?.alive && !me.roomId);
  app
    .querySelector("#game-shell")
    ?.classList.toggle("camera-zoom-locked", cameraZoomLocked);
  app
    .querySelectorAll<HTMLButtonElement>("[data-camera]")
    .forEach((button) => {
      button.disabled = cameraZoomLocked;
    });
  const room = snapshot.rooms.find((candidate) => candidate.id === me?.roomId);
  const localDanger = Boolean(
    me &&
      (isPlayerUnderGhostAttack(me, snapshot.ghosts) ||
        (room && room.doorHp / Math.max(1, room.doorMaxHp) <= 0.3)),
  );
  app
    .querySelector("#game-shell")
    ?.classList.toggle("local-danger", localDanger);
  app
    .querySelector(".portrait-drag-hint")
    ?.classList.toggle("hidden", Boolean(me?.roomId) || !me?.alive);
  app
    .querySelector("[data-inventory]")
    ?.classList.toggle(
      "hidden",
      !me?.alive ||
        (!me?.items.length &&
          !me?.consumableLoadout.length &&
          !snapshot.buildings.some(
            (building) =>
              building.ownerId === me.id && building.kind === "random-item",
          )),
    );
  app
    .querySelector("[data-interact]")
    ?.classList.toggle("hidden", Boolean(me?.roomId) || !me?.alive);
  updateHudTeammates();
  setText("[data-gold]", me ? Math.floor(me.gold).toString() : "0");
  setText("[data-power]", me ? Math.floor(me.power).toString() : "0");
  setText("[data-door]", room ? `${Math.ceil(room.doorHp)}` : "미점유");
  const aliveGhosts = snapshot.ghosts.filter((ghost) => ghost.hp > 0);
  const leadGhost = aliveGhosts[0] ?? snapshot.ghost;
  const ghostDefence = [
    leadGhost.barrierLayers > 0 ? `방어막×${leadGhost.barrierLayers}` : "",
    snapshot.difficulty.controlAdaptation
      ? `제어 ${Math.round(leadGhost.controlResolve)}%`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  setText(
    "[data-ghost]",
    `${aliveGhosts.length > 1 ? `${aliveGhosts.length}명 · ` : ""}Lv.${leadGhost.level} ${leadGhost.attackCount}/${leadGhost.attacksToNextLevel}${ghostDefence ? ` · ${ghostDefence}` : ""}`,
  );
  setText(
    "[data-draw]",
    `${me?.drawCount ?? 0}/${me ? drawLimitForAppearance(me.appearance) : 4}`,
  );
  setText("[data-time]", formatTime(snapshot.elapsed));
  const retreating = snapshot.ghosts.some(
    (ghost) => ghost.retreating || ghost.healing,
  );
  const goldLocked = snapshot.goldSuppressedUntil > snapshot.elapsed;
  const repairLocked = snapshot.repairSuppressedUntil > snapshot.elapsed;
  const skillWarning = goldLocked
    ? `⚠ 골드 획득 봉인 ${Math.ceil(snapshot.goldSuppressedUntil - snapshot.elapsed)}초`
    : repairLocked
      ? `⚠ 문 수리 봉인 ${Math.ceil(snapshot.repairSuppressedUntil - snapshot.elapsed)}초`
      : null;
  const phase = app.querySelector<HTMLElement>("[data-phase]");
  const isCountdown = snapshot.status === "COUNTDOWN";
  const isRankedIntro = snapshot.status === "RANKED_INTRO";
  const isGhostIntro = snapshot.status === "GHOST_INTRO";
  const isEventIntro = snapshot.status === "EVENT_INTRO";
  const rankedIntro = app.querySelector<HTMLElement>("[data-ranked-intro]");
  if (rankedIntro) {
    rankedIntro.hidden = !isRankedIntro;
    rankedIntro.classList.toggle("hidden", !isRankedIntro);
  }
  const ghostPoster = app.querySelector<HTMLElement>("[data-ghost-intro]");
  // The server holds this state for two seconds of a full card and two more
  // seconds of fade. Only after it clears does the 30-second timer begin.
  const showGhostPoster = isGhostIntro && !snapshot.ranked;
  if (ghostPoster) {
    ghostPoster.hidden = !showGhostPoster;
    ghostPoster.classList.toggle("hidden", !showGhostPoster);
    if (showGhostPoster) {
      const poster =
        GHOST_THREAT_POSTERS[leadGhost.variant] ??
        GHOST_THREAT_POSTERS.wanderer;
      if (poster) {
        const fading =
          snapshot.difficulty.introRemaining <= BALANCE.ghostIntroSeconds - 2;
        ghostPoster.classList.toggle("is-fading", fading);
        const artVariant =
          leadGhost.variant === "minion" ? "undead" : leadGhost.variant;
        ghostPoster.innerHTML = `<div class="ghost-threat-paper"><img src="/assets/ghost-intros/ghost-warning-frame.png" alt="" aria-hidden="true"/><img class="ghost-threat-art" src="/assets/sprites/ghosts/${artVariant}/concept.png" alt="${escapeHtml(poster.title)} 일러스트"/><div class="ghost-threat-copy"><span>HOSTILE ENTITY</span><strong>${escapeHtml(poster.title)}</strong><p>${escapeHtml(poster.warning)}</p></div></div>`;
      }
    }
  }
  if (phase) {
    phase.hidden = showGhostPoster || isRankedIntro;
    phase.classList.toggle("countdown", isCountdown);
    phase.classList.toggle("time-attack-intro", isEventIntro);
    if (isEventIntro) {
      phase.innerHTML =
        "<strong>TIME ATTACK</strong><span>당신에게 5분의 시간이 주어졌습니다.<br/>5분 안에 귀신을 물리치고 탈출하세요.</span>";
    } else {
      phase.textContent = isCountdown
        ? `${Math.ceil(snapshot.countdown)}`
        : (skillWarning ??
          (retreating
            ? "⚠ 귀신이 후퇴합니다"
            : `${snapshot.stageLabel} · ${snapshot.matchEvent} · 문 타격으로 귀신이 성장합니다`));
    }
    phase.setAttribute(
      "aria-label",
      isCountdown
        ? `게임 시작까지 ${Math.ceil(snapshot.countdown)}초`
        : phase.textContent,
    );
  }
  updateCountdownStartWarning(isCountdown);
  const timeAttack = app.querySelector<HTMLElement>("[data-time-attack]");
  if (timeAttack) {
    const remaining = snapshot.difficulty.timeAttackRemaining;
    const visible =
      snapshot.difficulty.modifier === "time-attack" &&
      (snapshot.status === "PLAYING" || snapshot.status === "OVERTIME");
    timeAttack.classList.toggle("hidden", !visible);
    if (visible && remaining !== null) {
      const seconds = Math.ceil(remaining);
      timeAttack.textContent =
        seconds >= 0
          ? formatTime(seconds)
          : `+${formatTime(Math.abs(seconds))}`;
      timeAttack.classList.toggle("overtime", snapshot.status === "OVERTIME");
    }
  }
  const net = app.querySelector<HTMLElement>("[data-network]");
  if (net) net.textContent = `연결됨 · ${Math.round(ping)}ms`;
  updateFirstMatchGuide(snapshot);
  refreshOpenPanelAffordability();
}

function updateHudTeammates(): void {
  if (!snapshot) return;
  const currentSnapshot = snapshot;
  const list = app.querySelector<HTMLElement>("[data-hud-players]");
  if (!list) return;
  const teammates = currentSnapshot.players.filter(
    (player) => player.id !== playerId,
  );
  const attackedIds = new Set(
    teammates
      .filter((player) =>
        isPlayerUnderGhostAttack(player, currentSnapshot.ghosts),
      )
      .map((player) => player.id),
  );
  const identity = teammates
    .map(
      (player) =>
        `${player.id}:${player.nickname}:${player.appearance.character}:${player.profileAvatarUrl ?? ""}:${player.alive ? "alive" : "dead"}:${attackedIds.has(player.id) ? "attacked" : "safe"}`,
    )
    .join("|");
  // Room occupancy does not change a teammate portrait. Including roomId in
  // this key rebuilt and decoded every portrait whenever a bot claimed a bed,
  // briefly blocking the render loop on mobile and making the local survivor
  // appear to teleport. Rebuild only when visible portrait data changes.
  if (list.dataset.players === identity) return;
  list.dataset.players = identity;
  list.classList.toggle("hidden", teammates.length === 0);
  list.innerHTML = teammates
    .map(
      (player) =>
        `<button type="button" class="hud-teammate ${player.alive ? "" : "dead"} ${attackedIds.has(player.id) ? "under-attack" : ""}" data-focus-teammate="${escapeHtml(player.id)}" aria-label="${escapeHtml(player.nickname)} ${player.alive ? "위치로 카메라 이동" : "사망"}">${playerPortraitHtml(player)}<span>${escapeHtml(player.nickname)}</span>${player.alive ? "" : '<b class="hud-teammate-state">사망</b>'}</button>`,
    )
    .join("");
  list
    .querySelectorAll<HTMLButtonElement>("[data-focus-teammate]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        game?.focusPlayer(button.dataset.focusTeammate ?? "");
        audio.play("button");
      }),
    );
}

function resultScreen(state: GameSnapshot): void {
  destroyGame();
  const victory = state.status === "VICTORY";
  if (!resultRecorded) {
    resultRecorded = true;
    profile.bestSurvivalSeconds = Math.max(
      profile.bestSurvivalSeconds,
      state.elapsed,
    );
    profile.bestGhostLevel = Math.max(
      profile.bestGhostLevel,
      state.ghost.level,
    );
    if (victory) {
      profile.victories += 1;
      profile.ghostKills += 1;
    }
    saveProfile(profile);
  }
  audio.play(victory ? "victory" : "defeat");
  const reward = customizationReward(state.stageIndex);
  const tutorialVictory = victory && state.stageId === "tutorial-1";
  const resultActions = tutorialVictory
    ? '<div class="result-actions tutorial-result-actions"><button class="btn ghost" data-tutorial-supplies>전술 보급 둘러보기</button><button class="btn primary" data-tutorial-easy>쉬움 1 시작</button></div>'
    : '<div class="result-actions"><button class="btn primary" data-rematch data-testid="rematch">다시 도전</button><button class="btn ghost" data-leave>게임 메뉴</button></div>';
  setContent(
    "result",
    `<main class="result-screen ${victory ? "victory" : "defeat"}"><div class="result-backdrop"></div><section class="result-card"><span class="result-kicker">${state.stageLabel} · ${victory ? "DAWN REPORT" : "NIGHT REPORT"}</span><div class="result-emblem">${victory ? "✦" : "☾"}</div><h1>${tutorialVictory ? "첫 생존 훈련 완료" : victory ? "새벽 생존" : "작전 실패"}</h1><p>${tutorialVictory ? "문 방어의 기본을 익혔습니다. 이제 실전에 도전할 수 있습니다." : victory ? "마지막 귀신까지 몰아냈습니다." : "방어선을 정비하고 다시 도전하세요."}</p><div class="result-stats"><article><small>생존 시간</small><strong>${formatTime(state.elapsed)}</strong></article><article><small>최종 귀신</small><strong>Lv.${state.ghost.level}</strong></article><article><small>스테이지</small><strong>${state.stageLabel}</strong></article></div>${victory ? `<div class="result-reward"><span>CLEAR REWARD</span><strong>✦ +${tutorialVictory ? 100 : reward} P</strong><small>${tutorialVictory ? "보급품을 준비하거나 바로 쉬움 1에 도전하세요." : "커스텀 상점 포인트와 승리 XP가 계정에 저장됩니다."}</small></div>` : '<div class="result-reward muted"><span>CHALLENGE RECORD</span><strong>도전 XP 저장</strong><small>획득한 진행 기록은 유지됩니다.</small></div>'}${resultActions}</section></main>`,
  );
  app.querySelector("[data-rematch]")?.addEventListener("click", () => {
    resultRecorded = false;
    network?.rematch();
    audio.play("button");
  });
  app.querySelector("[data-leave]")?.addEventListener("click", () => {
    const code = network?.code;
    network?.close();
    network = null;
    if (code) forgetRoom(code);
    loading();
    if (victory) {
      const nextStage = stagesThrough(state.stageIndex + 1).at(-1);
      if (nextStage) homeStageSelection[state.playMode] = nextStage.id;
    }
    void (async () => {
      // Match rewards are written by the room just after the result snapshot.
      // Retry briefly so returning home always receives the newly unlocked
      // stage instead of rendering the pre-clear dropdown selection.
      let next = await getAccount();
      for (let attempt = 1; attempt < 4; attempt += 1) {
        const unlockedIndex =
          state.playMode === "solo"
            ? next.soloStageIndex
            : next.multiplayerStageIndex;
        if (!victory || unlockedIndex > state.stageIndex) break;
        await new Promise<void>((resolve) => window.setTimeout(resolve, 360));
        next = await getAccount();
      }
      account = next;
      homePlayMode = next.selectedPlayMode;
      homeScreen();
    })().catch(() => authScreen());
  });
  const finishTutorialResult = async (
    destination: "supplies" | "easy",
  ): Promise<void> => {
    const code = network?.code;
    network?.close();
    network = null;
    if (code) forgetRoom(code);
    loading();
    let next = await getAccount();
    for (let attempt = 0; attempt < 4 && !next.tutorialCompleted; attempt += 1) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 360));
      next = await getAccount();
    }
    account = next;
    homePlayMode = next.selectedPlayMode;
    if (destination === "supplies") supplyShopScreen();
    else await createRoom(true, "easy-1");
  };
  app
    .querySelector("[data-tutorial-supplies]")
    ?.addEventListener("click", () => {
      audio.play("button");
      void finishTutorialResult("supplies").catch(() => authScreen());
    });
  app
    .querySelector("[data-tutorial-easy]")
    ?.addEventListener("click", () => {
      audio.play("button");
      void finishTutorialResult("easy").catch(() => authScreen());
    });
}

function claimAction(key: string, cooldown = ACTION_DEBOUNCE_MS): boolean {
  const now = performance.now();
  const previous = pendingActions.get(key) ?? 0;
  if (now - previous < cooldown) return false;
  pendingActions.set(key, now);
  window.setTimeout(() => {
    if (pendingActions.get(key) === now) pendingActions.delete(key);
  }, cooldown);
  return true;
}

function suppressTileSelection(milliseconds = 700): void {
  const blockedUntil = performance.now() + Math.max(0, milliseconds);
  tileSelectionBlockedUntil = Math.max(tileSelectionBlockedUntil, blockedUntil);
  buildPanelInputBlockedUntil = Math.max(
    buildPanelInputBlockedUntil,
    blockedUntil,
  );
  game?.suppressSelections(milliseconds);
}

function onTileSelected(event: CustomEvent<Tile>): void {
  if (performance.now() < tileSelectionBlockedUntil) return;
  const tile = event.detail;
  if (!claimAction(`tile-select:${tile.roomId}:${tile.x}:${tile.y}`, 460))
    return;
  // 캔버스 pointerup 뒤에 따라오는 합성 click이 새로 그린 설치 버튼까지
  // 전달되는 모바일 브라우저가 있다. 패널이 열린 직후에는 설치를 무조건
  // 한 번 더 터치해야 하도록 막아, 타일 한 번 탭으로 건물이 지어지지 않는다.
  buildPanelInputBlockedUntil = performance.now() + BUILD_PANEL_OPEN_GUARD_MS;
  selectedTarget = null;
  selectedTile = tile;
  renderBuildPanel(tile);
}

function onTargetSelected(event: CustomEvent<SceneSelection>): void {
  // 건물을 선택한 캔버스 터치와 같은 입력이 업그레이드/철거 버튼으로
  // 이어지지 않게, 선택 뒤에는 별도 터치를 한 번 더 요구한다.
  buildPanelInputBlockedUntil = performance.now() + BUILD_PANEL_OPEN_GUARD_MS;
  if (soulVialTargetingId && snapshot) {
    const target = snapshot.buildings.find(
      (building) => building.id === event.detail.targetId,
    );
    const me = snapshot.players.find((player) => player.id === playerId);
    if (
      !target ||
      !me ||
      target.ownerId !== me.id ||
      target.roomId !== me.roomId ||
      !["basic-turret", "golden-turret"].includes(target.kind)
    ) {
      toast("영혼 레이저를 충전할 내 포탑을 선택하세요.");
      return;
    }
    showSoulVialConfirm(soulVialTargetingId, target);
    return;
  }
  selectedTile = null;
  selectedTarget = event.detail;
  renderTargetPanel(event.detail);
}

function onBuildingDragStart(): void {
  selectedTile = null;
  selectedTarget = null;
  app.querySelector("[data-build-panel]")?.classList.add("hidden");
  toast(
    "설비 이동 모드 · 빈 타일에 놓거나 내 설비 위에 놓아 위치를 교환하세요.",
  );
}

function onBuildingMove(event: CustomEvent<BuildingMoveRequest>): void {
  if (!snapshot) return;
  const request = event.detail;
  const me = snapshot.players.find((player) => player.id === playerId);
  const building = snapshot.buildings.find(
    (candidate) => candidate.id === request.buildingId,
  );
  if (
    !me ||
    !building ||
    building.roomId !== me.roomId ||
    building.ownerId !== me.id
  ) {
    toast("자신이 설치한 현재 방의 설비만 옮길 수 있습니다.");
    return;
  }
  if (!claimAction(`move-building:${request.buildingId}`, 450)) return;
  suppressTileSelection(650);
  selectedTile = null;
  selectedTarget = null;
  app.querySelector("[data-build-panel]")?.classList.add("hidden");
  network?.moveBuilding(request.buildingId, request.tile);
}

function panelHeadingMarkup(kicker: string, title: string): string {
  return `<header class="build-panel-heading"><div><span>${kicker}</span><h3>${title}</h3></div><button class="panel-close" type="button" data-close-build aria-label="설치 창 닫기">×</button></header>`;
}

function resourceCostMarkup(cost: { gold: number; power: number }): string {
  const gold =
    cost.gold > 0 || cost.power <= 0
      ? `<span class="resource-cost gold">◆ <b>${cost.gold}</b></span>`
      : "";
  const power =
    cost.power > 0
      ? `<span class="resource-cost power">⚡ <b>${cost.power}</b></span>`
      : "";
  return `${gold}${power}`;
}

function buildingIconMarkup(kind: BuildingKind): string {
  return `<i class="building-panel-icon kind-${kind}" aria-hidden="true">${BUILDING_PANEL_ICONS[kind]}</i>`;
}

function wireBuildPanelClose(panel: HTMLElement): void {
  panel
    .querySelector<HTMLButtonElement>("[data-close-build]")
    ?.addEventListener("click", closeBuildPanel);
}

function wirePanelAction(button: HTMLButtonElement, action: () => void): void {
  button.addEventListener("pointerdown", (event) => {
    const now = performance.now();
    if (now < buildPanelInputBlockedUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    button.dataset.panelPointerAt = String(now);
  });
  button.addEventListener("click", (event) => {
    const now = performance.now();
    const pointerAt = Number(button.dataset.panelPointerAt ?? 0);
    const keyboardActivation = event.detail === 0;
    if (
      !keyboardActivation &&
      (now < buildPanelInputBlockedUntil ||
        !pointerAt ||
        now - pointerAt > BUILD_POINTER_ARM_WINDOW_MS)
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    action();
  });
}

function canAffordResources(
  player: PlayerState,
  gold: number,
  power: number,
): boolean {
  return player.gold + 1e-6 >= gold && player.power + 1e-6 >= power;
}

/** Keeps an open install/upgrade sheet live while passive income changes. */
function refreshOpenPanelAffordability(): void {
  if (!snapshot || currentView !== "game") return;
  const panel = app.querySelector<HTMLElement>("[data-build-panel]");
  if (!panel || panel.classList.contains("hidden")) return;
  const me = snapshot.players.find((player) => player.id === playerId);
  if (!me) return;
  setText("[data-owned-gold]", Math.floor(me.gold).toString());
  setText("[data-owned-power]", Math.floor(me.power).toString());
  panel
    .querySelectorAll<HTMLButtonElement>("[data-cost-gold]")
    .forEach((button) => {
      const gold = Number(button.dataset.costGold ?? 0);
      const power = Number(button.dataset.costPower ?? 0);
      const affordable =
        Number.isFinite(gold) &&
        Number.isFinite(power) &&
        canAffordResources(me, gold, power);
      const installLimited = button.dataset.buildLimit === "true";
      const enabled = affordable && !installLimited;
      button.disabled = !enabled;
      button.classList.toggle("resource-insufficient", !enabled);
      button.setAttribute("aria-disabled", String(!enabled));
      const actionLabel = button.querySelector<HTMLElement>(
        "[data-cost-action-label]",
      );
      if (actionLabel?.dataset.readyLabel) {
        actionLabel.textContent = enabled
          ? actionLabel.dataset.readyLabel
          : installLimited
            ? "이미 설치됨"
            : `${actionLabel.dataset.readyLabel} · 재화 부족`;
      }
    });
}

function renderBuildPanel(tile: Tile): void {
  if (!snapshot) return;
  const me = snapshot.players.find((player) => player.id === playerId);
  if (!me?.roomId || tile.roomId !== me.roomId) {
    toast("자신이 머무는 방의 타일만 사용할 수 있습니다.");
    return;
  }
  const panel = app.querySelector<HTMLElement>("[data-build-panel]");
  if (!panel) return;
  const occupied = snapshot.buildings.find(
    (building) => building.tile.x === tile.x && building.tile.y === tile.y,
  );
  if (occupied) {
    selectedTarget = {
      type: "building",
      targetId: occupied.id,
      buildingId: occupied.id,
      roomId: occupied.roomId,
    };
    selectedTile = null;
    renderTargetPanel(selectedTarget);
    return;
  }
  const gameState = snapshot;
  const modeRank =
    gameState.playMode === "solo" ? me.soloRank : me.multiplayerRank;
  const tutorialGuidedKinds: Partial<Record<TutorialStep, BuildingKind>> = {
    "build-turret": "basic-turret",
    "build-generator": "generator",
    "build-frost": "frost-turret",
    "build-net": "ghost-net",
  };
  const guidedKind = gameState.tutorial?.active
    ? tutorialGuidedKinds[gameState.tutorial.step]
    : undefined;
  const availableKinds: BuildingKind[] = guidedKind
    ? [guidedKind]
    : gameState.tutorial?.active
      ? []
      : [...BUILD_KINDS];
  const ownedBuildings = gameState.buildings.filter(
    (building) => building.ownerId === me.id,
  );
  const installedGoldenTurrets = ownedBuildings.filter(
    (building) => building.kind === "golden-turret",
  ).length;
  const goldenTurretSlots =
    gameState.ranked?.goldenTurretPolicy === "loaned"
      ? 1
      : combinedItemEffects(me.items).goldenTurretTickets;
  const canInstallGoldenTurret =
    gameState.ranked?.goldenTurretPolicy !== "disabled" &&
    installedGoldenTurrets < goldenTurretSlots;
  const buildLimitReason = (kind: BuildingKind): string | null => {
    if (
      [
        "lucky-machine",
        "range-amplifier",
        "overload-capacitor",
        "reflect-mirror",
        "power-panel",
        "soul-vial",
        "hide-and-seek-doll",
      ].includes(kind) &&
      ownedBuildings.some((building) => building.kind === kind)
    )
      return "이미 설치됨";
    if (
      ["ghost-net", "door-anchor"].includes(kind) &&
      gameState.buildings.some(
        (building) => building.roomId === me.roomId && building.kind === kind,
      )
    )
      return "이 방에 이미 설치됨";
    if (
      kind === "cursed-contract" &&
      (gameState.contractUsed ||
        gameState.buildings.some((building) => building.kind === kind))
    )
      return gameState.contractUsed ? "이번 게임에서 사용 완료" : "이미 설치됨";
    if (kind === "hide-and-seek-doll" && me.hideAndSeekDollBuilt)
      return "이번 게임 설치 완료";
    return null;
  };
  const buildCard = (kind: BuildingKind): string => {
    const definition = BALANCE.buildings[kind];
    const cost = upgradeCost(kind, 1, modeRank);
    const ticketBuild = kind === "golden-turret";
    const powerOnly = cost.gold === 0 && cost.power > 0;
    const affordable = canAffordResources(me, cost.gold, cost.power);
    const limitReason = buildLimitReason(kind);
    const enabled = affordable && !limitReason;
    return `<button class="build-card catalog-card ${powerOnly ? "power-only-build" : ""}${enabled ? "" : " resource-insufficient"}" type="button" data-build="${kind}" data-cost-gold="${cost.gold}" data-cost-power="${cost.power}"${limitReason ? ' data-build-limit="true"' : ""} ${enabled ? "" : 'disabled aria-disabled="true"'}><span class="catalog-art build-art"><img data-building-art="${kind}" alt="${escapeHtml(definition.label)} 인게임 탑다운 모습" /></span><span class="build-card-copy"><strong>${definition.label}</strong>${powerOnly ? `<em class="power-only-badge">⚡ 전력 전용</em>` : ""}<small>${definition.description}</small>${limitReason ? `<em class="build-limit-note">${limitReason}</em>` : ""}</span><span class="build-card-cost">${ticketBuild ? '<span class="resource-cost gold">🎟 <b>티켓 1장</b></span>' : resourceCostMarkup(cost)}</span></button>`;
  };
  const goldCards = GOLD_BUILD_ORDER
    // 랜덤 상자는 비용이 0이라 일반 비용 분류에서는 빠진다. 전력 설비가
    // 아니라 골드/아이템 설비이므로 골드 탭에 항상 남겨 둔다.
    .filter(
      (kind) =>
        availableKinds.includes(kind) &&
        upgradeCost(kind, 1, modeRank).gold > 0 ||
        (availableKinds.includes(kind) &&
          (kind === "lucky-machine" ||
            (kind === "golden-turret" && canInstallGoldenTurret))),
    )
    .map(buildCard)
    .join("");
  const powerCards = availableKinds
    .filter((kind) => upgradeCost(kind, 1, modeRank).power > 0)
    .map(buildCard)
    .join("");
  const supplyCards =
    me.consumables
      .filter((owned) => owned.quantity > 0)
      .map((owned) => {
        const supply = shopConsumableById(owned.itemId);
        if (!supply) return "";
        return `<button class="build-card catalog-card supply-build-card" type="button" data-open-build-inventory><span class="catalog-art build-art"><img data-supply-art="${supply.id}" alt="${escapeHtml(supply.label)}" /></span><span class="build-card-copy"><strong>${escapeHtml(supply.label)} ×${owned.quantity}</strong><small>${escapeHtml(supply.description)}</small></span><span class="build-card-cost">보급함에서 사용</span></button>`;
      })
      .join("") ||
    '<p class="empty-build-tab">구매한 전투 보급이 없습니다.</p>';
  panel.innerHTML = `${panelHeadingMarkup("INSTALL", "빈 타일에 설비 설치")}<div class="panel-wallet"><span>타일 ${tile.x + 1}, ${tile.y + 1}</span><strong>◆ <b data-owned-gold>${Math.floor(me.gold)}</b></strong><strong>⚡ <b data-owned-power>${Math.floor(me.power)}</b></strong></div><nav class="build-resource-tabs"><button class="active" data-build-tab="gold">골드</button><button data-build-tab="power">전력</button><button data-build-tab="supply">보급</button></nav><section class="build-tab-panel" data-build-tab-panel="gold"><div class="build-grid">${goldCards}</div></section><section class="build-tab-panel hidden" data-build-tab-panel="power"><div class="build-grid">${powerCards}</div></section><section class="build-tab-panel hidden" data-build-tab-panel="supply"><div class="build-grid">${supplyCards}</div></section>`;
  panel.classList.remove("hidden");
  refreshOpenPanelAffordability();
  hydrateCatalogArt(panel, {
    appearance: me.appearance,
    turretSkins: me.turretSkins,
  });
  panel
    .querySelectorAll<HTMLButtonElement>("[data-build-tab]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const tab = button.dataset.buildTab;
        panel
          .querySelectorAll("[data-build-tab]")
          .forEach((candidate) =>
            candidate.classList.toggle("active", candidate === button),
          );
        panel
          .querySelectorAll<HTMLElement>("[data-build-tab-panel]")
          .forEach((section) =>
            section.classList.toggle(
              "hidden",
              section.dataset.buildTabPanel !== tab,
            ),
          );
      }),
    );
  panel
    .querySelectorAll<HTMLButtonElement>("[data-open-build-inventory]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        closeBuildPanel();
        showInventory();
      }),
    );
  wireBuildPanelClose(panel);
  panel
    .querySelectorAll<HTMLButtonElement>("[data-build]")
    .forEach((button) => {
      wirePanelAction(button, () => {
        if (!selectedTile || !me.roomId) return;
        const kind = button.dataset.build as BuildingKind;
        const tileToBuild = { ...selectedTile };
        const actionKey = `build:${me.roomId}:${tileToBuild.x}:${tileToBuild.y}`;
        if (!claimAction(actionKey)) return;
        suppressTileSelection(900);
        selectedTile = null;
        selectedTarget = null;
        panel.classList.add("hidden");
        panel
          .querySelectorAll<HTMLButtonElement>("[data-build]")
          .forEach((candidate) => {
            candidate.disabled = true;
          });
        const label = button.querySelector("strong");
        if (label)
          label.textContent = `${BALANCE.buildings[kind].label} 설치 중…`;
        network?.build(me.roomId, tileToBuild, kind);
      });
    });
}

function showContractChoice(buildingId: string): void {
  const modal = dismissibleModal(
    `<section class="panel compact purchase-confirm" role="dialog" aria-modal="true"><span class="eyebrow">CURSED CONTRACT</span><h2>저주 계약을 선택하세요</h2><p class="subtitle">선택은 되돌릴 수 없고, 이번 게임에서 한 번만 사용할 수 있습니다.</p><div class="purchase-confirm-actions"><button class="btn ghost" data-contract-choice="berserk">폭주 포탑<br/><small>최고 레벨 포탑 폭주 · 문 최대 HP -35%</small></button><button class="btn danger" data-contract-choice="production">생산 증폭<br/><small>생산량 +50% · 문 최대 HP -50%</small></button></div><button class="btn ghost" data-modal-close>취소</button></section>`,
    "purchase-confirm-modal",
  );
  modal
    .querySelectorAll<HTMLButtonElement>("[data-contract-choice]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const action =
          button.dataset.contractChoice === "production"
            ? "production"
            : "berserk";
        modal.remove();
        network?.activateBuilding(buildingId, action);
      }),
    );
}

function showSoulVialConfirm(
  vialId: string,
  turret: GameSnapshot["buildings"][number],
): void {
  const modal = dismissibleModal(
    `<section class="panel compact purchase-confirm" role="dialog" aria-modal="true"><span class="eyebrow">SOUL VIAL</span><h2>영혼 저장병을 사용하시겠습니까?</h2><p class="subtitle"><strong>${escapeHtml(BALANCE.buildings[turret.kind].label)}</strong>이(가) 2초 동안 충전한 뒤 다음 공격에 영혼 레이저를 발사합니다.</p><div class="purchase-confirm-actions"><button class="btn ghost" data-modal-close>취소</button><button class="btn gold" data-confirm-soul>충전 시작</button></div></section>`,
    "purchase-confirm-modal",
  );
  const cancelTargeting = () => {
    soulVialTargetingId = null;
    soulVialArmPendingId = null;
    selectedTarget = null;
    network?.activateBuilding(vialId, "soul-cancel");
  };
  modal.addEventListener("pointerdown", (event) => {
    if (event.target === modal) cancelTargeting();
  });
  modal
    .querySelector<HTMLButtonElement>("[data-modal-close]")
    ?.addEventListener("click", cancelTargeting);
  modal
    .querySelector<HTMLButtonElement>("[data-confirm-soul]")
    ?.addEventListener("click", () => {
      modal.remove();
      soulVialTargetingId = null;
      soulVialArmPendingId = null;
      network?.activateBuilding(vialId, "soul-fire", turret.id);
    });
}

function renderTargetPanel(selection: SceneSelection): void {
  if (!snapshot) return;
  const me = snapshot.players.find((player) => player.id === playerId);
  const panel = app.querySelector<HTMLElement>("[data-build-panel]");
  if (!me || !panel) return;
  if (selection.roomId !== me.roomId) {
    toast("자신이 머무는 방의 설비만 조작할 수 있습니다.");
    return;
  }
  const room = snapshot.rooms.find(
    (candidate) => candidate.id === selection.roomId,
  );
  const building = selection.buildingId
    ? snapshot.buildings.find(
        (candidate) => candidate.id === selection.buildingId,
      )
    : undefined;
  const kind: BuildingKind =
    selection.type === "bed"
      ? "bed"
      : selection.type === "door"
        ? "reinforced-door"
        : (building?.kind ?? "basic-turret");
  const bedIndex =
    selection.type === "bed"
      ? Number(selection.targetId.split(":")[2] ?? me.bedIndex ?? 0)
      : 0;
  const currentLevel =
    selection.type === "bed"
      ? (room?.bedLevels[bedIndex] ?? 1)
      : selection.type === "door"
        ? (room?.doorLevel ?? 1)
        : (building?.level ?? 1);
  const definition = BALANCE.buildings[kind];
  const modeRank =
    snapshot.playMode === "solo" ? me.soloRank : me.multiplayerRank;
  const removalMarkup = building
    ? buildingRemovalMarkup(building, modeRank)
    : "";
  if (building && kind === "overload-capacitor") {
    const remaining = Math.max(
      0,
      (building.overloadReadyAt ?? 0) - snapshot.elapsed,
    );
    const active = Math.max(
      0,
      (building.overloadUntil ?? 0) - snapshot.elapsed,
    );
    const ready = remaining <= 0 && active <= 0;
    panel.innerHTML = `${panelHeadingMarkup("ACTIVE", `${buildingIconMarkup(kind)} ${definition.label}`)}<p class="panel-description">${definition.description}</p><div class="target-card"><div class="target-card-title"><span>${active > 0 ? "포탑 폭주 중" : ready ? "충전 완료" : "충전 중"}</span><strong>${active > 0 ? `${active.toFixed(1)}초` : ready ? "사용 가능" : `${Math.ceil(remaining)}초`}</strong></div><small>발동하면 내 모든 수호 포탑의 공격력과 공격 속도가 8초 동안 크게 올라갑니다.</small></div><button class="upgrade-cta${ready ? "" : " resource-insufficient"}" type="button" data-activate-overload ${ready ? "" : "disabled"}>${ready ? "폭주 시작" : active > 0 ? "폭주 진행 중" : "충전 중"}</button>${removalMarkup}`;
    panel.classList.remove("hidden");
    wireBuildPanelClose(panel);
    const button = panel.querySelector<HTMLButtonElement>(
      "[data-activate-overload]",
    );
    if (button)
      wirePanelAction(button, () =>
        network?.activateBuilding(building.id, "use"),
      );
    wireBuildingRemoval(panel, building.id);
    return;
  }
  if (building && kind === "power-panel") {
    const mode = building.powerPanelMode ?? "attack";
    const modes: Array<{
      id: "attack" | "defense" | "production";
      label: string;
      copy: string;
    }> = [
      {
        id: "attack",
        label: "공격",
        copy: "포탑 피해 +25%, 공속 +18% · 문 피해 +25%",
      },
      {
        id: "defense",
        label: "방어",
        copy: "문 피해 -25% · 포탑 피해·생산 -15%",
      },
      {
        id: "production",
        label: "생산",
        copy: "골드·전력 +25% · 포탑 피해 -15%, 문 피해 +15%",
      },
    ];
    panel.innerHTML = `${panelHeadingMarkup("MODE", `${buildingIconMarkup(kind)} ${definition.label}`)}<p class="panel-description">한 가지를 강화하면 다른 능력에는 반드시 손해가 생깁니다.</p><div class="build-grid">${modes.map((entry) => `<button class="build-card ${entry.id === mode ? "active" : ""}" type="button" data-panel-mode="${entry.id}"><span class="build-card-copy"><strong>${entry.label}</strong><small>${entry.copy}</small></span></button>`).join("")}</div>${removalMarkup}`;
    panel.classList.remove("hidden");
    wireBuildPanelClose(panel);
    panel
      .querySelectorAll<HTMLButtonElement>("[data-panel-mode]")
      .forEach((button) =>
        wirePanelAction(button, () => {
          // Reflect the chosen mode immediately. The next snapshot remains
          // authoritative, but reopening the panel never flashes back to the
          // default attack card while that action is in flight.
          panel
            .querySelectorAll("[data-panel-mode]")
            .forEach((candidate) =>
              candidate.classList.toggle(
                "active",
                candidate === button,
              ),
            );
          network?.activateBuilding(
            building.id,
            button.dataset.panelMode as "attack" | "defense" | "production",
          );
        }),
      );
    wireBuildingRemoval(panel, building.id);
    return;
  }
  if (building && kind === "cursed-contract") {
    panel.innerHTML = `${panelHeadingMarkup("ACTIVE", `${buildingIconMarkup(kind)} ${definition.label}`)}<p class="panel-description">최고 레벨 포탑을 폭주시키거나, 생산량을 올리는 대신 문 최대 HP를 크게 희생합니다.</p><button class="upgrade-cta" type="button" data-use-contract>계약 사용</button>${removalMarkup}`;
    panel.classList.remove("hidden");
    wireBuildPanelClose(panel);
    const button = panel.querySelector<HTMLButtonElement>(
      "[data-use-contract]",
    );
    if (button) wirePanelAction(button, () => showContractChoice(building.id));
    wireBuildingRemoval(panel, building.id);
    return;
  }
  if (building && kind === "soul-vial") {
    const stored = Math.floor(building.storedSoulDamage ?? 0);
    const ready = stored > 0;
    panel.innerHTML = `${panelHeadingMarkup("ACTIVE", `${buildingIconMarkup(kind)} ${definition.label}`)}<p class="panel-description">내 포탑이 입힌 피해를 저장합니다. 사용하면 포탑 한 대가 다음 공격에 저장 피해의 35%만큼 영혼 레이저를 추가로 발사합니다.</p><div class="target-card"><div class="target-card-title"><span>저장 피해</span><strong>${stored.toLocaleString()}</strong></div><small>사용하면 저장병은 사라집니다.</small></div><button class="upgrade-cta${ready ? "" : " resource-insufficient"}" type="button" data-arm-soul ${ready ? "" : "disabled"}>${ready ? "포탑 지정" : "피해를 저장 중"}</button>${removalMarkup}`;
    panel.classList.remove("hidden");
    wireBuildPanelClose(panel);
    const button = panel.querySelector<HTMLButtonElement>("[data-arm-soul]");
    if (button)
      wirePanelAction(button, () => {
        soulVialTargetingId = building.id;
        soulVialArmPendingId = building.id;
        network?.activateBuilding(building.id, "soul-arm");
        closeBuildPanel();
        toast("충전할 내 포탑을 선택하세요.");
      });
    wireBuildingRemoval(panel, building.id);
    return;
  }
  if (building && kind === "hide-and-seek-doll") {
    panel.innerHTML = `${panelHeadingMarkup("ACTIVE", `${buildingIconMarkup(kind)} ${definition.label}`)}<p class="panel-description">${definition.description}</p><div class="target-card"><div class="target-card-title"><span>사용 효과</span><strong>귀신 목표 변경</strong></div><small>다른 생존 방이 있으면 그곳으로 이동합니다. 다른 방이 없으면 3초 동안 복도를 방황합니다.</small></div><button class="upgrade-cta" type="button" data-use-hide-and-seek>인형 사용</button>${removalMarkup}`;
    panel.classList.remove("hidden");
    wireBuildPanelClose(panel);
    panel.querySelector<HTMLButtonElement>("[data-use-hide-and-seek]")?.addEventListener("click", () => {
      const modal = dismissibleModal(`<section class="panel compact purchase-confirm" role="dialog" aria-modal="true"><span class="eyebrow">HIDE AND SEEK</span><h2>숨바꼭질 인형을 사용하시겠습니까?</h2><p class="subtitle">사용하면 인형은 사라지고, 귀신의 공격 목표가 바뀝니다. 한 번만 사용 가능하니 신중하게 사용하세요.</p><div class="purchase-confirm-actions"><button class="btn ghost" data-modal-close>취소</button><button class="btn gold" data-confirm-hide-and-seek>사용</button></div></section>`, "purchase-confirm-modal");
      modal.querySelector<HTMLButtonElement>("[data-confirm-hide-and-seek]")?.addEventListener("click", () => {
        modal.remove();
        closeBuildPanel();
        network?.activateBuilding(building.id, "hide-and-seek");
      });
    });
    wireBuildingRemoval(panel, building.id);
    return;
  }
  if (kind === "lucky-machine" && building) {
    const drawLimit = drawLimitForAppearance(me.appearance);
    const cost =
      me.drawCount < drawLimit ? DRAW_COSTS[me.drawCount] : undefined;
    const owned =
      me.items
        .map(
          (item) =>
            `${escapeHtml(item.label)}${item.count > 1 ? ` ×${item.count}` : ""}`,
        )
        .join(" · ") || "아직 획득한 아이템이 없습니다.";
    const canAffordDraw = Boolean(
      cost && canAffordResources(me, cost.gold, cost.power),
    );
    panel.innerHTML = `${panelHeadingMarkup("DRAW", `${buildingIconMarkup(kind)} ${definition.label}`)}<p class="panel-description">${definition.description}</p><div class="target-card"><div class="target-card-title"><span>이번 판 사용 횟수</span><strong>${me.drawCount} / ${drawLimit}회</strong></div><small>${owned}</small></div>${cost ? `<button class="upgrade-cta draw-cta${canAffordDraw ? "" : " resource-insufficient"}" type="button" data-draw data-cost-gold="${cost.gold}" data-cost-power="${cost.power}" ${canAffordDraw ? "" : 'disabled aria-disabled="true"'}><span data-cost-action-label data-ready-label="${me.drawCount + 1}번째 랜덤 뽑기">${me.drawCount + 1}번째 랜덤 뽑기${canAffordDraw ? "" : " · 재화 부족"}</span><strong>${resourceCostMarkup(cost)}</strong></button>` : `<button class="btn ghost panel-disabled" disabled>이번 판 ${drawLimit}회 완료</button>`}<small class="odds-note">신화·전설 아이템은 매우 낮은 확률이며, 꽝 장식품은 단 두 종류만 등장합니다.</small>${removalMarkup}`;
    panel.classList.remove("hidden");
    refreshOpenPanelAffordability();
    wireBuildPanelClose(panel);
    const drawButton = panel.querySelector<HTMLButtonElement>("[data-draw]");
    if (drawButton)
      wirePanelAction(drawButton, () => {
        // A map tap can arrive with a delayed second pointer event on mobile.
        // Lock immediately so opening the chest always requires one deliberate
        // press and can never consume two draws from a double tap.
        if (drawButton.disabled) return;
        drawButton.disabled = true;
        drawButton.setAttribute("aria-disabled", "true");
        buildPanelInputBlockedUntil = performance.now() + ACTION_DEBOUNCE_MS;
        network?.drawItem(building.id);
      });
    wireBuildingRemoval(panel, building.id);
    return;
  }
  if (kind === "random-item" && building) {
    const item = getRandomItem(building.itemId ?? "");
    const goldenTicket = building.itemId === "golden-ticket";
    const ticketAction = goldenTicket
      ? `<p class="reward-source-note">이 티켓을 사용하면 현재 타일에 황금 심판 포탑을 설치합니다.</p><button class="upgrade-cta" type="button" data-install-golden-ticket>황금 포탑 설치</button>`
      : `<p class="reward-source-note">철거할 때까지 이 위치에서 효과가 계속 적용됩니다.</p>`;
    panel.innerHTML = `${panelHeadingMarkup("REWARD", `${buildingIconMarkup(kind)} ${escapeHtml(item?.label ?? "랜덤 보상")}`)}<p class="panel-description reward-description">${escapeHtml(item?.description ?? definition.description)}</p>${ticketAction}${removalMarkup}`;
    panel.classList.remove("hidden");
    wireBuildPanelClose(panel);
    const installGoldenTicket = panel.querySelector<HTMLButtonElement>("[data-install-golden-ticket]");
    if (installGoldenTicket)
      wirePanelAction(installGoldenTicket, () => {
        if (installGoldenTicket.disabled) return;
        installGoldenTicket.disabled = true;
        installGoldenTicket.setAttribute("aria-disabled", "true");
        network?.activateBuilding(building.id, "install-golden-turret");
      });
    wireBuildingRemoval(panel, building.id);
    return;
  }
  const benefits = rankBenefits(modeRank);
  const maxLevel = maxBuildingLevel(kind, modeRank);
  const nextLevel = currentLevel + 1;
  const current = buildingStats(kind, currentLevel);
  const doorDestroyed = selection.type === "door" && (room?.doorHp ?? 0) <= 0;
  const requirement = upgradeRequirement(kind, currentLevel, {
    bedLevel: room?.bedLevels[me.bedIndex ?? 0] ?? 1,
    doorLevel: room?.doorLevel ?? 1,
  });
  const cost =
    !doorDestroyed && !requirement && currentLevel < maxLevel
      ? upgradeCost(kind, nextLevel, modeRank)
      : null;
  const canAffordUpgrade = Boolean(
    cost && me.gold >= cost.gold && me.power >= cost.power,
  );
  const effectLabel =
    kind === "bed"
      ? `초당 골드 ${(current.value * benefits.bedGoldMultiplier).toFixed(1)} · 등급 보너스 ×${benefits.bedGoldMultiplier.toFixed(1)}`
      : kind === "reinforced-door"
        ? doorDestroyed
          ? "파괴됨 · 복구 및 업그레이드 불가"
          : `현재 HP ${Math.ceil(room?.doorHp ?? 0)} / ${Math.ceil(room?.doorMaxHp ?? current.value)}`
        : kind === "basic-turret"
          ? `공격력 ${current.value} · 사거리 ${current.range}`
          : kind === "frost-turret"
            ? `이동 속도 ${Math.round(current.value * 100)}% 감소 · 범위 ${current.range}칸 · 중첩 가능`
            : `효과 수치 ${current.value}`;
  const unavailableLabel = doorDestroyed
    ? "문이 파괴되어 업그레이드할 수 없습니다"
    : (requirement ?? "최고 레벨 달성");
  panel.innerHTML = `${panelHeadingMarkup("UPGRADE", `${buildingIconMarkup(kind)} ${definition.label}`)}<p class="panel-description">${definition.description}</p><div class="target-card"><div class="target-card-title"><span>현재 단계</span><strong>Lv.${currentLevel} / ${maxLevel}</strong></div><small>${effectLabel}</small></div>${cost ? `<button class="upgrade-cta${canAffordUpgrade ? "" : " resource-insufficient"}" type="button" data-upgrade="${selection.targetId}" data-cost-gold="${cost.gold}" data-cost-power="${cost.power}" ${canAffordUpgrade ? "" : 'disabled aria-disabled="true"'}><span data-cost-action-label data-ready-label="Lv.${nextLevel} 업그레이드">Lv.${nextLevel} 업그레이드${canAffordUpgrade ? "" : " · 재화 부족"}</span><strong>${resourceCostMarkup(cost)}</strong></button>` : `<button class="btn ghost panel-disabled" disabled>${unavailableLabel}</button>`}${removalMarkup}`;
  panel.classList.remove("hidden");
  refreshOpenPanelAffordability();
  wireBuildPanelClose(panel);
  const upgradeButton =
    panel.querySelector<HTMLButtonElement>("[data-upgrade]");
  if (upgradeButton)
    wirePanelAction(upgradeButton, () =>
      attemptUpgrade(selection, currentLevel, cost),
    );
  if (building) wireBuildingRemoval(panel, building.id);
}

function buildingRemovalMarkup(
  building: GameSnapshot["buildings"][number],
  rank: RankId,
): string {
  let fallbackGold = 0;
  let fallbackPower = 0;
  for (let level = 1; level <= building.level; level += 1) {
    const cost = upgradeCost(building.kind, level, rank);
    fallbackGold += cost.gold;
    fallbackPower += cost.power;
  }
  const refundGold = Math.floor((building.investedGold ?? fallbackGold) * 0.7);
  const refundPower = Math.floor(
    (building.investedPower ?? fallbackPower) * 0.7,
  );
  return `<div class="remove-building"><span>철거하면 투자 재화의 70%를 각 투자자에게 돌려줍니다.</span><button class="btn danger" data-remove-building="${building.id}">철거 · ◆ ${refundGold} + ⚡ ${refundPower} 환급</button></div>`;
}

function wireBuildingRemoval(panel: HTMLElement, buildingId: string): void {
  const button = panel.querySelector<HTMLButtonElement>(
    `[data-remove-building="${buildingId}"]`,
  );
  if (!button) return;
  wirePanelAction(button, () => {
    if (!claimAction(`remove:${buildingId}`)) return;
    suppressTileSelection(900);
    button.disabled = true;
    button.textContent = "철거 중…";
    selectedTile = null;
    selectedTarget = null;
    panel.classList.add("hidden");
    network?.removeBuilding(buildingId);
  });
}

function attemptUpgrade(
  selection: SceneSelection,
  currentLevel: number,
  cost: { gold: number; power: number } | null,
): void {
  if (!snapshot || !cost) return;
  const me = snapshot.players.find((player) => player.id === playerId);
  if (!me || me.gold < cost.gold || me.power < cost.power) {
    toast(`업그레이드 비용이 부족합니다. ◆ ${cost.gold} / ⚡ ${cost.power}`);
    return;
  }
  if (!claimAction(`upgrade:${selection.targetId}`)) return;
  // 터치 업그레이드 뒤 이어지는 pointerup/click이 캔버스의 같은 프레임에
  // 전달되어 빈 타일 설치를 여는 일을 막는다.
  suppressTileSelection();
  network?.upgrade(selection.targetId);
  const button = app.querySelector<HTMLButtonElement>(
    `[data-upgrade="${selection.targetId}"]`,
  );
  if (button) {
    button.disabled = true;
    button.textContent = `Lv.${currentLevel + 1} 적용 중…`;
  }
}

function selectionLevel(
  state: GameSnapshot | null,
  selection: SceneSelection,
): number | null {
  if (!state) return null;
  const room = state.rooms.find(
    (candidate) => candidate.id === selection.roomId,
  );
  if (selection.type === "bed") {
    const bedIndex = Number(selection.targetId.split(":")[2] ?? 0);
    return room?.bedLevels[bedIndex] ?? null;
  }
  if (selection.type === "door") return room?.doorLevel ?? null;
  return (
    state.buildings.find((building) => building.id === selection.buildingId)
      ?.level ?? null
  );
}

function refreshSelectionPanel(previous: GameSnapshot | null): void {
  if (
    currentView !== "game" ||
    app.querySelector("[data-build-panel]")?.classList.contains("hidden")
  )
    return;
  if (selectedTarget) {
    const before = selectionLevel(previous, selectedTarget);
    const after = selectionLevel(snapshot, selectedTarget);
    const previousPlayer = previous?.players.find(
      (player) => player.id === playerId,
    );
    const nextPlayer = snapshot?.players.find(
      (player) => player.id === playerId,
    );
    const previousDoor =
      selectedTarget.type === "door"
        ? previous?.rooms.find((room) => room.id === selectedTarget?.roomId)
            ?.doorHp
        : null;
    const nextDoor =
      selectedTarget.type === "door"
        ? snapshot?.rooms.find((room) => room.id === selectedTarget?.roomId)
            ?.doorHp
        : null;
    const doorDestroyed =
      selectedTarget.type === "door" &&
      Boolean(previousDoor && previousDoor > 0) !==
        Boolean(nextDoor && nextDoor > 0);
    if (selectedTarget.type === "building" && after === null) {
      closeBuildPanel();
      return;
    }
    if (
      previous === null ||
      before !== after ||
      previousPlayer?.drawCount !== nextPlayer?.drawCount ||
      doorDestroyed ||
      after === null
    )
      renderTargetPanel(selectedTarget);
    return;
  }
  if (!selectedTile || !snapshot) return;
  if (previous === null) {
    renderBuildPanel(selectedTile);
    return;
  }
  const occupied = snapshot.buildings.find(
    (building) =>
      building.tile.x === selectedTile?.x &&
      building.tile.y === selectedTile?.y,
  );
  if (occupied) {
    selectedTarget = {
      type: "building",
      targetId: occupied.id,
      buildingId: occupied.id,
      roomId: occupied.roomId,
    };
    selectedTile = null;
    renderTargetPanel(selectedTarget);
    return;
  }
  const me = snapshot.players.find((player) => player.id === playerId);
  setText("[data-owned-gold]", Math.floor(me?.gold ?? 0).toString());
  setText("[data-owned-power]", Math.floor(me?.power ?? 0).toString());
}

function closeBuildPanel(): void {
  buildPanelInputBlockedUntil = 0;
  selectedTile = null;
  selectedTarget = null;
  app.querySelector("[data-build-panel]")?.classList.add("hidden");
}

function movementLockedByIntro(): boolean {
  return (
    snapshot?.status === "RANKED_INTRO" ||
    snapshot?.status === "GHOST_INTRO" ||
    snapshot?.status === "EVENT_INTRO"
  );
}

function resetMovementForIntro(): void {
  inputVector = { x: 0, y: 0 };
  game?.setLocalInput(inputVector);
  if (pendingMovementTimer) window.clearTimeout(pendingMovementTimer);
  pendingMovementTimer = 0;
  if (movementKeepaliveTimer)
    window.clearInterval(movementKeepaliveTimer);
  movementKeepaliveTimer = 0;
  const knob = app.querySelector<HTMLElement>(".joystick-knob");
  if (knob) knob.style.transform = "";
}

function onPortraitMove(event: CustomEvent<Vec2>): void {
  if (movementLockedByIntro()) {
    resetMovementForIntro();
    return;
  }
  inputVector = event.detail;
  sendMovement(inputVector.x === 0 && inputVector.y === 0);
}

function setupJoystick(): void {
  const base = app.querySelector<HTMLElement>("[data-joystick]");
  const knob = base?.querySelector<HTMLElement>(".joystick-knob");
  if (!base || !knob) return;
  let pointerId = -1;
  const update = (event: PointerEvent): void => {
    if (movementLockedByIntro()) {
      resetMovementForIntro();
      return;
    }
    const rect = base.getBoundingClientRect();
    const radius = rect.width * 0.32;
    let dx = event.clientX - (rect.left + rect.width / 2);
    let dy = event.clientY - (rect.top + rect.height / 2);
    const magnitude = Math.hypot(dx, dy);
    if (magnitude > radius) {
      dx = (dx / magnitude) * radius;
      dy = (dy / magnitude) * radius;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const next = { x: dx / radius, y: dy / radius };
    inputVector = Math.hypot(next.x, next.y) < 0.06 ? { x: 0, y: 0 } : next;
    sendMovement();
  };
  base.addEventListener("pointerdown", (event) => {
    if (movementLockedByIntro()) {
      resetMovementForIntro();
      return;
    }
    pointerId = event.pointerId;
    base.setPointerCapture(pointerId);
    update(event);
  });
  base.addEventListener("pointermove", (event) => {
    if (event.pointerId === pointerId) update(event);
  });
  const release = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    pointerId = -1;
    knob.style.transform = "";
    inputVector = { x: 0, y: 0 };
    sendMovement(true);
  };
  base.addEventListener("pointerup", release);
  base.addEventListener("pointercancel", release);
}

function flushMovement(): void {
  pendingMovementTimer = 0;
  lastMovementSentAt = performance.now();
  const nextInputSequence = ++inputSequence;
  // Keep prediction tied to the exact input sent to the authoritative worker,
  // so a bot occupancy frame cannot be mistaken for a movement collision.
  game?.setLocalInput(inputVector, nextInputSequence);
  network?.move(inputVector.x, inputVector.y, nextInputSequence);
}

function syncMovementKeepalive(): void {
  const moving = Math.hypot(inputVector.x, inputVector.y) > 0.001;
  if (!moving) {
    if (movementKeepaliveTimer) window.clearInterval(movementKeepaliveTimer);
    movementKeepaliveTimer = 0;
    return;
  }
  if (movementKeepaliveTimer) return;
  // Touch devices do not keep emitting pointermove while a finger is held
  // still. Re-send the current intent so one dropped websocket frame cannot
  // leave the server at an old direction while local prediction keeps moving.
  movementKeepaliveTimer = window.setInterval(() => {
    if (Math.hypot(inputVector.x, inputVector.y) <= 0.001) {
      syncMovementKeepalive();
      return;
    }
    if (pendingMovementTimer) window.clearTimeout(pendingMovementTimer);
    pendingMovementTimer = 0;
    flushMovement();
  }, MOVEMENT_SEND_INTERVAL_MS);
}

function sendMovement(force = false): void {
  if (movementLockedByIntro()) {
    resetMovementForIntro();
    return;
  }
  game?.setLocalInput(inputVector);
  syncMovementKeepalive();
  if (force) {
    if (pendingMovementTimer) window.clearTimeout(pendingMovementTimer);
    flushMovement();
    return;
  }
  const elapsed = performance.now() - lastMovementSentAt;
  if (elapsed >= MOVEMENT_SEND_INTERVAL_MS) {
    if (pendingMovementTimer) window.clearTimeout(pendingMovementTimer);
    flushMovement();
    return;
  }
  if (!pendingMovementTimer) {
    pendingMovementTimer = window.setTimeout(
      flushMovement,
      MOVEMENT_SEND_INTERVAL_MS - elapsed,
    );
  }
}

function playEvents(events: GameEvent[]): void {
  const interesting = events.find((event) =>
    [
      "build",
      "building-remove",
      "upgrade",
      "turret-fire",
      "door-hit",
      "player-hit",
      "ghost-level-up",
      "ghost-retreat",
      "ghost-return",
      "ghost-skill",
      "item-draw",
      "item-drop",
      "item-pickup",
      "consumable-use",
      "elite-join",
      "lights-on",
      "victory",
      "defeat",
    ].includes(event.kind),
  );
  if (interesting) audio.play(interesting.kind);
  const elite = events.find((event) => event.kind === "elite-join");
  if (elite?.label) showEliteEntrance(elite.label);
  const death = events.find(
    (event) => event.kind === "death" && event.playerId,
  );
  if (death?.playerId) showDeathNotice(death.playerId);
  const consumable = events.find(
    (event) => event.kind === "consumable-use" && event.playerId === playerId,
  );
  if (consumable?.label) toast(`${consumable.label} 사용`);
  const levelUp = events.find((event) => event.kind === "ghost-level-up");
  if (levelUp)
    toast(
      `귀신이 문을 충분히 공격해 Lv.${levelUp.amount ?? "?"}로 성장했습니다!`,
    );
  const upgrade = events.find(
    (event) => event.kind === "upgrade" && event.playerId === playerId,
  );
  if (upgrade?.label) toast(`${upgrade.label} 업그레이드 완료`);
  const demolition = events.find(
    (event) =>
      event.kind === "building-remove" &&
      event.itemId === "demolition-cast" &&
      event.playerId === playerId,
  );
  if (demolition)
    toast("웃는 해체귀가 건물 하나를 철거했습니다.");
  const controlResistance = events.find(
    (event) =>
      event.kind === "ghost-skill" &&
      (event.itemId === "slow-resistance" ||
        event.itemId === "bind-resistance"),
  );
  if (controlResistance?.label)
    toast(`귀신의 ${controlResistance.label}이 올랐습니다.`);
  const lightsOn = events.find((event) => event.kind === "lights-on");
  if (lightsOn?.label) toast(lightsOn.label);
  if (
    events.some(
      (event) =>
        event.kind === "ghost-skill" &&
        event.label === TIME_ATTACK_EXPIRED_MESSAGE,
    )
  )
    showTimeAttackExpiredNotice();
  if (
    profile.vibration &&
    events.some(
      (event) => event.kind === "door-hit" || event.kind === "player-hit",
    )
  )
    navigator.vibrate?.(35);
}

function showTimeAttackExpiredNotice(): void {
  const notice = app.querySelector<HTMLElement>("[data-time-attack-expired]");
  if (!notice) return;
  notice.textContent = TIME_ATTACK_EXPIRED_MESSAGE;
  notice.classList.remove("hidden");
  window.requestAnimationFrame(() => notice.classList.add("show"));
  window.clearTimeout(timeAttackExpiredTimer);
  timeAttackExpiredTimer = window.setTimeout(() => {
    notice.classList.remove("show");
    window.setTimeout(() => notice.classList.add("hidden"), 220);
  }, 3_000);
}

const QUICK_CHAT_PHRASES: readonly QuickChatPhrase[] = [
  "문 위험!",
  "포탑 강화해!",
  "내가 끝낼게!",
  "좋은 아이템 발견!",
];

function showQuickChatPicker(): void {
  app.querySelector(".quick-chat-picker")?.remove();
  const picker = document.createElement("section");
  picker.className = "quick-chat-picker";
  picker.setAttribute("aria-label", "인게임 팀 채팅");
  picker.innerHTML = `<header><strong>팀 채팅</strong><button type="button" class="quick-chat-close" data-chat-close aria-label="채팅 닫기">×</button></header><form class="game-chat-form" data-game-chat-form><input data-game-chat-input maxlength="80" autocomplete="off" enterkeyhint="send" placeholder="메시지를 입력하세요" aria-label="팀 채팅 메시지"/><button type="submit">전송</button></form><div class="quick-chat-options" aria-label="빠른 문구">${QUICK_CHAT_PHRASES.map((phrase) => `<button type="button" data-quick-phrase="${escapeHtml(phrase)}">${escapeHtml(phrase)}</button>`).join("")}</div>`;
  app.appendChild(picker);
  picker
    .querySelector("[data-chat-close]")
    ?.addEventListener("click", () => picker.remove());
  picker
    .querySelector<HTMLFormElement>("[data-game-chat-form]")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input =
        picker.querySelector<HTMLInputElement>("[data-game-chat-input]");
      const message = input?.value.replace(/\s+/g, " ").trim() ?? "";
      if (!message) return;
      network?.gameChat(message.slice(0, 80));
      audio.play("button");
      picker.remove();
    });
  picker
    .querySelectorAll<HTMLButtonElement>("[data-quick-phrase]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const phrase = button.dataset.quickPhrase as QuickChatPhrase;
        if (!QUICK_CHAT_PHRASES.includes(phrase)) return;
        network?.quickChat(phrase);
        audio.play("button");
        picker.remove();
      }),
    );
  window.setTimeout(
    () =>
      picker
        .querySelector<HTMLInputElement>("[data-game-chat-input]")
        ?.focus(),
    0,
  );
}

function showQuickChatBubble(nickname: string, phrase: string): void {
  const existing = app.querySelector(".quick-chat-bubble");
  existing?.remove();
  const bubble = document.createElement("div");
  bubble.className = "quick-chat-bubble";
  bubble.innerHTML = `<strong>${escapeHtml(nickname)}</strong><span>${escapeHtml(phrase)}</span>`;
  app.appendChild(bubble);
  window.setTimeout(() => bubble.remove(), 2_600);
}

function showEliteEntrance(label: string): void {
  const existing = app.querySelector(".elite-entrance");
  existing?.remove();
  const entrance = document.createElement("div");
  entrance.className = "elite-entrance";
  entrance.innerHTML = `<i>✦</i><strong>${escapeHtml(label)}</strong><span>ELITE SURVIVOR</span>`;
  app.appendChild(entrance);
  window.setTimeout(() => entrance.classList.add("leaving"), 2_500);
  window.setTimeout(() => entrance.remove(), 3_200);
}

function showInventory(): void {
  if (!snapshot) return;
  const me = snapshot.players.find((player) => player.id === playerId);
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  const placedRewards = me
    ? snapshot.buildings.filter(
        (building) =>
          building.ownerId === me.id &&
          building.kind === "random-item" &&
          building.itemId,
      )
    : [];
  const legacyRewards = me?.items ?? [];
  const randomCards =
    placedRewards.length || legacyRewards.length
      ? [
          ...placedRewards.map((building) => {
            const item = getRandomItem(building.itemId ?? "");
            return item
              ? `<article class="item-card rarity-${item.rarity}"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.description)}</span><small>방에 설치됨 · ${item.rarity.toUpperCase()}</small></article>`
              : "";
          }),
          ...legacyRewards.map((owned) => {
            const item = getRandomItem(owned.itemId);
            return `<article class="item-card rarity-${owned.rarity}"><strong>${escapeHtml(owned.label)}${owned.count > 1 ? ` ×${owned.count}` : ""}</strong><span>${escapeHtml(item?.description ?? "")}</span><small>이전 보상 · ${owned.rarity.toUpperCase()}</small></article>`;
          }),
        ].join("")
      : '<p class="subtitle">랜덤 상자를 열면 결과물이 방 안에 설치됩니다.</p>';
  const supplies = me?.consumableLoadout
    .map((itemId) => {
      const item = shopConsumableById(itemId);
      if (!item) return "";
      const quantity =
        me.consumables.find((owned) => owned.itemId === itemId)?.quantity ?? 0;
      const used = me.usedConsumables.includes(itemId);
      const targetHint =
        item.target === "tile"
          ? "먼저 복도 타일을 선택하세요"
          : item.target === "building"
            ? "먼저 강화할 포탑을 선택하세요"
            : item.target === "door"
              ? "현재 방의 문에 사용"
              : item.target === "room"
                ? "현재 방에 사용"
                : "즉시 사용";
      return `<article class="item-card supply-item ${used ? "spent" : ""}"><i>${item.icon}</i><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.description)}</span><small>${targetHint} · ${used ? "이번 판 사용 완료" : `남은 재고 ${quantity}개`}</small><button ${used || quantity <= 0 ? "disabled" : ""} data-use-consumable="${item.id}">${used ? "사용 완료" : "사용"}</button></article>`;
    })
    .join("");
  modal.innerHTML = `<section class="panel inventory-panel"><span class="eyebrow">MATCH ITEMS · ${me?.drawCount ?? 0}/${me ? drawLimitForAppearance(me.appearance) : 4}</span><h2>이번 판 보상</h2>${supplies ? `<h3 class="inventory-subtitle">전술 보급</h3><div class="item-grid supply-item-grid">${supplies}</div>` : ""}<h3 class="inventory-subtitle">설치한 랜덤 보상</h3><div class="item-grid">${randomCards}</div><button class="btn primary" style="width:100%" data-close>닫기</button></section>`;
  app.appendChild(modal);
  modal
    .querySelector("[data-close]")
    ?.addEventListener("click", () => modal.remove());
  modal
    .querySelectorAll<HTMLButtonElement>("[data-use-consumable]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const itemId = button.dataset.useConsumable as ConsumableId;
        const item = shopConsumableById(itemId);
        if (!item || !me) return;
        let target: { roomId?: string; targetId?: string; tile?: Tile } = {};
        if (item.target === "tile") {
          if (!selectedTile) {
            toast("복도 타일을 먼저 선택한 뒤 사용하세요.");
            return;
          }
          target = { tile: selectedTile };
        } else if (item.target === "building") {
          if (!selectedTarget || selectedTarget.type !== "building") {
            toast("강화할 포탑을 먼저 선택하세요.");
            return;
          }
          target = { targetId: selectedTarget.targetId };
        } else if (item.target === "room" || item.target === "door") {
          if (!me.roomId) {
            toast("방을 점유한 뒤 사용할 수 있습니다.");
            return;
          }
          target = { roomId: me.roomId };
        }
        button.disabled = true;
        network?.useConsumable(itemId, target);
        audio.play("button");
        modal.remove();
      }),
    );
}

function updateConnection(
  state: "connecting" | "connected" | "reconnecting" | "closed",
  attempt: number,
): void {
  const overlay = app.querySelector<HTMLElement>("[data-connection]");
  const pill = app.querySelector<HTMLElement>("[data-network]");
  if (state === "connected") {
    overlay?.classList.add("hidden");
    pill?.classList.remove("bad");
  } else if (currentView === "game") {
    overlay?.classList.remove("hidden");
    setText(
      "[data-reconnect-copy]",
      state === "reconnecting"
        ? `재접속 시도 ${attempt} · 기존 캐릭터를 보존합니다.`
        : "연결이 종료되었습니다.",
    );
    pill?.classList.add("bad");
  }
}

function connectionOverlay(text: string): void {
  setContent(
    "connecting",
    loadingMarkup(text, "안전한 연결을 확인하고 있습니다."),
  );
}

function showSettings(): void {
  audio.play("button");
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  // Game screens provide a dedicated leave-game action. Logging out from this
  // modal can orphan that session, so account actions stay on menu settings.
  const isInGameSettings = currentView === "game";
  const leaveAction = network
    ? '<button class="btn danger settings-leave" data-leave-game data-testid="leave-game">게임 나가기</button>'
    : "";
  const logoutAction =
    account && !isInGameSettings
      ? '<button class="btn ghost settings-logout" data-logout-account>로그아웃</button>'
      : "";
  modal.innerHTML = `<section class="panel compact"><span class="eyebrow">SETTINGS</span><h2>게임 설정</h2><div class="setting-row"><span>배경음</span><button class="vibration-toggle ${profile.musicEnabled ? "on" : "off"}" type="button" aria-pressed="${profile.musicEnabled}" data-music-toggle>${profile.musicEnabled ? "켜짐" : "꺼짐"}</button></div><label class="setting-row"><span>배경음 음량</span><input type="range" min="0" max="1" step="0.05" value="${profile.musicVolume}" data-music-volume ${profile.musicEnabled ? "" : "disabled"}></label><label class="setting-row"><span>효과음 음량</span><input type="range" min="0" max="1" step="0.05" value="${profile.volume}" data-volume></label><div class="setting-row"><span>진동 피드백</span><button class="vibration-toggle ${profile.vibration ? "on" : "off"}" type="button" aria-pressed="${profile.vibration}" data-vibration>${profile.vibration ? "켜짐" : "꺼짐"}</button></div><p class="subtitle settings-note">실제 기기 식별 정보는 수집하지 않습니다. 브라우저에 생성한 임의 UUID만 재접속에 사용합니다.</p><div class="settings-actions">${leaveAction}${logoutAction}<button class="btn primary" data-close>완료</button></div></section>`;
  app.appendChild(modal);
  modal
    .querySelector<HTMLInputElement>("[data-music-volume]")
    ?.addEventListener("input", (event) => {
      profile.musicVolume = Number(
        (event.currentTarget as HTMLInputElement).value,
      );
      audio.setMusicVolume(profile.musicVolume);
      saveProfile(profile);
    });
  modal
    .querySelector<HTMLButtonElement>("[data-music-toggle]")
    ?.addEventListener("click", (event) => {
      profile.musicEnabled = !profile.musicEnabled;
      audio.setMusicMuted(!profile.musicEnabled);
      saveProfile(profile);
      const button = event.currentTarget as HTMLButtonElement;
      button.classList.toggle("on", profile.musicEnabled);
      button.classList.toggle("off", !profile.musicEnabled);
      button.setAttribute("aria-pressed", String(profile.musicEnabled));
      button.textContent = profile.musicEnabled ? "켜짐" : "꺼짐";
      const slider = modal.querySelector<HTMLInputElement>(
        "[data-music-volume]",
      );
      if (slider) slider.disabled = !profile.musicEnabled;
    });
  modal
    .querySelector<HTMLInputElement>("[data-volume]")
    ?.addEventListener("input", (event) => {
      profile.volume = Number((event.currentTarget as HTMLInputElement).value);
      audio.setVolume(profile.volume);
      saveProfile(profile);
    });
  modal
    .querySelector<HTMLButtonElement>("[data-vibration]")
    ?.addEventListener("click", (event) => {
      profile.vibration = !profile.vibration;
      if (!profile.vibration) navigator.vibrate?.(0);
      saveProfile(profile);
      const button = event.currentTarget as HTMLButtonElement;
      button.classList.toggle("on", profile.vibration);
      button.classList.toggle("off", !profile.vibration);
      button.setAttribute("aria-pressed", String(profile.vibration));
      button.textContent = profile.vibration ? "켜짐" : "꺼짐";
    });
  modal
    .querySelector<HTMLButtonElement>("[data-leave-game]")
    ?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      if (button.dataset.confirmed !== "true") {
        button.dataset.confirmed = "true";
        button.textContent = "한 번 더 누르면 나갑니다";
        window.setTimeout(() => {
          if (!button.isConnected) return;
          button.dataset.confirmed = "false";
          button.textContent = "게임 나가기";
        }, 2_500);
        return;
      }
      modal.remove();
      if (currentView === "lobby") network?.leaveRoom();
      else leaveCurrentGame();
    });
  modal
    .querySelector<HTMLButtonElement>("[data-logout-account]")
    ?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      button.textContent = "로그아웃 중…";
      void logoutAccount()
        .then(() => {
          const code = network?.code;
          network?.close();
          network = null;
          if (code) forgetRoom(code);
          destroyGame();
          snapshot = null;
          mapData = null;
          playerId = "";
          selectedTile = null;
          selectedTarget = null;
          inputVector = { x: 0, y: 0 };
          resultRecorded = false;
          profile.mustReauthenticate = true;
          saveProfile(profile);
          stopSocialRealtime();
          account = null;
          modal.remove();
          authScreen();
        })
        .catch((error: unknown) => {
          button.disabled = false;
          button.textContent = "로그아웃";
          toast(
            error instanceof Error ? error.message : "로그아웃하지 못했습니다.",
          );
        });
    });
  modal.querySelector("[data-close]")?.addEventListener("click", () => {
    audio.play("button");
    modal.remove();
  });
}

function formatUpdateDate(timestamp: number): string {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
  }).format(new Date(timestamp));
}

async function fetchAppUpdates(): Promise<AppUpdate[]> {
  const response = await fetch("/api/app-updates?limit=20", {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("업데이트 내역을 불러오지 못했습니다.");
  const data = (await response.json()) as { updates?: AppUpdate[] };
  return data.updates ?? [];
}

async function showAppUpdateHistory(): Promise<void> {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `<section class="panel compact app-update-history" role="dialog" aria-label="업데이트 내역"><span class="eyebrow">PATCH NOTES</span><h2>업데이트 내역</h2><p class="subtitle">현재 앱 버전 ${APP_RELEASE_VERSION}</p><div class="app-update-list"><p class="subtitle">불러오는 중…</p></div><button class="btn primary" data-close>닫기</button></section>`;
  app.appendChild(modal);
  modal
    .querySelector("[data-close]")
    ?.addEventListener("click", () => modal.remove());
  const list = modal.querySelector<HTMLElement>(".app-update-list");
  try {
    const updates = await fetchAppUpdates();
    if (!list || !modal.isConnected) return;
    list.innerHTML = updates.length
      ? updates
          .map(
            (update) =>
              `<article><header><strong>${escapeHtml(update.title)}</strong><small>${escapeHtml(update.version)} · ${escapeHtml(formatUpdateDate(update.publishedAt))}</small></header><p>${escapeHtml(update.summary)}</p></article>`,
          )
          .join("")
      : '<p class="subtitle">아직 등록된 업데이트 내역이 없습니다.</p>';
  } catch (error) {
    if (list && modal.isConnected)
      list.innerHTML = `<p class="subtitle">${escapeHtml(error instanceof Error ? error.message : "업데이트 내역을 불러오지 못했습니다.")}</p>`;
  }
}

function mailboxScopeLabel(scope: MailboxMessage["scope"]): string {
  if (scope === "reward") return "보상 우편";
  if (scope === "personal") return "개인 우편";
  return "서버 전체 우편";
}

function formatMailboxDate(timestamp: number): string {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
  }).format(new Date(timestamp));
}

async function fetchMailbox(): Promise<{
  messages: MailboxMessage[];
  unreadCount: number;
}> {
  const response = await fetch("/api/mailbox", { cache: "no-store" });
  const data = (await response.json()) as {
    messages?: MailboxMessage[];
    unreadCount?: number;
    error?: string;
  };
  if (!response.ok)
    throw new Error(data.error ?? "우편함을 불러오지 못했습니다.");
  return {
    messages: data.messages ?? [],
    unreadCount: Math.max(0, data.unreadCount ?? 0),
  };
}

async function refreshMailboxUnreadCount(): Promise<void> {
  if (!account) return;
  try {
    const { unreadCount } = await fetchMailbox();
    mailboxUnreadCount = unreadCount;
    const badge = app.querySelector<HTMLElement>(".home-mail-unread");
    badge?.classList.toggle("visible", unreadCount > 0);
  } catch {
    // The mail badge is supplemental. An intermittent connection must not
    // block entry to the lobby or replace the current profile state.
  }
}

function mailboxItemsHtml(messages: MailboxMessage[]): string {
  if (!messages.length) {
    return '<p class="mailbox-empty">도착한 우편이 없습니다.<br/>새 소식과 보상은 이곳으로 도착합니다.</p>';
  }
  return messages
    .map((message) => {
      const unread = !message.readAt;
      const reward =
        message.rewardPoints > 0
          ? `<strong class="mailbox-reward">✦ ${message.rewardPoints.toLocaleString()} P</strong>`
          : "";
      const claim =
        message.rewardPoints > 0
          ? `<button class="mailbox-claim" data-mail-claim="${message.id}" ${message.claimedAt ? "disabled" : ""}>${message.claimedAt ? "수령 완료" : "보상 수령"}</button>`
          : "";
      return `<article class="mailbox-item ${unread ? "unread" : ""}"><button class="mailbox-message" data-mail-read="${message.id}"><span>${mailboxScopeLabel(message.scope)}</span><strong>${escapeHtml(message.subject)}</strong><p>${escapeHtml(message.body)}</p><small>${formatMailboxDate(message.createdAt)}</small></button><footer>${reward}${claim}</footer></article>`;
    })
    .join("");
}

async function showMailbox(): Promise<void> {
  const modal = dismissibleModal(
    `<section class="home-picker-sheet mailbox-sheet" role="dialog" aria-modal="true" aria-labelledby="mailbox-title"><header><div><small>MAILBOX</small><h2 id="mailbox-title">우편함</h2></div><button data-modal-close aria-label="닫기">×</button></header><p class="mailbox-intro">서버 전체 소식, 개인 우편, 수령 가능한 보상을 확인하세요.</p><div class="mailbox-list"><p class="subtitle">우편을 불러오는 중…</p></div></section>`,
    "home-picker-modal mailbox-modal",
  );
  const list = modal.querySelector<HTMLElement>(".mailbox-list");
  const loadMailbox = async (): Promise<void> => {
    try {
      const { messages, unreadCount } = await fetchMailbox();
      mailboxUnreadCount = unreadCount;
      if (!list || !modal.isConnected) return;
      list.innerHTML = mailboxItemsHtml(messages);
      list
        .querySelectorAll<HTMLButtonElement>("[data-mail-read]")
        .forEach((button) => {
          button.addEventListener("click", () => {
            const mailId = button.dataset.mailRead;
            if (!mailId) return;
            audio.play("button");
            button.disabled = true;
            void fetch(`/api/mailbox/${encodeURIComponent(mailId)}/read`, {
              method: "POST",
              headers: { "content-type": "application/json" },
            })
              .then((response) => {
                if (!response.ok)
                  throw new Error("우편을 읽음 처리하지 못했습니다.");
                return loadMailbox();
              })
              .then(refreshMailboxUnreadCount)
              .catch((error: unknown) => {
                toast(
                  error instanceof Error
                    ? error.message
                    : "우편을 읽음 처리하지 못했습니다.",
                );
                button.disabled = false;
              });
          });
        });
      list
        .querySelectorAll<HTMLButtonElement>("[data-mail-claim]")
        .forEach((button) => {
          button.addEventListener("click", () => {
            const mailId = button.dataset.mailClaim;
            if (!mailId) return;
            audio.play("button");
            button.disabled = true;
            button.textContent = "수령 중…";
            void fetch(`/api/mailbox/${encodeURIComponent(mailId)}/claim`, {
              method: "POST",
              headers: { "content-type": "application/json" },
            })
              .then(async (response) => {
                const data = (await response.json()) as {
                  profile?: AccountProfile;
                  error?: string;
                };
                if (!response.ok || !data.profile)
                  throw new Error(data.error ?? "보상을 수령하지 못했습니다.");
                account = data.profile;
                toast("보상을 수령했습니다.");
                await loadMailbox();
                await refreshMailboxUnreadCount();
              })
              .catch((error: unknown) => {
                toast(
                  error instanceof Error
                    ? error.message
                    : "보상을 수령하지 못했습니다.",
                );
                button.disabled = false;
                button.textContent = "보상 수령";
              });
          });
        });
    } catch (error) {
      if (list && modal.isConnected)
        list.innerHTML = `<p class="mailbox-empty">${escapeHtml(error instanceof Error ? error.message : "우편함을 불러오지 못했습니다.")}</p>`;
    }
  };
  await loadMailbox();
  await refreshMailboxUnreadCount();
}

async function fetchSocialSnapshot(): Promise<SocialSnapshot> {
  const response = await fetch("/api/social", { cache: "no-store" });
  const data = (await response.json()) as SocialSnapshot & { error?: string };
  if (!response.ok)
    throw new Error(data.error ?? "친구 목록을 불러오지 못했습니다.");
  return data;
}

async function refreshSocialUnreadCount(): Promise<void> {
  if (!account) return;
  try {
    const response = await fetch("/api/social/summary", { cache: "no-store" });
    const data = (await response.json()) as { unreadCount?: number };
    if (!response.ok) return;
    socialUnreadCount = Math.max(0, data.unreadCount ?? 0);
    const badge = app.querySelector<HTMLElement>(".home-social-unread");
    badge?.classList.toggle("visible", socialUnreadCount > 0);
  } catch {
    // Social alerts are supplemental and must never block the game home.
  }
}

function stopSocialRealtime(): void {
  if (socialReconnectTimer) window.clearTimeout(socialReconnectTimer);
  socialReconnectTimer = 0;
  socialSocket?.close(1000, "social paused");
  socialSocket = null;
  socialModalRealtimeRefresh = null;
}

function startSocialRealtime(): void {
  if (!account || socialSocket || socialReconnectTimer) return;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/api/social/ws`);
  socialSocket = socket;
  socket.addEventListener("message", (message) => {
    void refreshSocialUnreadCount();
    try {
      const event = JSON.parse(String(message.data)) as SocialRealtimeEvent;
      if (event.type !== "ready") socialModalRealtimeRefresh?.(event);
    } catch {
      // Keep the unread badge working with an older or malformed push payload.
    }
  });
  socket.addEventListener("close", () => {
    if (socialSocket !== socket) return;
    socialSocket = null;
    if (!account) return;
    socialReconnectTimer = window.setTimeout(() => {
      socialReconnectTimer = 0;
      startSocialRealtime();
    }, 2_000);
  });
}

function socialAvatarMarkup(person: SocialPerson, compact = false): string {
  const avatar = person.avatarUrl ?? DEFAULT_PROFILE_AVATAR;
  return `<img class="social-avatar ${compact ? "compact" : ""}" src="${escapeHtml(avatar)}" alt="${escapeHtml(person.nickname)} 프로필 사진"/>`;
}

function socialPersonCard(
  person: SocialPerson,
  actions: string,
  detail = "친구",
): string {
  return `<article class="social-person-card"><div>${socialAvatarMarkup(person)}<span><strong>${escapeHtml(person.nickname)}</strong><small>${escapeHtml(rankLabel(person.rank))} · ${escapeHtml(detail)}</small></span></div><footer>${actions}</footer></article>`;
}

async function socialPost(
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok)
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : "요청을 처리하지 못했습니다.",
    );
  return data;
}

async function joinRoomFromInvite(roomCode: string): Promise<void> {
  const room = await getRoomStatus(roomCode);
  if (!isJoinableRoom(room.status))
    throw new Error("이미 시작되었거나 종료된 방입니다.");
  profile.recentRoomCode = roomCode;
  saveProfile(profile);
  connectionOverlay("친구 방에 연결하는 중…");
  connectToRoom(roomCode, false);
}

async function showSocialConversation(
  modal: HTMLElement,
  person: SocialPerson,
  returnToHub: () => Promise<void>,
  setLiveLoader: (
    conversation: { accountId: string; load: () => Promise<void> } | null,
  ) => void,
): Promise<void> {
  const messagePanel = modal.querySelector<HTMLElement>(
    "[data-social-content]",
  );
  if (!messagePanel) return;
  messagePanel.innerHTML = `<div class="social-chat-heading"><button class="btn ghost" data-social-back>‹</button>${socialAvatarMarkup(person, true)}<div><strong>${escapeHtml(person.nickname)}</strong><small>친구와의 대화</small></div></div><div class="social-message-list"><p class="subtitle">대화를 불러오는 중…</p></div><form class="social-message-form"><input maxlength="200" autocomplete="off" placeholder="메시지 입력"/><button type="submit">전송</button></form>`;
  const list = messagePanel.querySelector<HTMLElement>(".social-message-list");
  const load = async (): Promise<void> => {
    const response = await fetch(
      `/api/social/messages/${encodeURIComponent(person.accountId)}`,
      { cache: "no-store" },
    );
    const data = (await response.json()) as {
      messages?: DirectMessage[];
      error?: string;
    };
    if (!response.ok)
      throw new Error(data.error ?? "대화를 불러오지 못했습니다.");
    const messages = data.messages ?? [];
    if (list) {
      list.innerHTML = messages.length
        ? messages
            .map(
              (message) =>
                `<p class="social-message ${message.senderAccountId === account?.id ? "mine" : ""}">${escapeHtml(message.body)}</p>`,
            )
            .join("")
        : '<p class="social-empty">아직 대화가 없습니다.<br/>친구에게 먼저 인사해보세요.</p>';
      list.scrollTop = list.scrollHeight;
    }
    await refreshSocialUnreadCount();
  };
  setLiveLoader({ accountId: person.accountId, load });
  modal.querySelector("[data-social-back]")?.addEventListener("click", () => {
    setLiveLoader(null);
    void returnToHub();
  });
  messagePanel
    .querySelector<HTMLFormElement>(".social-message-form")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const input = form.querySelector<HTMLInputElement>("input");
      const text = input?.value.trim() ?? "";
      if (!text) return;
      const submit = form.querySelector<HTMLButtonElement>("button");
      if (submit) submit.disabled = true;
      void socialPost(
        `/api/social/messages/${encodeURIComponent(person.accountId)}`,
        { body: text },
      )
        .then(() => {
          if (input) input.value = "";
          return load();
        })
        .catch((error: unknown) =>
          toast(
            error instanceof Error
              ? error.message
              : "메시지를 보내지 못했습니다.",
          ),
        )
        .finally(() => {
          if (submit) submit.disabled = false;
        });
    });
  try {
    await load();
  } catch (error) {
    if (list)
      list.innerHTML = `<p class="social-empty">${escapeHtml(error instanceof Error ? error.message : "대화를 불러오지 못했습니다.")}</p>`;
  }
}

async function showSocialHub(
  initialTab: "friends" | "chat" | "invites" = "friends",
  inviteRoomCode?: string,
): Promise<void> {
  app.querySelector(".social-modal")?.remove();
  const modal = dismissibleModal(
    `<section class="home-picker-sheet social-sheet" role="dialog" aria-modal="true" aria-labelledby="social-title"><header><div><small>SOCIAL</small><h2 id="social-title">친구와 채팅</h2></div><button data-modal-close aria-label="닫기">×</button></header><nav class="social-tabs"><button data-social-tab="friends">친구</button><button data-social-tab="chat">채팅</button><button data-social-tab="invites">초대</button></nav><div data-social-content><p class="social-empty">불러오는 중…</p></div></section>`,
    "home-picker-modal social-modal",
  );
  let activeTab = initialTab;
  let social: SocialSnapshot;
  let liveConversation: {
    accountId: string;
    load: () => Promise<void>;
  } | null = null;
  let liveRefreshRunning = false;
  let queuedLiveEvent: SocialRealtimeEvent | null = null;
  const content = modal.querySelector<HTMLElement>("[data-social-content]");
  const reload = async (): Promise<void> => {
    social = await fetchSocialSnapshot();
    await refreshSocialUnreadCount();
  };
  const render = async (): Promise<void> => {
    if (!content) return;
    liveConversation = null;
    modal
      .querySelectorAll<HTMLButtonElement>("[data-social-tab]")
      .forEach((button) =>
        button.classList.toggle(
          "active",
          button.dataset.socialTab === activeTab,
        ),
      );
    if (activeTab === "friends") {
      const requests = social.requests.filter(
        (request) => request.direction === "incoming",
      );
      const sentRequests = social.requests.filter(
        (request) => request.direction === "outgoing",
      );
      const requestHtml = requests.length
        ? `<section class="social-section"><h3>받은 친구 요청</h3>${requests.map((request) => socialPersonCard(request, `<button data-social-friend="accept" data-social-id="${request.accountId}">수락</button><button class="ghost" data-social-friend="decline" data-social-id="${request.accountId}">거절</button>`, "친구 요청")).join("")}</section>`
        : "";
      const sentHtml = sentRequests.length
        ? `<section class="social-section"><h3>보낸 친구 요청</h3>${sentRequests.map((request) => socialPersonCard(request, `<button class="ghost" data-social-friend="decline" data-social-id="${request.accountId}">요청 취소</button>`, "수락 대기 중")).join("")}</section>`
        : "";
      content.innerHTML = `<section class="social-code"><span>내 친구 코드</span><strong>${escapeHtml(social.friendCode)}</strong><button data-social-copy>복사</button></section><form class="social-add-form"><input maxlength="11" autocomplete="off" placeholder="FD-1234ABCD"/><button type="submit">친구 추가</button></form>${requestHtml}${sentHtml}<section class="social-section"><h3>친구 ${social.friends.length}/100</h3>${social.friends.length ? social.friends.map((friend) => socialPersonCard(friend, `<button data-social-chat="${friend.accountId}">채팅</button>${inviteRoomCode ? `<button data-social-invite="${friend.accountId}">초대</button>` : ""}<button class="ghost" data-social-friend="remove" data-social-id="${friend.accountId}">삭제</button>`)).join("") : '<p class="social-empty">아직 친구가 없습니다.<br/>친구 코드로 함께할 사람을 추가하세요.</p>'}</section>`;
      content
        .querySelector("[data-social-copy]")
        ?.addEventListener("click", () => {
          void navigator.clipboard?.writeText(social.friendCode);
          toast("친구 코드를 복사했습니다.");
        });
      content
        .querySelector<HTMLFormElement>(".social-add-form")
        ?.addEventListener("submit", (event) => {
          event.preventDefault();
          const form = event.currentTarget as HTMLFormElement;
          const input = form.querySelector<HTMLInputElement>("input");
          const friendCode = input?.value ?? "";
          void socialPost("/api/social/friends/request", { friendCode })
            .then(async () => {
              toast("친구 요청을 보냈습니다.");
              await reload();
              await render();
            })
            .catch((error: unknown) =>
              toast(
                error instanceof Error
                  ? error.message
                  : "친구 요청을 보내지 못했습니다.",
              ),
            );
        });
    } else if (activeTab === "chat") {
      const byId = new Map(
        social.conversations.map((conversation) => [
          conversation.accountId,
          conversation,
        ]),
      );
      content.innerHTML = `<section class="social-section social-conversations"><h3>친구와의 대화</h3>${
        social.friends.length
          ? social.friends
              .map((friend) => {
                const conversation = byId.get(friend.accountId);
                return `<button class="social-conversation" data-social-chat="${friend.accountId}">${socialAvatarMarkup(friend, true)}<span><strong>${escapeHtml(friend.nickname)}</strong><small>${escapeHtml(conversation?.lastMessage?.body ?? "새 대화를 시작하세요.")}</small></span>${conversation?.unreadCount ? `<b>${conversation.unreadCount}</b>` : ""}</button>`;
              })
              .join("")
          : '<p class="social-empty">친구를 추가하면 대화를 시작할 수 있습니다.</p>'
      }</section>`;
    } else {
      content.innerHTML = `<section class="social-section"><h3>받은 방 초대</h3>${social.invites.length ? social.invites.map((invite: SocialInvite) => socialPersonCard(invite, `<button data-social-invite-action="accept" data-social-invite-id="${invite.id}">수락</button><button class="ghost" data-social-invite-action="decline" data-social-invite-id="${invite.id}">거절</button>`, `방 초대 · ${invite.roomCode}`)).join("") : '<p class="social-empty">받은 방 초대가 없습니다.</p>'}</section>`;
    }
    content
      .querySelectorAll<HTMLButtonElement>("[data-social-chat]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          const person = social.friends.find(
            (friend) => friend.accountId === button.dataset.socialChat,
          );
          if (person)
            void showSocialConversation(
              modal,
              person,
              async () => {
                await reload();
                await render();
              },
              (conversation) => {
                liveConversation = conversation;
              },
            );
        }),
      );
    content
      .querySelectorAll<HTMLButtonElement>("[data-social-friend]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          const action = button.dataset.socialFriend;
          const id = button.dataset.socialId;
          if (!action || !id) return;
          void socialPost(
            `/api/social/friends/${encodeURIComponent(id)}/${action}`,
          )
            .then(async () => {
              await reload();
              await render();
            })
            .catch((error: unknown) =>
              toast(
                error instanceof Error
                  ? error.message
                  : "친구 요청을 처리하지 못했습니다.",
              ),
            );
        }),
      );
    content
      .querySelectorAll<HTMLButtonElement>("[data-social-invite]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          if (!inviteRoomCode) return;
          const recipientId = button.dataset.socialInvite;
          if (!recipientId) return;
          void socialPost("/api/social/invites", {
            recipientId,
            roomCode: inviteRoomCode,
          })
            .then(() => toast("친구에게 방 초대를 보냈습니다."))
            .catch((error: unknown) =>
              toast(
                error instanceof Error
                  ? error.message
                  : "방 초대를 보내지 못했습니다.",
              ),
            );
        }),
      );
    content
      .querySelectorAll<HTMLButtonElement>("[data-social-invite-action]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          const id = button.dataset.socialInviteId;
          const action = button.dataset.socialInviteAction;
          if (!id || !action) return;
          void socialPost(
            `/api/social/invites/${encodeURIComponent(id)}/${action}`,
          )
            .then(async (data) => {
              if (action === "accept" && typeof data.roomCode === "string") {
                modal.remove();
                await joinRoomFromInvite(data.roomCode);
                return;
              }
              await reload();
              await render();
            })
            .catch((error: unknown) =>
              toast(
                error instanceof Error
                  ? error.message
                  : "방 초대를 처리하지 못했습니다.",
              ),
            );
        }),
      );
  };
  const refreshVisibleSocial = async (
    event: SocialRealtimeEvent,
  ): Promise<void> => {
    if (!modal.isConnected) {
      if (socialModalRealtimeRefresh === scheduleLiveRefresh)
        socialModalRealtimeRefresh = null;
      return;
    }
    if (
      liveConversation &&
      event.type === "message" &&
      event.fromAccountId === liveConversation.accountId
    ) {
      await liveConversation.load();
      return;
    }
    await reload();
    if (!liveConversation) await render();
  };
  const scheduleLiveRefresh = (event: SocialRealtimeEvent): void => {
    if (liveRefreshRunning) {
      queuedLiveEvent = event;
      return;
    }
    liveRefreshRunning = true;
    void (async () => {
      let nextEvent = event;
      do {
        queuedLiveEvent = null;
        await refreshVisibleSocial(nextEvent);
        nextEvent = queuedLiveEvent ?? {};
      } while (queuedLiveEvent && modal.isConnected);
    })()
      .catch(() => undefined)
      .finally(() => {
        liveRefreshRunning = false;
      });
  };
  socialModalRealtimeRefresh = scheduleLiveRefresh;
  modal
    .querySelectorAll<HTMLButtonElement>("[data-social-tab]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        liveConversation = null;
        activeTab = button.dataset.socialTab as typeof activeTab;
        void render();
      }),
    );
  try {
    await reload();
    await render();
  } catch (error) {
    if (content)
      content.innerHTML = `<p class="social-empty">${escapeHtml(error instanceof Error ? error.message : "친구 목록을 불러오지 못했습니다.")}</p>`;
  }
}

function showForceRefreshPrompt(): void {
  const modal = dismissibleModal(
    `<section class="panel compact force-refresh-sheet" role="dialog" aria-modal="true" aria-labelledby="force-refresh-title"><h2 id="force-refresh-title">강력 새로고침</h2><p class="subtitle">저장된 앱 캐시와 서비스 워커를 새로 설정한 뒤 최신 버전으로 다시 엽니다.</p><div class="force-refresh-actions"><button class="btn ghost" data-force-refresh-cancel>취소</button><button class="btn primary" data-force-refresh-confirm>새로고침</button></div></section>`,
    "force-refresh-modal",
  );
  modal
    .querySelector<HTMLButtonElement>("[data-force-refresh-confirm]")
    ?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      button.textContent = "최신 버전 불러오는 중…";
      void forceRefreshForUpdate(APP_RELEASE_VERSION, { resetWorker: true });
    });
  modal
    .querySelector<HTMLButtonElement>("[data-force-refresh-cancel]")
    ?.addEventListener("click", () => modal.remove());
}

async function forceRefreshForUpdate(
  version: string,
  options: { resetWorker?: boolean } = {},
): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if ("serviceWorker" in navigator) {
    tasks.push(
      navigator.serviceWorker
        .getRegistrations()
        .then(async (registrations) => {
          await Promise.all(
            registrations.map((registration) => registration.update().catch(() => undefined)),
          );
          if (options.resetWorker)
            await Promise.all(
              registrations.map((registration) => registration.unregister().catch(() => false)),
            );
        }),
    );
  }
  if ("caches" in window) {
    tasks.push(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key)))),
    );
  }
  await Promise.allSettled(tasks);
  const next = new URL(location.href);
  next.searchParams.set("app-update", version);
  if (options.resetWorker)
    next.searchParams.set("force-refresh", `${Date.now()}`);
  location.replace(next.toString());
}

async function checkForAppUpdate(): Promise<void> {
  if (testShellMode || updatePromptOpen) return;
  try {
    const response = await fetch("/api/app-updates/latest", {
      cache: "no-store",
    });
    if (!response.ok) return;
    const data = (await response.json()) as { latest?: AppUpdate | null };
    const latest = data.latest;
    if (!latest || !isUpdateAvailable(APP_RELEASE_VERSION, latest.version))
      return;
    updatePromptOpen = true;
    const modal = document.createElement("div");
    modal.className = "modal-backdrop app-update-available";
    modal.innerHTML = `<section class="panel compact" role="dialog" aria-modal="true" aria-label="새 업데이트"><span class="eyebrow">NEW UPDATE</span><h2>최신 업데이트가 있습니다</h2><p class="subtitle">${escapeHtml(latest.title)}</p><p class="app-update-summary">${escapeHtml(latest.summary)}</p><small>현재 ${APP_RELEASE_VERSION} · 최신 ${escapeHtml(latest.version)}</small><button class="btn primary" data-refresh-update>확인하고 새로고침</button></section>`;
    app.appendChild(modal);
    modal
      .querySelector<HTMLButtonElement>("[data-refresh-update]")
      ?.addEventListener("click", (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        button.disabled = true;
        button.textContent = "업데이트 적용 중…";
        void forceRefreshForUpdate(latest.version);
      });
  } catch {
    // Update checks are advisory. A temporary offline response must never
    // interrupt opening, login, or an in-progress game.
  }
}

function leaveCurrentGame(): void {
  const code = network?.code;
  network?.close();
  network = null;
  if (code) forgetRoom(code);
  destroyGame();
  snapshot = null;
  mapData = null;
  playerId = "";
  selectedTile = null;
  selectedTarget = null;
  inputVector = { x: 0, y: 0 };
  resultRecorded = false;
  homeScreen();
}

function exitRoomToMenu(message: string): void {
  const code = network?.code;
  network?.close();
  network = null;
  if (code) forgetRoom(code);
  destroyGame();
  snapshot = null;
  mapData = null;
  playerId = "";
  selectedTile = null;
  selectedTarget = null;
  inputVector = { x: 0, y: 0 };
  resultRecorded = false;
  homeScreen();
  toast(message);
}

function toast(message: string): void {
  const element = app.querySelector<HTMLElement>("#toast");
  if (!element) return;
  element.textContent = message;
  element.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => element.classList.remove("show"), 2_300);
}

function showDeathNotice(deadPlayerId: string): void {
  const player = snapshot?.players.find(
    (candidate) => candidate.id === deadPlayerId,
  );
  const name = player?.nickname ?? "생존자";
  app.querySelector(".death-notice")?.remove();
  window.clearTimeout(deathNoticeTimer);
  const notice = document.createElement("div");
  notice.className = "death-notice";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  notice.textContent = `${name}님이 사망했습니다`;
  app.appendChild(notice);
  requestAnimationFrame(() => notice.classList.add("show"));
  deathNoticeTimer = window.setTimeout(() => {
    notice.classList.remove("show");
    window.setTimeout(() => notice.remove(), 260);
  }, 2_200);
}

function setText(selector: string, value: string): void {
  const element = app.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

function destroyGame(): void {
  window.removeEventListener(
    "dorm:tile-selected",
    onTileSelected as EventListener,
  );
  window.removeEventListener(
    "dorm:target-selected",
    onTargetSelected as EventListener,
  );
  window.removeEventListener(
    "dorm:building-drag-start",
    onBuildingDragStart as EventListener,
  );
  window.removeEventListener(
    "dorm:building-move",
    onBuildingMove as EventListener,
  );
  window.removeEventListener(
    "dorm:portrait-move",
    onPortraitMove as EventListener,
  );
  if (pendingMovementTimer) window.clearTimeout(pendingMovementTimer);
  if (countdownWarningTimer) window.clearTimeout(countdownWarningTimer);
  pendingMovementTimer = 0;
  countdownWarningTimer = 0;
  previousGameStatus = null;
  inputVector = { x: 0, y: 0 };
  syncMovementKeepalive();
  game?.destroy();
  game = null;
}

function updateTestApi(): void {
  window.__DORM_TEST__ = {
    snapshot,
    map: mapData,
    playerId,
    move: (dx, dy) => {
      inputVector = { x: dx, y: dy };
      sendMovement(Math.hypot(dx, dy) <= 0.001);
    },
    interact: () => {
      inputVector = { x: 0, y: 0 };
      sendMovement(true);
      network?.interact();
    },
    buildFirst: (kind) => {
      if (!snapshot || !mapData || !network) return false;
      const me = snapshot.players.find((player) => player.id === playerId);
      const room = mapData.rooms.find(
        (candidate) => candidate.id === me?.roomId,
      );
      const tile = room?.buildTiles.find(
        (candidate) =>
          !snapshot?.buildings.some(
            (building) =>
              building.tile.x === candidate.x &&
              building.tile.y === candidate.y,
          ),
      );
      if (!me?.roomId || !tile) return false;
      network.build(me.roomId, tile, kind);
      return true;
    },
    disconnect: () => network?.close(),
    cameraMode: () => game?.getCameraMode() ?? "none",
    cameraZoom: () => game?.getCameraZoom() ?? 1,
    cameraYaw: () => game?.getCameraYaw() ?? 0,
    renderedPosition: () => game?.getLocalRenderedPosition() ?? null,
    performanceStats: () => game?.getPerformanceStats() ?? null,
    stressVisuals: () => {
      // Freeze the live stream before injecting a deterministic visual-only
      // load. The hook is exposed only by the dev/automation test API.
      network?.close();
      return game?.injectVisualStressScenario() ?? 0;
    },
    resumeRendering: () => game?.resume(),
  };
}

document.addEventListener("pointerdown", () => audio.unlock(), { once: true });
document.addEventListener("visibilitychange", () => {
  audio.setPageVisible(!document.hidden);
  if (!game) return;
  if (document.hidden) game.pause();
  else {
    game.resume();
    network?.resync();
  }
});
if ("serviceWorker" in navigator && !devMode)
  window.addEventListener(
    "load",
    () => void navigator.serviceWorker.register("/sw.js"),
  );

loading();
void checkForAppUpdate();
window.setTimeout(() => {
  const mobile =
    matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  if (!devMode && !mobile) desktopNotice();
  else openingTeaser(() => void resumeOrEnter());
}, 350);

async function resumeOrEnter(): Promise<void> {
  if (profile.mustReauthenticate) {
    authScreen();
    return;
  }
  try {
    account = await getAccount();
    homePlayMode = account.selectedPlayMode;
    profile.nickname = account.nickname;
    saveProfile(profile);
  } catch {
    authScreen();
    return;
  }
  const code = profile.recentRoomCode;
  if (
    freshMode ||
    !/^[A-Z2-9]{8}$/.test(code) ||
    !profile.reconnectTokens[code]
  ) {
    homeScreen();
    return;
  }
  try {
    const room = await getRoomStatus(code);
    if (!isResumableRoom(room.status)) throw new Error("ended");
    connectToRoom(code, false);
  } catch {
    forgetRoom(code);
    homeScreen();
  }
}
