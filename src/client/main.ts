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
  characterTraitForMatch,
  drawLimitForMatch,
  upgradeCostForTrait,
} from "../shared/characterTraits";
import { turretSkinTrait } from "../shared/turretSkinTraits";
import {
  GHOST_ORB_DRAW_TABLE,
  GHOST_ORB_CASH_COST,
  GHOST_ORB_PACKAGE_COST,
  GHOST_ORB_PITY_DRAWS,
  ghostOrbEligibleCosmetics,
  MOONLIT_PHANTOM_PACKAGE_ID,
  MOONLIT_PHANTOM_SKIN_ID,
  STARLIT_CLOUD_RABBIT_PACKAGE_ID,
  STARLIT_CLOUD_RABBIT_SKIN_ID,
  ABYSSAL_KNIGHT_GORILLA_PACKAGE_ID,
  ABYSSAL_KNIGHT_GORILLA_SKIN_ID,
  PRESTIGE_ACCESSORIES,
  type PrestigeAccessoryCategory,
  prestigeEmoteById,
} from "../shared/prestige";
import { CASH_STORE_PRODUCTS, cashGrantAmount, firstCashPurchaseBonus, type StoreProductId } from "../shared/storeProducts";
import {
  PRESENTATION_CATALOG,
  presentationById,
  presentationsForCategory,
  type PresentationCategory,
} from "../shared/presentation";
import { isPlayerUnderGhostAttack } from "../shared/combatPresentation";
import {
  characterAvailable,
  cosmeticAvailable,
  cosmeticById,
  cosmeticVisibleInPointShop,
  cosmeticsForSlot,
  customizationReward,
  CYBERPUNK_LASER_TURRET_SKIN_ID,
  CYBERPUNK_NEON_TILE_SKIN_ID,
  DEFAULT_TILE_SKIN_ID,
  LIFEGUARD_PARASOL_TURRET_SKIN_ID,
  SPECIAL_OPS_TRACKER_TURRET_SKIN_ID,
  defaultSkinForCharacter,
  SURFER_WATER_TURRET_SKIN_ID,
  tileSkinTextureUrl,
  turretSkinAssetUrl,
  type CosmeticDefinition,
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
import {
  isRankedTurretKind,
  rankedSeasonRules,
  rankedSeasonRuleSummary,
} from "../shared/rankedRules";
import { stageThemeFor } from "../shared/stageThemes";
import {
  APP_RELEASE_VERSION,
  isUpdateAvailable,
  type AppUpdate,
} from "../shared/appUpdates";
import type {
  EventMissionOverview,
  EventMissionPeriod,
  EventMissionProgress,
} from "../shared/eventMissions";
import type { AttendanceRewardProgress } from '../shared/attendanceRewards';
import {
  buildForceRefreshUrl,
  isStaleDynamicImportError,
} from "./pwaRefresh";
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
  PromotionCampaignId,
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
  SocialInviteMode,
  SocialPerson,
  SocialSnapshot,
} from "../shared/social";
import { SynthAudio, type BackgroundTrack } from "./audio";
import {
  checkNicknameAvailability,
  dismissPromotion,
  drawGhostOrbs,
  exchangePrestigeAccessory,
  equipCosmetic,
  exchangePrestigePackage,
  getAccount,
  getEventMissions,
  grantDevelopmentCash,
  claimEventMissions,
  claimAttendanceDay,
  redeemAttendanceSkin,
  claimMatchReward,
  loginAccount,
  logoutAccount,
  purchaseAdFree,
  purchaseCosmetic,
  purchaseConsumable,
  purchasePresentation,
  claimRandomBoxRefill,
  registerAccount,
  setProfileAvatar,
  setPrestigeLoadout,
  setProfileDisplayMode,
  setNickname,
  setSelectedPlayMode,
} from "./auth";
import {
  cameraZoomLockedForSnapshot,
  ThreeGameView,
  type SceneSelection,
} from "./game/ThreeGameView";
import { AvatarPreview3D, type AvatarView } from "./game/AvatarPreview3D";
import { AvatarPreview2D } from "./game/AvatarPreview2D";
import { homePoseAsset, homePoseKey } from "./game/HomePoseAssets";
import { baseConceptUrl, skinConceptUrl } from "./game/SkinAssets";
import { hydrateCatalogArt } from "./game/CatalogThumbnail3D";
import {
  GameNetwork,
  reconcileMovementInputSequence,
  shouldFlushMovementStart,
} from "./network";
import { loadProfile, saveProfile } from "./storage";
import { setupMobileViewportCompatibility } from "./viewport";
import {
  completeGoogleSignup,
  signInWithGoogle,
  signOutGoogle,
} from "./native/googleAuth";
import { appleLoginAvailable, completeAppleSignup, signInWithApple } from "./native/appleAuth";
import { initializeNativeRuntime, isNativeApp } from "./native";
import { loadStoreProducts, purchaseStoreProduct } from "./native/purchases";
import {
  prepareStageClearReward,
  showRandomBoxReward,
  showStageClearReward,
} from "./native/admob";
import { nativeApiResourceUrl, nativeWebSocketUrlSync } from "./native/runtime";
import type { HideSeekExperienceHandle } from "./hideSeek";
import { matchMissionPanelVisibility } from "./matchMissionPanel";
import "./styles.css";
import "./arcade-polish.css";
import "./hide-seek-entry.css";
import "./attendance-and-match-missions.css";
import "./prestige-preview-fixes.css";

initializeNativeRuntime();
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
let hideSeekExperience: HideSeekExperienceHandle | null = null;
let hideSeekPreviewStylesLoaded = false;
let customAvatarPreview: AvatarPreview2D | AvatarPreview3D | null = null;
let snapshot: GameSnapshot | null = null;
let mapData: MapDefinition | null = null;
let playerId = "";
const openingMinimapTrails = new Map<string, Vec2[]>();
let openingMinimapMapKey = "";
let openingMinimapStaticLayer: HTMLCanvasElement | null = null;
let openingMinimapStaticLayerKey = "";
let previousGameStatus: GameStatus | null = null;
let countdownWarningTimer = 0;
let account: AccountProfile | null = null;

function syncAccountRandomBoxes(next: GameSnapshot, localPlayerId: string): void {
  if (!account || !localPlayerId) return;
  const remaining = next.players.find((player) => player.id === localPlayerId)?.randomBoxesRemaining;
  if (!Number.isFinite(remaining) || account.randomBoxes.remaining === remaining) return;
  account = {
    ...account,
    randomBoxes: {
      ...account.randomBoxes,
      remaining: Math.max(0, Math.floor(remaining ?? 0)),
    },
  };
}
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
let announcementUnread = false;
let socialUnreadCount = 0;
let eventMissionOverviewCache: EventMissionOverview | null = null;
let matchMissionsCollapsed = false;
let matchMissionsHidden = false;
let matchMissionRenderKey = "";
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
const POLICE_ENFORCER_CROCO_SKIN_ID = "skin-look-crocodile-police-enforcer";
const SECRET_AGENT_MONKEY_SKIN_ID = "skin-look-monkey-secret-agent";
let skinLaunchPromoShownForAccountId: string | null = null;
let hideSeekLaunchGuideStep: "home-mode" | "hide-seek-option" | null = null;
let staleBundleRefreshStarted = false;
type HomePlayMode = PlayMode | "ranked";
let homePlayMode: HomePlayMode = "solo";
const homeStageSelection: Partial<Record<PlayMode, StageId>> = {};
let selectedTile: Tile | null = null;
let selectedTarget: SceneSelection | null = null;
let soulVialTargetingId: string | null = null;
let consumableTurretTargetingId: ConsumableId | null = null;
let consumableTileTargetingId: ConsumableId | null = null;
const optimisticPowerPanelModes = new Map<
  string,
  "attack" | "defense" | "production"
>();

function reconcileOptimisticPowerPanelModes(next: GameSnapshot): void {
  for (const [buildingId, mode] of optimisticPowerPanelModes) {
    const building = next.buildings.find(
      (candidate) => candidate.id === buildingId,
    );
    if (!building || building.powerPanelMode === mode)
      optimisticPowerPanelModes.delete(buildingId);
  }
}
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
let supplyShopReturnView: "home" | "lobby" = "home";
let inputSequence = 0;
let inputVector: Vec2 = { x: 0, y: 0 };
let lastMovementSentAt = 0;
let pendingMovementTimer = 0;
let movementKeepaliveTimer = 0;
let lastSentMovementActive = false;
let quickChatCleanup: (() => void) | null = null;
let tileSelectionBlockedUntil = 0;
let buildPanelInputBlockedUntil = 0;
const pendingActions = new Map<string, number>();
let ping = 0;
let resultRecorded = false;
let toastTimer = 0;
let timeAttackExpiredTimer = 0;
let deathNoticeTimer = 0;
let rankedQueuePollTimer = 0;
let rankedQueueClockTimer = 0;
let rankedQueueElapsedAnchor = 0;
let rankedQueueElapsedAnchorAt = 0;
const e2eMode = new URLSearchParams(location.search).get("e2e") === "1";
const automationMode =
  new URLSearchParams(location.search).get("automation") === "1";
const testShellMode = e2eMode || automationMode;
const uiPreviewMode = testShellMode
  ? new URLSearchParams(location.search).get("ui-preview")
  : null;
const devMode = new URLSearchParams(location.search).get("dev") === "1";
const freshMode = new URLSearchParams(location.search).get("fresh") === "1";
let updatePromptOpen = false;
// Prediction runs locally; a 12.5Hz intent stream is enough for the server
// and avoids flooding an unstable mobile network with pointer-move packets.
const MOVEMENT_SEND_INTERVAL_MS = 80;
const MOVEMENT_KEEPALIVE_INTERVAL_MS = 500;
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
const ROOM_SINGLETON_BUILD_KINDS = new Set<BuildingKind>([
  "range-amplifier",
  "power-panel",
]);

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
  "ghost-lure-beacon": "◎",
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
const DEFAULT_PROFILE_AVATAR = `/assets/ui/default-profile-v2.webp?v=${APP_RELEASE_VERSION}`;
const profileAvatarSource = (
  avatarUrl: string | null | undefined,
): string => nativeApiResourceUrl(avatarUrl || DEFAULT_PROFILE_AVATAR);
const profileFrameAssetUrl = (profileFrameId?: string | null): string => {
  switch (profileFrameId) {
    case 'profile-frame-moonlit-phantom-fox': return '/assets/profile-images/moonlit-phantom-frame.png';
    case 'profile-frame-starlit-cloud-rabbit': return '/assets/profile-images/starlit-cloud-frame.webp?v=prestige-v2';
    case 'profile-frame-abyssal-knight-gorilla': return '/assets/profile-images/abyssal-knight-frame.webp?v=prestige-v2';
    case 'profile-frame-basic': return '/assets/profile-images/basic-profile-frame.svg';
    default: return '/assets/profile-images/basic-profile-frame.svg';
  }
};
const profileAvatarHtml = (
  avatarUrl: string | null | undefined,
  className = "player-face profile-avatar",
  profileFrameId?: string | null,
): string =>
  `<span class="profile-avatar-frame-shell ${profileFrameId === 'profile-frame-moonlit-phantom-fox' ? 'moonlit' : ''}"><img class="${className}" src="${escapeHtml(profileAvatarSource(avatarUrl))}" alt="" /><img class="profile-avatar-frame-art" src="${profileFrameAssetUrl(profileFrameId)}" alt=""/></span>`;
const playerPortraitHtml = (player: PlayerState): string =>
  // The same default profile artwork is used everywhere.  Falling back to a
  // character face in-game made the lobby/home identity appear to change.
  profileAvatarHtml(player.profileAvatarUrl, 'player-face profile-avatar', player.profileFrameId);

function compactWalletAmount(value: number): string {
  const safe = Math.max(0, Math.floor(value));
  if (safe < 1_000) return safe.toLocaleString();
  const compact = (divisor: number, suffix: string): string => {
    const scaled = safe / divisor;
    const digits = scaled < 100 ? 1 : 0;
    return `${scaled.toFixed(digits).replace(/\.0$/, '')}${suffix}`;
  };
  if (safe < 1_000_000) return compact(1_000, 'K');
  if (safe < 1_000_000_000) return compact(1_000_000, 'M');
  return compact(1_000_000_000, 'B');
}

function backgroundTrackForView(view: string): BackgroundTrack | null {
  if (view === "game") return "ingame";
  if (
    view === "home" ||
    view === "shop" ||
    view === "orb-shop" ||
    view === "orb-exchange" ||
    view === "cash-shop" ||
    view === "room-menu" ||
    view === "lobby" ||
    view === "ranked-queue" ||
    view === "events" ||
    view === "missions" ||
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
      "커스텀 포인트는 게임을 클리어하면 얻는 영구 재화입니다.",
    image: "/assets/tutorial/rewards-points-guide.webp",
    imageAlt: "침대, 코인, 전기 구슬과 보상 상자가 있는 익명 방",
    steps: [
      {
        title: "클리어 보상",
        description:
          "승리하면 스테이지에 따라 80P부터 최대 500P까지 받습니다.",
      },
      {
        title: "사용처",
        description:
          "포인트로 캐릭터·완성형 스킨을 영구 구매하고, 전술 보급품은 수량 단위로 구매합니다.",
      },
    ],
  },
  ranked: {
    label: "랭크전",
    eyebrow: "RANKED CONTRACT",
    title: "4주 시즌 랭크전",
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
          "첫 5판은 RP 변동 폭이 큰 배치전입니다. 14개 계약 중 상위 8개 기록으로 시즌 순위를 정하며, 시즌은 4주마다 집계와 보상 후 초기화됩니다.",
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
  label?: string,
): string {
  return `<button class="${className}" data-page-guide data-guide-topic="${topic}" aria-label="${TUTORIALS[topic].title} 도움말">${guideIconMarkup()}${label ? `<span class="home-quick-label">${label}</span>` : ""}</button>`;
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
  if (!view.startsWith("hide-seek") && hideSeekExperience) {
    hideSeekExperience.destroy();
    hideSeekExperience = null;
  }
  if (view !== "ranked-queue") {
    stopRankedQueueTimers();
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
  return `<main class="boot-screen"><img class="boot-scene-art" src="/assets/cinematic/arcade-stage-loading-v1.webp" alt="" aria-hidden="true" fetchpriority="high" decoding="sync" /><div class="boot-backdrop" aria-hidden="true"></div><header class="boot-brand"><i aria-hidden="true">☾</i><span><small>MIDNIGHT WARD</small><b>심야 병동</b></span></header><section class="boot-status" role="status"><div class="boot-ward-signal" aria-hidden="true"><i></i><i></i><i></i><b>7</b></div><div class="boot-status-copy"><small>WARD CONNECTION</small><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div><div class="boot-progress" aria-hidden="true"><i></i></div><div class="boot-progress-dots" aria-hidden="true"><i></i><i></i><i></i></div></section></main>`;
}

function desktopNotice(): void {
  setContent(
    "desktop",
    `<main class="screen"><section class="panel compact desktop-card"><div class="desktop-icon">📱</div><span class="eyebrow">MOBILE ONLY</span><h2>모바일 전용 게임입니다</h2><p class="subtitle">휴대폰 브라우저에서 세로 또는 가로 모드로 플레이하세요. 개발 환경에서는 주소 끝에 <strong>?dev=1</strong>을 붙일 수 있습니다.</p></section></main>`,
  );
}

function openingMarkup(): string {
  return `<main class="opening-teaser"><div class="teaser-film"></div><header class="teaser-brand"><i aria-hidden="true">☾</i><span>MIDNIGHT WARD</span></header><section class="teaser-title"><span class="eyebrow">A CUTE HORROR ARCADE</span><h1>불이 꺼지면<br/>생존이 시작된다</h1><p data-teaser-copy>문이 닫히기 전에, 살아남을 방을 찾아라.</p></section><button class="teaser-skip" data-teaser-skip><span>건너뛰기</span><i aria-hidden="true">›</i></button><div class="teaser-progress"><i></i></div></main>`;
}

function openingTeaser(complete: () => void): void {
  if (testShellMode || profile.openingSeen) {
    complete();
    return;
  }
  currentView = "opening";
  audio.setBackgroundTrack(null);
  app.dataset.view = "opening";
  app.innerHTML = openingMarkup();
  const copy = app.querySelector<HTMLElement>("[data-teaser-copy]");
  const lines = [
    "문이 닫히기 전에, 살아남을 방을 찾아라.",
    "잠에 들면 방어가 시작된다.",
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

function homePoseMarkup(
  appearance: AvatarAppearance,
  className = 'home-pose-avatar',
  label = '앉아서 쉬다가 하품하는 내 캐릭터',
): string {
  const pose = homePoseAsset(appearance);
  return `<span class="${className}" role="img" aria-label="${escapeHtml(label)}" data-home-pose-skin="${homePoseKey(appearance)}" style="--home-pose-atlas:url('${pose.atlasUrl}');--home-pose-row:${pose.row};--home-pose-aspect:${pose.cellAspectRatio};--home-pose-columns:${pose.frameColumns}"></span>`;
}

function homeScreen(): void {
  if (!account) {
    authScreen();
    return;
  }
  // An unfinished first-match lesson is authoritative. Never expose the home
  // screen (and, consequently, launch promotions) until its match result has
  // been recorded for this account. This also recovers safely after a reload
  // during any tutorial step.
  if (!account.tutorialCompleted) {
    loading();
    window.setTimeout(() => void createRoom(true, "tutorial-1"), 0);
    return;
  }
  const currentAccount = account;
  const selectedNormalRank =
    homePlayMode === "multiplayer"
      ? currentAccount.multiplayerRank
      : currentAccount.soloRank;
  const profileDisplay = accountProfileDisplayInfo(currentAccount);
  const profileAvatar = profileAvatarSource(currentAccount.profileAvatarUrl);
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
  const homeBackground = presentationById(currentAccount.prestige.homeBackgroundId)
    ?? PRESTIGE_ACCESSORIES.find((item) => item.id === currentAccount.prestige.homeBackgroundId && item.category === 'background');
  const homeBackgroundStyle = homeBackground
    ? ` style="--home-background-image:url('${escapeHtml('backgroundUrl' in homeBackground && homeBackground.backgroundUrl ? homeBackground.backgroundUrl : homeBackground.imageUrl)}')"`
    : '';
  const equippedNameplate = presentationById(currentAccount.prestige.nameplateId)
    ?? PRESTIGE_ACCESSORIES.find((item) => item.id === currentAccount.prestige.nameplateId && item.category === 'nameplate');
  const homeNameplateStyle = equippedNameplate?.imageUrl
    ? ` style="--game-nameplate-image:url('${escapeHtml(releaseVersionedAsset(equippedNameplate.imageUrl))}')"`
    : '';
  const eventClaimable = (eventMissionOverviewCache?.claimableCount ?? 0) > 0;
  const attendanceClaimable = (eventMissionOverviewCache?.attendance.claimableCount ?? 0) > 0;
  const eventNeedsStart = eventMissionOverviewCache !== null && !eventMissionOverviewCache.hasProgress;
  setContent(
    "home",
    `<main class="game-home ${homeBackground ? 'has-equipped-home-background' : ''}"${homeBackgroundStyle}>
      <div class="home-atmosphere"></div>
      <header class="home-topbar">
        <button class="home-account in-game-label ${profileDisplay.className} ${currentAccount.prestige.profileFrameId === 'profile-frame-moonlit-phantom-fox' ? 'moonlit-profile-card' : ''}" data-profile-display-picker aria-haspopup="dialog" aria-label="프로필 설정">
          <div class="home-profile-photo"><img src="${escapeHtml(profileAvatar)}" alt="${escapeHtml(currentAccount.nickname)} 프로필 사진"/>${currentAccount.prestige.profileFrameId ? `<img class="profile-avatar-frame-art" src="${profileFrameAssetUrl(currentAccount.prestige.profileFrameId)}" alt=""/>` : ''}</div>
          <div><span>프로필 설정</span><strong>${escapeHtml(currentAccount.nickname)} <img class="home-inline-badge rank-badge" src="${profileDisplay.badgeUrl}" alt="${escapeHtml(profileDisplay.badgeAlt)}"/></strong><small style="font-weight: 900;">${escapeHtml(profileDisplay.labelText)}</small><em style="font-weight: 900;">인게임 라벨 · 변경</em></div>
        </button>
        <div class="home-utility">
          <div class="home-currency home-cash-wallet" title="보유 캐시 ${currentAccount.cash.toLocaleString()}">
            <button class="home-cash-add" type="button" data-cash-store aria-label="캐시 충전">＋</button>
            <button class="home-cash-balance" type="button" data-cash-store aria-label="캐시 상점 · 보유 캐시 ${currentAccount.cash.toLocaleString()}"><i aria-hidden="true">C</i><span>${compactWalletAmount(currentAccount.cash)}</span></button>
          </div>
          <strong class="home-points-wallet" title="보유 포인트 ${currentAccount.customPoints.toLocaleString()}">${gameMenuIcon("points")}<span>${compactWalletAmount(currentAccount.customPoints)} P</span></strong>
        </div>
      </header>
      <section class="home-stage-hub" aria-label="현재 스테이지">
        <button class="home-stage-summary" data-home-stage-picker aria-label="스테이지 난이도 선택" ${homePlayMode === "ranked" ? "disabled" : ""}><span>${homePlayMode === "ranked" ? "SEASON CONTRACT" : "NIGHT CHAPTER"}</span><strong>${stageLabel}</strong><small>${modeLabel} · ${homePlayMode === "ranked" ? `배치 ${Math.min(5, currentAccount.ranked.placementCompleted)}/5 · ${currentAccount.ranked.eligible ? "참가 가능" : "참가 조건 확인"}` : perk}</small><i>⌄</i></button>
        <div class="home-stage-route" aria-hidden="true"><i class="cleared"></i><i class="cleared"></i><i class="active"></i><i></i><i></i></div>
      </section>
      <div class="home-stage-menu" aria-label="홈 메뉴"><button class="home-stage-menu-trigger" data-home-stage-menu aria-label="메뉴 열기" aria-expanded="false"><span></span><span></span><span></span><b class="home-stage-menu-alert ${announcementUnread ? "visible" : ""}" data-announcement-alert aria-hidden="true"></b></button><div class="home-stage-menu-dropdown hidden" data-home-stage-menu-dropdown><button data-app-updates>${gameMenuIcon("announcement")}<span>공지사항</span><b class="home-stage-menu-alert ${announcementUnread ? "visible" : ""}" data-announcement-alert aria-hidden="true"></b></button><button data-home-settings>${homeUtilityIcon("settings")}<span>설정</span></button></div></div>
      <nav class="home-side-menu home-side-menu-left" aria-label="홈 왼쪽 메뉴">
        <button class="home-event-missions" data-event-missions data-event-section="attendance" aria-label="이벤트"><img class="home-event-fireworks" src="/assets/ui/events/birthday-fireworks.webp?v=${APP_RELEASE_VERSION}" alt=""/><span>이벤트</span><b class="home-event-alert ${attendanceClaimable ? "visible" : ""}" data-attendance-alert aria-hidden="true"></b></button>
        <button class="home-ad-free ${currentAccount.adFree.active ? "active" : ""}" data-ad-free aria-label="광고 제거">${gameMenuIcon("adfree")}<span>광고 제거</span></button>
        <button class="home-orb-shop" data-orb-shop aria-label="구슬 상점"><img src="/assets/ui/orb-shop/menu-icon.webp?v=${APP_RELEASE_VERSION}" alt=""/><span>구슬 상점</span></button>
      </nav>
      <nav class="home-side-menu home-side-menu-right" aria-label="홈 오른쪽 메뉴">
        <button class="home-ranking-shortcut" data-ranking aria-label="랭킹">${gameMenuIcon("ranking")}<span>랭킹</span></button>
        <button class="home-guide" data-page-guide data-guide-topic="battle" aria-label="생존 가이드 도움말">${gameMenuIcon("guide")}<span>가이드</span></button>
        <button class="home-event-missions" data-event-missions data-event-section="daily" aria-label="미션">${gameMenuIcon("event")}<span>미션</span><b class="home-event-alert ${eventClaimable ? "visible" : ""}" data-event-alert aria-hidden="true"></b><em class="home-event-nudge ${eventNeedsStart ? "visible" : ""}" data-event-nudge>미션을 진행해보세요</em></button>
      </nav>
      <section class="home-avatar-showcase" aria-label="병원 복도에 앉아 쉬는 내 캐릭터"><div class="home-avatar-model" data-home-avatar></div><strong class="home-character-nameplate game-nameplate ${currentAccount.prestige.nameplateId ?? 'nameplate-basic'}"${homeNameplateStyle}>${escapeHtml(currentAccount.nickname)}</strong></section>
      <footer class="home-actions">
        <div class="home-launch"><button class="home-mode-select ${hideSeekLaunchGuideStep === "home-mode" ? "launch-guide-target" : ""}" data-home-mode-picker aria-haspopup="dialog" aria-label="플레이 방식 ${modeLabel}"><span>${homePlayMode === "solo" ? "☾" : homePlayMode === "multiplayer" ? "◎" : "♛"}</span><div><small>플레이 방식</small><strong>${modeLabel}</strong></div><i>⌄</i></button><button class="game-start" data-stage-start data-testid="home-stage-start"><i>⚔</i><span>${homePlayMode === "ranked" ? "계약 시작" : "스테이지 시작"}</span></button></div>
        <nav class="home-footer-nav" aria-label="게임 메뉴"><button data-shop aria-label="상점">${homeFooterIcon("shop")}<span>상점</span></button><button class="home-social-tab" data-social aria-label="친구와 채팅">${homeFooterIcon("social")}<span>친구</span><b class="home-social-unread ${socialUnreadCount > 0 ? "visible" : ""}" aria-hidden="true"></b></button><button class="active" data-stage-menu aria-label="홈">${homeFooterIcon("stage")}<span>홈</span></button><button class="home-mailbox-tab" data-mailbox aria-label="우편함">${homeFooterIcon("mail")}<span>우편함</span><b class="home-mail-unread ${mailboxUnreadCount > 0 ? "visible" : ""}" aria-hidden="true"></b></button><button data-customize aria-label="커스텀 · 내 보관함">${homeFooterIcon("custom")}<span>보관함</span></button></nav>
      </footer>
    </main>`,
  );
  const avatarHost = app.querySelector<HTMLElement>("[data-home-avatar]");
  if (avatarHost) {
    avatarHost.innerHTML = homePoseMarkup(currentAccount.appearance);
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
      if (hideSeekLaunchGuideStep === "home-mode") {
        hideSeekLaunchGuideStep = "hide-seek-option";
        app.querySelector("[data-home-mode-picker]")?.classList.remove("launch-guide-target");
      }
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
  const stageMenuTrigger = app.querySelector<HTMLButtonElement>("[data-home-stage-menu]");
  const stageMenuDropdown = app.querySelector<HTMLElement>("[data-home-stage-menu-dropdown]");
  stageMenuTrigger?.addEventListener("click", () => {
    audio.play("button");
    const expanded = stageMenuDropdown?.classList.toggle("hidden") === false;
    stageMenuTrigger.setAttribute("aria-expanded", String(expanded));
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
  app.querySelectorAll<HTMLElement>("[data-event-missions]").forEach((button) => button.addEventListener("click", () => {
    audio.play("button");
    if (button.dataset.eventSection === 'attendance') void attendanceEventScreen();
    else void missionScreen('daily');
  }));
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
    showAdFreePurchase();
  });
  app.querySelector("[data-orb-shop]")?.addEventListener("click", () => {
    audio.play("button");
    ghostOrbShopScreen();
  });
  app.querySelectorAll("[data-cash-store]").forEach((button) => button.addEventListener("click", () => {
    audio.play("button");
    cashShopScreen();
  }));
  app.querySelectorAll("[data-app-updates]").forEach((button) => button.addEventListener("click", () => {
    audio.play("button");
    stageMenuDropdown?.classList.add("hidden");
    stageMenuTrigger?.setAttribute("aria-expanded", "false");
    void showAppUpdateHistory();
  }));
  app.querySelectorAll("[data-home-settings]").forEach((button) => button.addEventListener("click", () => {
    audio.play("button");
    stageMenuDropdown?.classList.add("hidden");
    stageMenuTrigger?.setAttribute("aria-expanded", "false");
    showSettings();
  }));
  void refreshMailboxUnreadCount();
  void refreshAnnouncementUnread();
  void refreshSocialUnreadCount();
  void refreshHomeEventMissionStatus();
  startSocialRealtime();
  showSkinLaunchPromoCarousel();
}

function cashPackPriceLabel(productId: string): string {
  const product = CASH_STORE_PRODUCTS.find((candidate) => candidate.id === productId);
  return product ? `₩${product.fallbackPriceKrw.toLocaleString()}` : '';
}

function showCashPurchaseConfirm(productId: StoreProductId, localizedPrice?: string): void {
  if (!account) return authScreen();
  const product = CASH_STORE_PRODUCTS.find((candidate) => candidate.id === productId);
  if (!product) return;
  const firstPurchase = !account.cashFirstPurchaseProductIds.includes(product.id);
  const grantedCash = cashGrantAmount(product, firstPurchase);
  const price = localizedPrice || cashPackPriceLabel(product.id);
  const purchasingInApp = isNativeApp;
  const modal = dismissibleModal(
    `<section class="cash-purchase-sheet" role="dialog" aria-modal="true" aria-labelledby="cash-purchase-title">
      <header><i aria-hidden="true">C</i><div><small>CASH CHARGE</small><h2 id="cash-purchase-title">캐시 ${product.cash.toLocaleString()}개</h2></div></header>
      <div class="cash-purchase-summary"><strong>${grantedCash.toLocaleString()} C</strong>${firstPurchase ? `<span>첫 구매 +20% · ${firstCashPurchaseBonus(product).toLocaleString()} 캐시 추가</span>` : '<span>첫 구매 보너스를 이미 받았습니다.</span>'}<small>${devMode ? '로컬 개발 환경에서는 테스트 캐시로 충전됩니다.' : purchasingInApp ? '스토어 결제와 서버 영수증 검증 후 지급됩니다.' : '캐시 결제는 Google Play·App Store 앱에서 이용할 수 있습니다.'}</small></div>
      <footer><button type="button" data-modal-close>취소</button><button type="button" class="confirm" data-cash-purchase ${!devMode && !purchasingInApp ? 'disabled' : ''}>${devMode ? '테스트 충전' : price}</button></footer>
    </section>`,
    'cash-purchase-modal',
  );
  modal.querySelector<HTMLButtonElement>('[data-cash-purchase]')?.addEventListener('click', (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.textContent = '처리 중…';
    const operation = devMode
      ? grantDevelopmentCash(product.id)
      : purchaseStoreProduct(product.id, account!.id).then(async (verification) => {
          if (verification.status !== 'verified') {
            throw new Error('결제 확인 중입니다. 검증이 완료되면 캐시가 자동 지급됩니다.');
          }
          return getAccount();
        });
    void operation.then((profile) => {
      account = profile;
      modal.remove();
      cashShopScreen();
      toast(`캐시 ${grantedCash.toLocaleString()}개가 충전되었습니다.${firstPurchase ? ' 첫 구매 +20%가 적용되었습니다.' : ''}`);
    }).catch((error) => {
      button.disabled = false;
      button.textContent = devMode ? '테스트 충전' : price;
      toast(error instanceof Error ? error.message : '캐시 결제를 완료하지 못했습니다.');
    });
  });
}

function cashShopScreen(): void {
  if (!account) return authScreen();
  const currentAccount = account;
  const cards = CASH_STORE_PRODUCTS.map((product, index) => {
    const firstPurchase = !currentAccount.cashFirstPurchaseProductIds.includes(product.id);
    const firstPurchaseGrant = cashGrantAmount(product, true);
    return `<button type="button" class="cash-pack-card ${index === 2 ? 'featured' : ''}" data-cash-pack="${product.id}">
    ${index === 2 ? '<b>BEST</b>' : ''}
    <span class="cash-pack-gem" aria-hidden="true"><i>C</i></span>
    <div><strong>${product.cash.toLocaleString()} 캐시</strong><small class="cash-first-purchase ${firstPurchase ? '' : 'claimed'}">${firstPurchase ? `첫 구매 +20% · ${firstPurchaseGrant.toLocaleString()} C` : '첫 구매 보너스 완료'}</small></div>
    <em data-cash-price="${product.id}">${cashPackPriceLabel(product.id)}</em>
  </button>`;
  }).join('');
  setContent('cash-shop', `<main class="cash-shop-screen">
    <div class="cash-shop-atmosphere" aria-hidden="true"></div>
    <header class="cash-shop-header"><button type="button" data-cash-shop-back aria-label="홈으로">‹</button><div><small>CASH SHOP</small><h2>캐시 상점</h2></div><strong><i>C</i>${currentAccount.cash.toLocaleString()}</strong></header>
    <section class="cash-shop-scroll"><div class="cash-shop-hero"><span>PREMIUM CURRENCY</span><h3>필요할 때 원하는 만큼 충전하세요</h3><p>캐시는 유료 상품 구매에 사용되며 포인트와 별도로 보관됩니다.</p></div><div class="cash-pack-grid">${cards}</div><p class="cash-store-note">${devMode ? '로컬 테스트 환경 · 실제 결제가 발생하지 않습니다.' : isNativeApp ? '가격과 결제 통화는 스토어 계정 국가를 기준으로 표시됩니다.' : '실제 충전은 Google Play·App Store 앱에서 이용할 수 있습니다.'}</p></section>
  </main>`);
  app.querySelector('[data-cash-shop-back]')?.addEventListener('click', homeScreen);
  app.querySelectorAll<HTMLButtonElement>('[data-cash-pack]').forEach((button) => button.addEventListener('click', () => {
    const productId = button.dataset.cashPack as StoreProductId | undefined;
    if (!productId) return;
    showCashPurchaseConfirm(productId, button.querySelector('[data-cash-price]')?.textContent ?? undefined);
  }));
  if (isNativeApp) {
    void loadStoreProducts().then((products) => {
      for (const product of products) {
        const price = app.querySelector<HTMLElement>(`[data-cash-price="${CSS.escape(product.identifier)}"]`);
        if (price && product.priceString) price.textContent = product.priceString;
      }
    }).catch(() => undefined);
  }
}

interface GhostOrbPreviewReward {
  kind: 'points' | 'orbs' | 'cosmetic' | 'duplicate';
  label: string;
  symbol: string;
  detail: string;
  itemId?: string;
  amount?: number;
  imageUrl?: string;
}

interface PrestigeExchangeContent {
  id: string;
  label: string;
  detail: string;
  imageUrl: string;
  imageFit?: 'contain' | 'cover';
}

const MOONLIT_PRESTIGE_CONTENTS: readonly PrestigeExchangeContent[] = [
  { id: 'profile', label: '프로필 이미지', detail: '월령 환영 여우', imageUrl: '/assets/profile-images/moonlit-phantom-fox.webp?v=prestige-v2', imageFit: 'cover' },
  { id: 'frame', label: '프로필 테두리', detail: '월령 여우불 테두리', imageUrl: '/assets/profile-images/moonlit-phantom-frame.png' },
  { id: 'emotes', label: '이모티콘 4종', detail: '월령 감정 표현 세트', imageUrl: '/assets/emotes/moonlit-phantom-fox/smug.webp', imageFit: 'cover' },
  { id: 'skin', label: '프레스티지 스킨', detail: '월령 환영 여우', imageUrl: '/assets/sprites/skins/skin-moonlit-phantom-fox/concept.webp?v=moonlit-prestige-v8', imageFit: 'contain' },
  { id: 'tile', label: '타일 스킨', detail: '월령 여우불 타일', imageUrl: '/assets/tiles/skin-moonlit-phantom/moonfire-tile.webp', imageFit: 'cover' },
  { id: 'turret', label: '포탑 스킨', detail: '월령 천호포', imageUrl: '/assets/turret-skins/skin-moonlit-foxfire/level-17.webp' },
] as const;

const MOONLIT_PRESTIGE_THEME = {
  id: MOONLIT_PHANTOM_PACKAGE_ID,
  available: true,
  title: '월령 환영 여우',
  subtitle: '달빛 아래 깨어난 첫 번째 프레스티지',
  abilities: [
    'Lv.17 포탑 해금',
    '포탑 피해 +150%',
    '포탑 Lv.6 시작',
    '랜덤상자 뽑기 +4회',
    '귀신 이동속도 -10%',
  ],
  iconUrl: '/assets/profile-images/moonlit-phantom-fox.webp?v=prestige-v2',
  heroUrl: '/assets/prestige/moonlit-phantom-fox/featured-package.webp',
  contents: MOONLIT_PRESTIGE_CONTENTS,
} as const;

const STARLIT_CLOUD_PRESTIGE_THEME = {
  id: STARLIT_CLOUD_RABBIT_PACKAGE_ID,
  available: true,
  title: '성운 구름무희 모모',
  subtitle: '별빛과 구름의 궤적을 지휘하는 천공 프레스티지',
  abilities: [
    'Lv.17 포탑 해금',
    '포탑 공격속도 +150%',
    '점유 중 초당 골드 +10',
    '점유 중 초당 전력 +5',
    '귀신 공격속도 -10%',
  ],
  iconUrl: '/assets/profile-images/starlit-cloud-rabbit.webp?v=prestige-v2',
  heroUrl: '/assets/prestige/starlit-cloud-rabbit/featured-package.png',
  contents: [
    { id: 'profile', label: '프로필 이미지', detail: '성운 구름무희 모모', imageUrl: '/assets/profile-images/starlit-cloud-rabbit.webp?v=prestige-v2', imageFit: 'cover' },
    { id: 'frame', label: '프로필 테두리', detail: '성운 프리즘 테두리', imageUrl: '/assets/profile-images/starlit-cloud-frame.webp?v=prestige-v2' },
    { id: 'emotes', label: '이모티콘 4종', detail: '천공 감정 표현 세트', imageUrl: '/assets/emotes/starlit-cloud-rabbit/cheer.webp?v=prestige-v2', imageFit: 'contain' },
    { id: 'skin', label: '프레스티지 스킨', detail: '성운 구름무희 모모', imageUrl: '/assets/sprites/skins/skin-starlit-cloud-rabbit/concept.webp?v=prestige-v3', imageFit: 'contain' },
    { id: 'tile', label: '타일 스킨', detail: '성운 구름무대 타일', imageUrl: '/assets/tiles/skin-starlit-cloud/starlit-cloud-tile.webp', imageFit: 'cover' },
    { id: 'turret', label: '포탑 스킨', detail: '성운 성좌포', imageUrl: '/assets/turret-skins/skin-starlit-cloud/level-17.webp?v=prestige-v2' },
  ] satisfies readonly PrestigeExchangeContent[],
} as const;

const ABYSSAL_KNIGHT_PRESTIGE_THEME = {
  id: ABYSSAL_KNIGHT_GORILLA_PACKAGE_ID,
  available: true,
  title: '심연 기사단장 콩',
  subtitle: '흑염 투구와 심연의 기사단을 이끄는 군단장',
  abilities: [
    'Lv.17 포탑 해금',
    '수리대·수리스킬 효과 2배',
    '문 HP 100% 방어막 2개',
    '귀신 HP -10%',
    '문 업그레이드 비용 -50%',
  ],
  iconUrl: '/assets/profile-images/abyssal-knight-gorilla.webp?v=prestige-v2',
  heroUrl: '/assets/prestige/abyssal-knight-gorilla/featured-package.webp',
  contents: [
    { id: 'profile', label: '프로필 이미지', detail: '심연 기사단장 콩', imageUrl: '/assets/profile-images/abyssal-knight-gorilla.webp?v=prestige-v2', imageFit: 'cover' },
    { id: 'frame', label: '프로필 테두리', detail: '흑염 군단 테두리', imageUrl: '/assets/profile-images/abyssal-knight-frame.webp?v=prestige-v2' },
    { id: 'emotes', label: '이모티콘 4종', detail: '심연 기사단 감정 표현', imageUrl: '/assets/emotes/abyssal-knight-gorilla/roar.webp?v=prestige-v2', imageFit: 'contain' },
    { id: 'skin', label: '프레스티지 스킨', detail: '심연 기사단장 콩', imageUrl: '/assets/sprites/skins/skin-abyssal-knight-gorilla/concept.webp?v=prestige-v3', imageFit: 'contain' },
    { id: 'tile', label: '타일 스킨', detail: '심연 기사단 타일', imageUrl: '/assets/tiles/skin-abyssal-knight/abyssal-knight-tile.webp', imageFit: 'cover' },
    { id: 'turret', label: '포탑 스킨', detail: '심연 군단포', imageUrl: '/assets/turret-skins/skin-abyssal-knight/level-17.webp?v=prestige-v2' },
  ] satisfies readonly PrestigeExchangeContent[],
} as const;

const PRESTIGE_EXCHANGE_THEMES = [MOONLIT_PRESTIGE_THEME, STARLIT_CLOUD_PRESTIGE_THEME, ABYSSAL_KNIGHT_PRESTIGE_THEME] as const;

function ghostOrbPreviewReward(): GhostOrbPreviewReward {
  const totalWeight = GHOST_ORB_DRAW_TABLE.reduce((sum, reward) => sum + reward.weight, 0);
  let roll = Math.random() * totalWeight;
  const selected = GHOST_ORB_DRAW_TABLE.find((reward) => {
    roll -= reward.weight;
    return roll <= 0;
  }) ?? GHOST_ORB_DRAW_TABLE[0];
  if (selected.kind === 'points') {
    return { kind: 'points', label: `${selected.amount.toLocaleString()} P`, symbol: '✦', detail: '커스텀 포인트' };
  }
  if (selected.kind === 'orbs') {
    return { kind: 'orbs', label: `귀신구슬 ${selected.amount}개`, symbol: '◉', detail: '프레스티지 교환 재료' };
  }
  const candidates = ghostOrbEligibleCosmetics().filter((item) => item.slot === selected.slot);
  const item = candidates[Math.floor(Math.random() * candidates.length)];
  return item
    ? { kind: 'cosmetic', itemId: item.id, label: item.label, symbol: item.symbol, detail: SHOP_SLOT_LABELS[item.slot as Exclude<ShopCatalogSlot, 'item'>] }
    : { kind: 'points', label: '100 P', symbol: '✦', detail: '커스텀 포인트' };
}

function ghostOrbRewardImageUrl(reward: GhostOrbPreviewReward): string {
  if (reward.kind === 'points') return '/assets/tutorial/rewards-points-guide.webp';
  if (reward.kind === 'orbs') return '/assets/ui/orb-shop/menu-icon.webp';
  const item = cosmeticById(reward.itemId ?? '');
  if (!item) return '/assets/ui/orb-shop/menu-icon.webp';
  if (item.slot === 'character') return baseConceptUrl(item.id);
  if (item.slot === 'skin') return skinConceptUrl(item.id) ?? baseConceptUrl(item.characterId ?? 'character-bunny');
  if (item.slot === 'tile') return tilePreviewUrl(item.id);
  if (item.slot === 'turret') return turretSkinAssetUrl(item.id, 1) ?? '/assets/buildings/cute-basic-turret-1.png';
  return '/assets/ui/orb-shop/menu-icon.webp';
}

function releaseVersionedAsset(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(APP_RELEASE_VERSION)}`;
}

const GHOST_ORB_SUMMON_VIDEO_URL = '/assets/ui/orb-shop/summon/open-capsule.mp4';
const GHOST_ORB_SUMMON_WEBM_URL = '/assets/ui/orb-shop/summon/open-capsule.webm';
// Keep this revision in the URL so an already-installed PWA cannot reuse the
// previous landscape/HEVC trailer from its media cache.
const MOONLIT_PRESTIGE_VIDEO_URL = '/assets/prestige/moonlit-phantom-fox/cinematic/moonlit-awakening.mp4?landscape=5';
const MOONLIT_PRESTIGE_WEBM_URL = '/assets/prestige/moonlit-phantom-fox/cinematic/moonlit-awakening.webm?landscape=5';
const STARLIT_CLOUD_PRESTIGE_VIDEO_URL = '/assets/prestige/starlit-cloud-rabbit/cinematic/starlit-cloud-awakening.mp4?revision=1';
const ABYSSAL_KNIGHT_PRESTIGE_VIDEO_URL = '/assets/prestige/abyssal-knight-gorilla/cinematic/abyssal-awakening.mp4?revision=1';
const PRESTIGE_CINEMATICS: Readonly<Record<string, {
  title: string;
  ariaLabel: string;
  mp4Url: string;
  webmUrl?: string;
  backdropUrl: string;
  themeClass: string;
}>> = {
  [MOONLIT_PHANTOM_PACKAGE_ID]: {
    title: '월령 환영 여우',
    ariaLabel: '초승달 풀숲에서 월령 환영 여우가 각성해 귀신들과 싸우는 애니메이션',
    mp4Url: MOONLIT_PRESTIGE_VIDEO_URL,
    webmUrl: MOONLIT_PRESTIGE_WEBM_URL,
    backdropUrl: '/assets/prestige/moonlit-phantom-fox/cinematic/moonlit-vertical-backdrop.png',
    themeClass: 'moonlit',
  },
  [STARLIT_CLOUD_RABBIT_PACKAGE_ID]: {
    title: '성운 구름무희 모모',
    ariaLabel: '별과 구름의 빛 속에서 성운 구름무희 모모가 각성하는 애니메이션',
    mp4Url: STARLIT_CLOUD_PRESTIGE_VIDEO_URL,
    backdropUrl: '/assets/prestige/starlit-cloud-rabbit/cinematic/starlit-cloud-vertical-backdrop.png',
    themeClass: 'starlit-cloud',
  },
  [ABYSSAL_KNIGHT_GORILLA_PACKAGE_ID]: {
    title: '심연 기사단장 콩',
    ariaLabel: '심연의 흑염 속에서 심연 기사단장 콩이 각성하는 애니메이션',
    mp4Url: ABYSSAL_KNIGHT_PRESTIGE_VIDEO_URL,
    backdropUrl: '/assets/prestige/abyssal-knight-gorilla/cinematic/abyssal-vertical-backdrop.jpg',
    themeClass: 'abyssal-knight',
  },
};
const PRESTIGE_LOCKER_PREVIEW_VIDEO_BY_SKIN: Readonly<Record<string, string>> = {
  [MOONLIT_PHANTOM_SKIN_ID]: '/assets/prestige/moonlit-phantom-fox/locker/prestige-fox-wait.mp4?revision=3',
  [STARLIT_CLOUD_RABBIT_SKIN_ID]: '/assets/prestige/starlit-cloud-rabbit/locker/prestige-rabbit-wait.mp4?revision=1',
  [ABYSSAL_KNIGHT_GORILLA_SKIN_ID]: '/assets/prestige/abyssal-knight-gorilla/locker/prestige-gorilla-wait.mp4?revision=2',
};
const PRESTIGE_LOCKER_PREVIEW_POSTER_BY_SKIN: Readonly<Record<string, string>> = {
  [MOONLIT_PHANTOM_SKIN_ID]: '/assets/prestige/moonlit-phantom-fox/locker/prestige-fox-wait-poster.png?revision=1',
  [STARLIT_CLOUD_RABBIT_SKIN_ID]: '/assets/prestige/starlit-cloud-rabbit/locker/prestige-rabbit-wait-poster.png?revision=1',
  [ABYSSAL_KNIGHT_GORILLA_SKIN_ID]: '/assets/prestige/abyssal-knight-gorilla/locker/prestige-gorilla-wait-poster.jpg?revision=2',
};
const PRESTIGE_LOCKER_PREVIEW_LABEL_BY_SKIN: Readonly<Record<string, string>> = {
  [MOONLIT_PHANTOM_SKIN_ID]: '월령 환영 여우',
  [STARLIT_CLOUD_RABBIT_SKIN_ID]: '성운 구름무희 모모',
  [ABYSSAL_KNIGHT_GORILLA_SKIN_ID]: '심연 기사단장 콩',
};

function prestigeLockerPreviewVideoUrl(skinId: string | undefined): string | null {
  if (!skinId) return null;
  const videoUrl = PRESTIGE_LOCKER_PREVIEW_VIDEO_BY_SKIN[skinId];
  return videoUrl ? releaseVersionedAsset(videoUrl) : null;
}

function prestigeLockerPreviewPosterUrl(skinId: string | undefined): string | null {
  if (!skinId) return null;
  const posterUrl = PRESTIGE_LOCKER_PREVIEW_POSTER_BY_SKIN[skinId];
  return posterUrl ? releaseVersionedAsset(posterUrl) : null;
}

function characterViewSwitchMarkup(): string {
  return '<div class="custom-view-switch" aria-label="캐릭터 보는 방향"><button class="active" data-avatar-view="front">앞</button><button data-avatar-view="side">옆</button><button data-avatar-view="back">뒤</button></div>';
}

function prestigeLockerPreviewVideoMarkup(videoUrl: string, posterUrl: string | null, label: string): string {
  const poster = posterUrl ? ` poster="${escapeHtml(posterUrl)}"` : '';
  const fallback = posterUrl
    ? `<img class="prestige-locker-preview-poster" src="${escapeHtml(posterUrl)}" alt="${escapeHtml(label)}" />`
    : '';
  // There is only one authored MP4 source per preview. Binding it directly to
  // the video element is more reliable than a nested <source> in iOS WebViews:
  // source children can remain at HAVE_NOTHING after an app-shell restore.
  return `${fallback}<video class="prestige-locker-preview-video" data-prestige-locker-video aria-label="${escapeHtml(label)} 대기 모션" src="${escapeHtml(videoUrl)}" autoplay loop muted playsinline preload="auto" disablepictureinpicture${poster}></video>`;
}

const prestigeLockerPreviewVideoCleanups = new WeakMap<HTMLVideoElement, () => void>();

function stopPrestigeLockerPreviewVideo(video: HTMLVideoElement): void {
  prestigeLockerPreviewVideoCleanups.get(video)?.();
}

function startPrestigeLockerPreviewVideo(video: HTMLVideoElement): void {
  // Shop and locker previews are passive UI, not cinematics. Keeping them
  // muted also lets iOS/Android WebViews autoplay the idle loop reliably.
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  stopPrestigeLockerPreviewVideo(video);

  const controller = new AbortController();
  let stopped = false;
  const observer = new MutationObserver(() => {
    if (!video.isConnected) cleanup();
  });
  const cleanup = (): void => {
    if (stopped) return;
    stopped = true;
    controller.abort();
    observer.disconnect();
    prestigeLockerPreviewVideoCleanups.delete(video);
  };
  prestigeLockerPreviewVideoCleanups.set(video, cleanup);

  const tryPlay = (): void => {
    if (!video.isConnected) {
      cleanup();
      return;
    }
    void video.play().catch(() => undefined);
  };
  const markReady = (): void => {
    video.classList.add("is-ready");
  };
  const resumeFromStart = (): void => {
    video.currentTime = 0;
    tryPlay();
  };
  const handleVisibilityChange = (): void => {
    if (!document.hidden) tryPlay();
  };

  video.addEventListener("canplay", tryPlay, { signal: controller.signal });
  video.addEventListener("ended", resumeFromStart, { signal: controller.signal });
  video.addEventListener("playing", () => {
    markReady();
  }, { signal: controller.signal });
  video.addEventListener("error", () => {
    video.classList.remove("is-ready");
    cleanup();
  }, { once: true, signal: controller.signal });
  // iOS WebView and low-power Safari can reject the first muted autoplay
  // attempt. The next user gesture resumes the same element without replacing
  // it, so the idle clip does not remain frozen on its poster frame.
  window.addEventListener("pointerdown", tryPlay, { capture: true, signal: controller.signal });
  window.addEventListener("touchend", tryPlay, { capture: true, signal: controller.signal });
  window.addEventListener("keydown", tryPlay, { capture: true, signal: controller.signal });
  document.addEventListener("visibilitychange", handleVisibilityChange, { signal: controller.signal });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  video.load();
  tryPlay();
}

function playCinematicVideo(
  video: HTMLVideoElement,
  onReady: () => void,
  onComplete: () => void,
): () => void {
  let stopped = false;
  const releaseAudio = audio.bindCinematicMedia(video);
  let sourceTimeout = 0;
  let activeSource = 0;
  const mp4Source = video.dataset.mp4Src;
  const webmSource = video.dataset.webmSrc;
  // Android WebView occasionally claims a WebM source and then never delivers
  // a frame. Prefer H.264/AAC, then explicitly retry the alternate encoding.
  const supportsMp4 = Boolean(video.canPlayType('video/mp4; codecs="avc1.640028, mp4a.40.2"'));
  const sources = (supportsMp4 ? [mp4Source, webmSource] : [webmSource, mp4Source])
    .filter((source): source is string => Boolean(source));
  const handleReady = (): void => {
    window.clearTimeout(sourceTimeout);
    if (!stopped) onReady();
  };
  const handleComplete = (): void => {
    window.clearTimeout(sourceTimeout);
    if (!stopped) onComplete();
  };
  let loadSource = (): void => undefined;
  const tryNextSource = (): void => {
    if (stopped) return;
    window.clearTimeout(sourceTimeout);
    activeSource += 1;
    if (activeSource >= sources.length) {
      handleComplete();
      return;
    }
    loadSource();
  };
  const playCurrentSource = (): void => {
    if (stopped) return;
    void video.play().catch(tryNextSource);
  };
  loadSource = (): void => {
    const source = sources[activeSource];
    if (!source) {
      handleComplete();
      return;
    }
    video.pause();
    video.src = source;
    video.load();
    // Some decoders neither reject play() nor emit an error. Avoid a permanent
    // loading screen and give the fallback encoding a chance to start.
    sourceTimeout = window.setTimeout(tryNextSource, 4_500);
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      playCurrentSource();
    } else {
      video.addEventListener('canplay', playCurrentSource, { once: true });
    }
  };
  video.addEventListener('playing', handleReady, { once: true });
  video.addEventListener('ended', handleComplete, { once: true });
  video.addEventListener('error', tryNextSource);
  loadSource();
  return () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(sourceTimeout);
    video.removeEventListener('playing', handleReady);
    video.removeEventListener('ended', handleComplete);
    video.removeEventListener('error', tryNextSource);
    video.pause();
    video.removeAttribute('src');
    video.load();
    releaseAudio();
  };
}

function ghostOrbRewardCardsMarkup(rewards: readonly GhostOrbPreviewReward[]): string {
  return rewards.map((reward, index) => {
    const imageUrl = reward.imageUrl ?? ghostOrbRewardImageUrl(reward);
    const badge = reward.kind === 'duplicate'
      ? '중복 전환'
      : reward.kind === 'cosmetic'
        ? 'NEW'
        : reward.kind === 'orbs'
          ? 'PRESTIGE'
          : 'POINT';
    return `<article class="orb-reward-shop-card reward-${reward.kind}" style="--result-index:${index}">
      <div class="orb-reward-shop-art"><img src="${escapeHtml(releaseVersionedAsset(imageUrl))}" alt="${escapeHtml(reward.label)}"/></div>
      <div class="orb-reward-shop-copy"><span>${escapeHtml(badge)}</span><strong>${escapeHtml(reward.label)}</strong><small>${escapeHtml(reward.detail)}</small></div>
    </article>`;
  }).join('');
}

function mappedGhostOrbDrawRewards(
  rewards: readonly import('./auth').GhostOrbDrawRewardResult[],
): GhostOrbPreviewReward[] {
  return rewards.map((reward) => ({
    kind: reward.kind,
    amount: reward.amount,
    itemId: reward.itemId,
    label: reward.label,
    symbol: reward.symbol,
    detail: reward.detail,
  }));
}

function showGhostOrbSummonAnimation(
  rewards: readonly GhostOrbPreviewReward[],
  resultMessage: string,
  onClose?: () => void,
  drawAgainCount?: 1 | 10,
): void {
  const overlay = document.createElement('div');
  overlay.className = 'orb-gacha-overlay';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  overlay.innerHTML = `<section class="orb-gacha-cinematic" role="dialog" aria-modal="true" aria-label="귀신구슬 뽑기 연출" tabindex="0">
    <video class="orb-gacha-animation" aria-label="귀신구슬 소환함이 열리는 애니메이션" playsinline preload="auto" data-mp4-src="${releaseVersionedAsset(GHOST_ORB_SUMMON_VIDEO_URL)}" data-webm-src="${releaseVersionedAsset(GHOST_ORB_SUMMON_WEBM_URL)}"></video>
    <div class="orb-summon-loader"><span></span><small>소환함을 깨우는 중</small></div>
    <div class="orb-gacha-copy"><small>MOONLIGHT SUMMON</small><strong>달빛이 영혼을 깨웁니다</strong></div>
    <p class="orb-gacha-tap-hint">화면을 누르면 건너뜁니다</p>
    <div class="orb-gacha-results" data-orb-gacha-results></div>
  </section>`;
  document.body.appendChild(overlay);
  overlay.querySelector<HTMLElement>('.orb-gacha-cinematic')?.focus();
  const resultHost = overlay.querySelector<HTMLElement>('[data-orb-gacha-results]');
  const video = overlay.querySelector<HTMLVideoElement>('.orb-gacha-animation');
  let revealed = false;
  let skipArmed = false;
  window.setTimeout(() => { skipArmed = true; }, 320);
  let stopAnimation = (): void => undefined;
  const close = (): void => {
    stopAnimation();
    audio.setBackgroundTrack('main');
    overlay.remove();
    onClose?.();
  };
  const renderResults = (
    visibleRewards: readonly GhostOrbPreviewReward[],
    message: string,
  ): void => {
    if (!resultHost) return;
    resultHost.innerHTML = `<section class="orb-draw-result-sheet" data-orb-draw-result-sheet><header><small>SUMMON RESULT</small><strong>${visibleRewards.length}개 보상 획득</strong></header><div class="orb-reward-shop-list">${ghostOrbRewardCardsMarkup(visibleRewards)}</div><p>${escapeHtml(message)}</p><footer><button type="button" class="orb-gacha-confirm" data-orb-gacha-close>확인</button>${drawAgainCount ? `<button type="button" class="orb-gacha-draw-again" data-orb-draw-again>${drawAgainCount}회 더 뽑기</button>` : ''}</footer><div class="orb-draw-result-loading" data-orb-draw-loading hidden><span></span><strong>보상 확인 중</strong></div></section>`;
    resultHost.querySelector('[data-orb-gacha-close]')?.addEventListener('click', close);
    let drawAgainPending = false;
    resultHost.querySelector<HTMLButtonElement>('[data-orb-draw-again]')?.addEventListener('click', (event) => {
      if (!drawAgainCount || drawAgainPending) return;
      const button = event.currentTarget as HTMLButtonElement;
      const cashCost = GHOST_ORB_CASH_COST * drawAgainCount;
      // Re-draw keeps its no-animation fast path when the wallet can pay, but
      // it must never make a silent request when the displayed wallet is
      // short. Use the exact same purchase sheet as the first draw instead.
      if (!account || account.cash < cashCost) {
        showGhostOrbPurchaseConfirm(drawAgainCount, { onOpenCashShop: close, host: overlay });
        return;
      }
      const sheet = resultHost.querySelector<HTMLElement>('[data-orb-draw-result-sheet]');
      const loading = resultHost.querySelector<HTMLElement>('[data-orb-draw-loading]');
      drawAgainPending = true;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = `${drawAgainCount}회 보상 확인 중…`;
      sheet?.classList.add('is-loading');
      loading?.removeAttribute('hidden');
      resultHost.setAttribute('aria-busy', 'true');
      void drawGhostOrbs(drawAgainCount).then((result) => {
        account = result.profile;
        resultHost.removeAttribute('aria-busy');
        renderResults(
          mappedGhostOrbDrawRewards(result.rewards),
          result.freePurchase
            ? '애니메이션 없이 무료 재소환 보상이 지급되었습니다.'
            : '애니메이션 없이 재소환 보상이 지급되었습니다.',
        );
        audio.play('item-draw');
      }).catch((error) => {
        drawAgainPending = false;
        resultHost.removeAttribute('aria-busy');
        sheet?.classList.remove('is-loading');
        loading?.setAttribute('hidden', '');
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.textContent = `${drawAgainCount}회 더 뽑기`;
        // A second device can spend cash after this screen was opened. Refresh
        // the wallet and present the same insufficient-cash purchase sheet
        // rather than leaving the player with an unhelpful failed click.
        if (error instanceof Error && /캐시|cash/i.test(error.message)) {
          void getAccount().then((profile) => {
            account = profile;
            showGhostOrbPurchaseConfirm(drawAgainCount, { onOpenCashShop: close, host: overlay });
          }).catch(() => {
            toast(error.message);
          });
          return;
        }
        toast(error instanceof Error ? error.message : '귀신구슬 재소환을 완료하지 못했습니다.');
      });
    });
  };
  const reveal = (): void => {
    if (revealed || !resultHost) return;
    revealed = true;
    stopAnimation();
    audio.setBackgroundTrack('main');
    overlay.classList.add('revealed');
    renderResults(rewards, resultMessage);
    audio.play('victory');
  };
  if (reducedMotion || !video) {
    window.setTimeout(reveal, 80);
  } else {
    audio.setBackgroundTrack(null);
    stopAnimation = playCinematicVideo(video, () => overlay.classList.add('ready'), reveal);
  }
  const skipAnimation = (): void => {
    if (revealed || !skipArmed) return;
    reveal();
  };
  overlay.addEventListener('click', skipAnimation);
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') skipAnimation();
  });
}

function showPrestigeAcquisition(
  packageId: string,
  rewards: readonly GhostOrbPreviewReward[],
  resultMessage: string,
  onClose?: () => void,
): void {
  const cinematic = PRESTIGE_CINEMATICS[packageId] ?? PRESTIGE_CINEMATICS[MOONLIT_PHANTOM_PACKAGE_ID]!;
  const overlay = document.createElement('div');
  overlay.className = `orb-gacha-overlay prestige-cinematic-overlay ${cinematic.themeClass}-prestige-cinematic`;
  overlay.innerHTML = `<section class="orb-gacha-cinematic" role="dialog" aria-modal="true" aria-label="${escapeHtml(cinematic.title)} 획득 연출" tabindex="0" style="--prestige-cinematic-backdrop:url('${escapeHtml(releaseVersionedAsset(cinematic.backdropUrl))}')">
    <video class="prestige-cinematic-video" aria-label="${escapeHtml(cinematic.ariaLabel)}" playsinline preload="auto" data-mp4-src="${releaseVersionedAsset(cinematic.mp4Url)}"${cinematic.webmUrl ? ` data-webm-src="${releaseVersionedAsset(cinematic.webmUrl)}"` : ''}></video>
    <div class="prestige-cinematic-loader"><span></span><small>프레스티지의 기억을 불러오는 중</small></div>
    <p class="orb-gacha-tap-hint">화면을 누르면 건너뜁니다</p>
    <div class="orb-gacha-results" data-orb-gacha-results></div>
  </section>`;
  document.body.appendChild(overlay);
  overlay.querySelector<HTMLElement>('.orb-gacha-cinematic')?.focus();
  const resultHost = overlay.querySelector<HTMLElement>('[data-orb-gacha-results]');
  const video = overlay.querySelector<HTMLVideoElement>('.prestige-cinematic-video');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let revealed = false;
  let skipArmed = false;
  window.setTimeout(() => { skipArmed = true; }, 320);
  let stopVideo = (): void => undefined;
  const reveal = (): void => {
    if (revealed || !resultHost) return;
    revealed = true;
    stopVideo();
    audio.setBackgroundTrack('main');
    overlay.classList.add('revealed');
    resultHost.innerHTML = `<div class="orb-gacha-result-grid ten">${rewards.map((reward, index) => `<article class="orb-gacha-result-card reward-${reward.kind}" style="--result-index:${index}">${reward.imageUrl ? `<img src="${reward.imageUrl}?v=${APP_RELEASE_VERSION}" alt=""/>` : `<i>${escapeHtml(reward.symbol)}</i>`}<strong>${escapeHtml(reward.label)}</strong><small>${escapeHtml(reward.detail)}</small></article>`).join('')}</div><p>${escapeHtml(resultMessage)}</p><button type="button" class="orb-gacha-confirm" data-orb-gacha-close>확인</button>`;
    resultHost.querySelector('[data-orb-gacha-close]')?.addEventListener('click', () => {
      overlay.remove();
      onClose?.();
    });
    audio.play('victory');
  };
  if (reducedMotion || !video) {
    window.setTimeout(reveal, 80);
  } else {
    audio.setBackgroundTrack(null);
    stopVideo = playCinematicVideo(video, () => overlay.classList.add('ready'), reveal);
  }
  const skipAnimation = (): void => {
    if (!revealed && skipArmed) reveal();
  };
  overlay.addEventListener('click', skipAnimation);
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') skipAnimation();
  });
}

function showGhostOrbGachaAnimation(drawCount: 1 | 10): void {
  showGhostOrbSummonAnimation(
    Array.from({ length: drawCount }, ghostOrbPreviewReward),
    devMode
      ? '개발용 연출 미리보기 · 실제 보상은 지급되지 않습니다.'
      : '결제 검증 후 동일한 연출로 보상이 지급됩니다.',
  );
}

function ghostOrbOddsMarkup(): string {
  return GHOST_ORB_DRAW_TABLE.map((reward) => {
    const label = reward.kind === 'points'
      ? `${reward.amount.toLocaleString()} P`
      : reward.kind === 'orbs'
        ? `귀신구슬 ${reward.amount}개`
        : SHOP_SLOT_LABELS[reward.slot as Exclude<ShopCatalogSlot, 'item'>];
    return `<li><span>${escapeHtml(label)}</span><strong>${reward.weight}%</strong></li>`;
  }).join('');
}

function showGhostOrbOddsModal(): void {
  dismissibleModal(
    `<section class="orb-odds-sheet" role="dialog" aria-modal="true" aria-labelledby="orb-odds-title"><header><div><small>DRAW INFORMATION</small><h2 id="orb-odds-title">확률 및 중복 보상</h2></div><button type="button" data-modal-close aria-label="닫기">×</button></header><ul>${ghostOrbOddsMarkup()}</ul><div><strong>33회 천장</strong><p>33회 안에 귀신구슬 1개를 보장하며, 구슬을 획득하면 천장 횟수가 초기화됩니다. 프레스티지 10구슬의 최악 기준은 330회 · ${(GHOST_ORB_PITY_DRAWS * 10 * GHOST_ORB_CASH_COST).toLocaleString()} C · 약 ₩495,000입니다.</p></div><div><strong>중복 보상</strong><p>이미 보유한 캐릭터·스킨·타일·포탑 스킨은 현재 포인트 상점 판매가만큼 포인트로 전환됩니다.</p></div></section>`,
    'orb-odds-modal',
  );
}

function showGhostOrbPurchaseConfirm(
  count: 1 | 10,
  options: { onOpenCashShop?: () => void; host?: HTMLElement } = {},
): void {
  if (!account) return authScreen();
  const productLabel = count === 10 ? '귀신구슬 10회 소환' : '귀신구슬 1회 소환';
  const cashCost = GHOST_ORB_CASH_COST * count;
  const canAfford = account.cash >= cashCost;
  const modal = dismissibleModal(
    `<section class="orb-purchase-sheet" role="dialog" aria-modal="true" aria-labelledby="orb-purchase-title"><header><img src="/assets/ui/orb-shop/menu-icon.webp?v=${APP_RELEASE_VERSION}" alt=""/><div><small>GHOST ORB PURCHASE</small><h2 id="orb-purchase-title">${escapeHtml(productLabel)}을 구매하시겠습니까?</h2></div></header><div class="orb-purchase-product"><span>${count}회</span><div><strong>${escapeHtml(productLabel)}</strong><small>${cashCost.toLocaleString()} 캐시</small></div></div><p class="${canAfford ? '' : 'insufficient'}">보유 캐시 ${account.cash.toLocaleString()}개${canAfford ? ' · 소환 즉시 차감됩니다.' : ` · ${Math.max(0, cashCost - account.cash).toLocaleString()}개가 부족합니다.`}</p><footer><button type="button" data-modal-close>취소</button><button type="button" class="confirm" ${canAfford ? 'data-orb-free-purchase' : 'data-open-cash-shop'}>${canAfford ? `${cashCost.toLocaleString()} C 사용` : '캐시 충전'}</button></footer></section>`,
    'orb-purchase-modal',
    options.host,
  );
  modal.querySelector<HTMLButtonElement>('[data-open-cash-shop]')?.addEventListener('click', () => {
    modal.remove();
    options.onOpenCashShop?.();
    cashShopScreen();
  });
  modal.querySelector<HTMLButtonElement>('[data-orb-free-purchase]')?.addEventListener('click', (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.textContent = '보상 확인 중…';
    void drawGhostOrbs(count).then((result) => {
      account = result.profile;
      modal.remove();
      showGhostOrbSummonAnimation(
        mappedGhostOrbDrawRewards(result.rewards),
        result.freePurchase
          ? '스토어 연결 전 무료 구매 보상이 지급되었습니다.'
          : '귀신구슬 소환 보상이 지급되었습니다.',
        ghostOrbShopScreen,
        count,
      );
    }).catch((error) => {
      button.disabled = false;
      button.textContent = `${cashCost.toLocaleString()} C 사용`;
      toast(error instanceof Error ? error.message : '귀신구슬 소환을 완료하지 못했습니다.');
    });
  });
}

function ghostOrbShopScreen(): void {
  if (!account) return authScreen();
  const currentAccount = account;
  const orbCount = currentAccount.prestige.ghostOrbs;
  setContent('orb-shop', `<main class="orb-shop-screen">
    <div class="orb-shop-atmosphere" aria-hidden="true"></div>
    <header class="orb-shop-header"><button type="button" data-orb-shop-back aria-label="홈으로">‹</button><div><small>SPIRIT ORB SHOP</small><h2>구슬 상점</h2></div><div class="orb-shop-header-actions"><button type="button" data-orb-exchange-page style="min-width: 60px; font-weight: 1000;">구슬 교환</button><strong><img src="/assets/ui/orb-shop/menu-icon.webp?v=${APP_RELEASE_VERSION}" alt=""/>${orbCount.toLocaleString()}</strong></div></header>
    <section class="orb-shop-scroll gacha-only">
      <section class="orb-summon-panel primary">
        <div class="orb-summon-title"><span>GHOST ORB DRAW</span><h3>귀신구슬 소환</h3><p>프리미엄·프레스티지 스킨은 등장하지 않습니다.</p><button type="button" data-orb-odds aria-label="확률 및 중복 보상 안내" style="min-width: 30px; min-height: 30px;">i</button></div>
        <div class="orb-summon-stage"><img src="${releaseVersionedAsset('/assets/ui/orb-shop/summon/summon-stage-preview.webp')}" alt="빛을 모으는 귀신구슬 소환함"/><button type="button" data-orb-animation-preview>소환 애니메이션 보기</button></div>
        <div class="orb-draw-actions"><button type="button" data-orb-draw="1"><span>1회 소환</span><strong>${GHOST_ORB_CASH_COST.toLocaleString()} C</strong></button><button type="button" class="ten" data-orb-draw="10"><span>10회 소환</span><strong>${(GHOST_ORB_CASH_COST * 10).toLocaleString()} C</strong></button></div>
        <p class="orb-iap-status">보유 캐시 ${currentAccount.cash.toLocaleString()} C · 부족한 캐시는 홈의 ＋ 버튼에서 충전할 수 있습니다.</p>
      </section>
    </section>
  </main>`);
  app.querySelector('[data-orb-shop-back]')?.addEventListener('click', homeScreen);
  app.querySelector('[data-orb-exchange-page]')?.addEventListener('click', () => ghostOrbExchangeScreen());
  app.querySelector('[data-orb-odds]')?.addEventListener('click', showGhostOrbOddsModal);
  app.querySelector('[data-orb-animation-preview]')?.addEventListener('click', () => showGhostOrbGachaAnimation(1));
  app.querySelectorAll<HTMLButtonElement>('[data-orb-draw]').forEach((button) => button.addEventListener('click', () => {
    const count = button.dataset.orbDraw === '10' ? 10 : 1;
    showGhostOrbPurchaseConfirm(count);
  }));
}

function ghostOrbExchangeScreen(activeContentId = 'bundle', activePackageId = MOONLIT_PHANTOM_PACKAGE_ID, activeTab: 'prestige' | 'accessory' = 'prestige'): void {
  if (!account) return authScreen();
  if (activeTab === 'accessory') {
    ghostOrbAccessoryExchangeScreen();
    return;
  }
  const currentAccount = account;
  const orbCount = currentAccount.prestige.ghostOrbs;
  const theme = PRESTIGE_EXCHANGE_THEMES.find((entry) => entry.id === activePackageId) ?? MOONLIT_PRESTIGE_THEME;
  const ownsPackage = currentAccount.prestige.ownedPackageIds.includes(theme.id);
  const activeContent = theme.contents.find((content) => content.id === activeContentId);
  const previewUrl = activeContent?.imageUrl ?? theme.heroUrl;
  const previewFit = activeContent?.imageFit ?? 'contain';
  const abilityMarkup = !activeContent
    ? `<section class="orb-prestige-abilities"><header><span>COMBAT TRAITS</span><strong>전투 능력</strong></header><ul>${theme.abilities.map((ability) => `<li><i aria-hidden="true">✦</i><span>${escapeHtml(ability)}</span></li>`).join('')}</ul><small>혼자하기 · 친구랑하기 적용 / 랭크전 미적용</small></section>`
    : '';
  const exchangeStatus = ownsPackage
    ? '패키지 보유 중'
    : !theme.available
      ? '제작 중 · 곧 교환 가능'
    : orbCount >= GHOST_ORB_PACKAGE_COST
      ? `귀신구슬 ${GHOST_ORB_PACKAGE_COST}개로 모두 교환`
      : `귀신구슬 ${GHOST_ORB_PACKAGE_COST - orbCount}개 더 필요`;
  const contentButtons = theme.contents.map((content) => `<button type="button" class="${content.id === activeContentId ? 'selected' : ''}" data-prestige-content="${content.id}"><img src="${releaseVersionedAsset(content.imageUrl)}" alt=""/><span><strong>${escapeHtml(content.label)}</strong><small>${escapeHtml(content.detail)}</small></span></button>`).join('');
  const prestigeRewards = theme.contents.map((content) => ({
    kind: 'cosmetic' as const,
    label: content.label,
    symbol: '✦',
    detail: content.detail,
    imageUrl: content.imageUrl,
  }));
  setContent('orb-exchange', `<main class="orb-shop-screen orb-exchange-screen">
    <div class="orb-shop-atmosphere" aria-hidden="true"></div>
    <header class="orb-shop-header"><button type="button" data-orb-exchange-back aria-label="구슬 상점으로">‹</button><div><small>PRESTIGE EXCHANGE</small><h2>구슬 교환</h2></div><div class="orb-shop-header-actions"><strong><img src="/assets/ui/orb-shop/menu-icon.webp?v=${APP_RELEASE_VERSION}" alt=""/>${orbCount.toLocaleString()}</strong></div></header>
    <nav class="orb-exchange-tabs" aria-label="구슬 교환 분류"><button type="button" class="active" data-orb-exchange-tab="prestige">프레스티지</button><button type="button" data-orb-exchange-tab="accessory">소품 교환</button></nav>
    <section class="orb-exchange-scroll">
      <div class="orb-exchange-workbench">
        <aside class="orb-prestige-list"><small>PRESTIGE</small>${PRESTIGE_EXCHANGE_THEMES.map((entry) => `<button type="button" class="${entry.id === theme.id ? 'selected' : ''}" data-prestige-package="${entry.id}" aria-pressed="${entry.id === theme.id}"><img src="${releaseVersionedAsset(entry.iconUrl)}" alt=""/><span><strong>${escapeHtml(entry.title)}</strong><small>${entry.available ? `귀신구슬 ${GHOST_ORB_PACKAGE_COST}개` : '제작 중'}</small></span></button>`).join('')}</aside>
        <section class="orb-exchange-detail">
          <span class="orb-package-rarity">PRESTIGE · LIMITED</span>
          <div class="orb-exchange-preview ${previewFit}"><img src="${releaseVersionedAsset(previewUrl)}" alt="${escapeHtml(activeContent?.label ?? theme.title)} 미리보기"/></div>
          <div class="orb-exchange-copy"><small>${activeContent ? escapeHtml(activeContent.label) : '프레스티지 교환 계약'}</small><h3>${escapeHtml(activeContent?.detail ?? theme.title)}</h3><p>${escapeHtml(theme.subtitle)}</p></div>
          ${abilityMarkup}
        </section>
      </div>
      <section class="orb-exchange-contents"><header><div><small>PACKAGE CONTENTS</small><h3>구성품 미리보기</h3></div></header><div>${contentButtons}</div></section>
    </section>
    <footer class="orb-exchange-actions ${devMode ? '' : 'single'}">
      ${devMode ? '<button type="button" class="orb-cinematic-preview" data-prestige-cinematic-preview><span aria-hidden="true">▶</span><strong>획득 연출</strong></button>' : ''}
      <button type="button" class="orb-package-exchange" data-orb-package-exchange ${!theme.available || ownsPackage || orbCount < GHOST_ORB_PACKAGE_COST ? 'disabled' : ''}><small>PRESTIGE EXCHANGE</small><strong>${escapeHtml(exchangeStatus)}</strong></button>
    </footer>
  </main>`);
  app.querySelector('[data-orb-exchange-back]')?.addEventListener('click', ghostOrbShopScreen);
  app.querySelectorAll<HTMLButtonElement>('[data-orb-exchange-tab]').forEach((button) => button.addEventListener('click', () => {
    ghostOrbExchangeScreen('bundle', theme.id, button.dataset.orbExchangeTab as 'prestige' | 'accessory');
  }));
  app.querySelectorAll<HTMLButtonElement>('[data-prestige-content]').forEach((button) => button.addEventListener('click', () => {
    ghostOrbExchangeScreen(button.dataset.prestigeContent ?? 'bundle', theme.id);
  }));
  app.querySelectorAll<HTMLButtonElement>('[data-prestige-package]').forEach((button) => button.addEventListener('click', () => {
    ghostOrbExchangeScreen('bundle', button.dataset.prestigePackage ?? MOONLIT_PHANTOM_PACKAGE_ID);
  }));
  app.querySelector('[data-prestige-cinematic-preview]')?.addEventListener('click', () => {
    audio.unlock();
    showPrestigeAcquisition(theme.id, prestigeRewards, '개발용 획득 연출 미리보기입니다.', () => ghostOrbExchangeScreen('bundle', theme.id));
  });
  app.querySelector<HTMLButtonElement>('[data-orb-package-exchange]')?.addEventListener('click', (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    audio.unlock();
    button.disabled = true;
    void withGlobalActionLoading(`${theme.title} 교환 중`, () => exchangePrestigePackage(theme.id))
      .then((updated) => {
        account = updated;
        showPrestigeAcquisition(
          theme.id,
          prestigeRewards,
          `${theme.title} 프레스티지 패키지를 획득했습니다.`,
          () => ghostOrbExchangeScreen('bundle', theme.id),
        );
      })
      .catch((error) => {
        button.disabled = false;
        toast(error instanceof Error ? error.message : '프레스티지 패키지를 교환하지 못했습니다.');
      });
  });
}

function ghostOrbAccessoryExchangeScreen(activeCategory: PrestigeAccessoryCategory = 'profile'): void {
  if (!account) return authScreen();
  const currentAccount = account;
  const orbCount = currentAccount.prestige.ghostOrbs;
  const owned = new Set(currentAccount.prestige.ownedAccessoryIds);
  const categories: readonly [PrestigeAccessoryCategory, string][] = [
    ['profile', '프로필'], ['frame', '테두리'], ['nameplate', '명찰'], ['background', '배경'], ['emote', '이모티콘'],
  ];
  const cards = PRESTIGE_ACCESSORIES
    .filter((item) => item.category === activeCategory)
    .map((item) => {
      const isOwned = owned.has(item.id);
      const insufficient = orbCount < item.orbCost;
      const action = isOwned ? '보유 중' : `귀신구슬 ${item.orbCost}개 교환`;
      const art = item.category === 'frame'
        ? `<span class="orb-frame-preview"><img src="${escapeHtml(DEFAULT_PROFILE_AVATAR)}" alt=""/><img src="${escapeHtml(releaseVersionedAsset(item.imageUrl))}" alt="${escapeHtml(item.label)}"/></span>`
        : `<img src="${escapeHtml(releaseVersionedAsset(item.imageUrl))}" alt="${escapeHtml(item.label)}"/>`;
      return `<article class="orb-accessory-card ${item.category}-accessory-card ${isOwned ? 'owned' : ''}">
        ${art}
        <div><small>${escapeHtml(item.detail)}</small><strong>${escapeHtml(item.label)}</strong></div>
        <button type="button" data-orb-accessory-exchange="${item.id}" ${isOwned || insufficient ? 'disabled' : ''}>${action}</button>
      </article>`;
    }).join('');
  setContent('orb-exchange', `<main class="orb-shop-screen orb-exchange-screen orb-accessory-exchange-screen">
    <div class="orb-shop-atmosphere" aria-hidden="true"></div>
    <header class="orb-shop-header"><button type="button" data-orb-exchange-back aria-label="구슬 상점으로">‹</button><div><small>ACCESSORY EXCHANGE</small><h2>구슬 교환</h2></div><div class="orb-shop-header-actions"><strong><img src="/assets/ui/orb-shop/menu-icon.webp?v=${APP_RELEASE_VERSION}" alt=""/>${orbCount.toLocaleString()}</strong></div></header>
    <nav class="orb-exchange-tabs" aria-label="구슬 교환 분류"><button type="button" data-orb-exchange-tab="prestige">프레스티지</button><button type="button" class="active" data-orb-exchange-tab="accessory">소품 교환</button></nav>
    <section class="orb-accessory-exchange-scroll">
      <header><small>SPIRIT ACCESSORIES</small><h3>소품 교환</h3><p>패키지 전체 교환보다 작은 단위로 필요한 연출을 먼저 수집하세요.</p></header>
      <nav class="orb-accessory-categories" aria-label="소품 종류">${categories.map(([category, label]) => `<button type="button" class="${category === activeCategory ? 'active' : ''}" data-orb-accessory-category="${category}">${label}</button>`).join('')}</nav>
      <div class="orb-accessory-grid">${cards}</div>
      <p class="orb-iap-status">보유 귀신구슬 ${orbCount.toLocaleString()}개 · 소품 교환 후 보관함의 연출 탭에서 장착할 수 있습니다.</p>
    </section>
  </main>`);
  app.querySelector('[data-orb-exchange-back]')?.addEventListener('click', ghostOrbShopScreen);
  app.querySelectorAll<HTMLButtonElement>('[data-orb-exchange-tab]').forEach((button) => button.addEventListener('click', () => {
    ghostOrbExchangeScreen('bundle', MOONLIT_PHANTOM_PACKAGE_ID, button.dataset.orbExchangeTab as 'prestige' | 'accessory');
  }));
  app.querySelectorAll<HTMLButtonElement>('[data-orb-accessory-category]').forEach((button) => button.addEventListener('click', () => {
    ghostOrbAccessoryExchangeScreen(button.dataset.orbAccessoryCategory as PrestigeAccessoryCategory);
  }));
  app.querySelectorAll<HTMLButtonElement>('[data-orb-accessory-exchange]').forEach((button) => button.addEventListener('click', () => {
    const accessoryId = button.dataset.orbAccessoryExchange ?? '';
    const accessory = PRESTIGE_ACCESSORIES.find((item) => item.id === accessoryId);
    if (!accessory) return;
    button.disabled = true;
    void exchangePrestigeAccessory(accessoryId).then((updated) => {
      account = updated;
      toast(`${accessory.label}을(를) 교환했습니다.`);
      ghostOrbAccessoryExchangeScreen(activeCategory);
    }).catch((error) => {
      button.disabled = false;
      toast(error instanceof Error ? error.message : '소품을 교환하지 못했습니다.');
    });
  }));
}

async function refreshHomeEventMissionStatus(): Promise<void> {
  try {
    eventMissionOverviewCache = await getEventMissions();
    if (account) account.customPoints = eventMissionOverviewCache.customPoints;
    if (currentView !== "home") return;
    app
      .querySelector("[data-event-alert]")
      ?.classList.toggle("visible", eventMissionOverviewCache.claimableCount > 0);
    app
      .querySelector("[data-attendance-alert]")
      ?.classList.toggle("visible", eventMissionOverviewCache.attendance.claimableCount > 0);
    app
      .querySelector("[data-event-nudge]")
      ?.classList.toggle(
        "visible",
        eventMissionOverviewCache.claimableCount === 0 &&
          !eventMissionOverviewCache.hasProgress,
      );
  } catch {
    if (currentView !== "home") return;
    app.querySelector("[data-event-alert]")?.classList.remove("visible");
    app.querySelector("[data-attendance-alert]")?.classList.remove("visible");
    app.querySelector("[data-event-nudge]")?.classList.remove("visible");
  }
}

function eventMissionResetLabel(period: EventMissionPeriod, resetsAt: number): string {
  if (period === "daily") {
    return "매일 00:00 초기화";
  }
  const reset = new Date(resetsAt);
  return `매주 월요일 초기화 · ${new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    timeZone: "Asia/Seoul",
  }).format(reset)}까지`;
}

function eventMissionCardMarkup(mission: EventMissionProgress): string {
  const progress = Math.min(mission.progress, mission.target);
  const progressPercent = Math.round((progress / mission.target) * 100);
  const status = mission.claimed
    ? `<span class="event-mission-claimed">수령 완료</span>`
    : mission.claimable
      ? `<button data-claim-mission="${mission.id}">받기</button>`
      : `<span class="event-mission-count">${progress}/${mission.target}</span>`;
  return `<article class="event-mission-card ${mission.claimable ? "claimable" : ""} ${mission.claimed ? "claimed" : ""}">
    <div class="event-mission-copy"><small>${mission.period === "daily" ? "DAILY" : "WEEKLY"}</small><strong>${escapeHtml(mission.title)}</strong><p>${escapeHtml(mission.description)}</p><div class="event-mission-progress" aria-label="${progress}/${mission.target} 진행"><i style="width:${progressPercent}%"></i></div></div>
    <div class="event-mission-reward"><b>✦ ${mission.rewardPoints} P</b>${status}</div>
  </article>`;
}

function attendanceRewardCardMarkup(reward: AttendanceRewardProgress): string {
  const stateLabel = reward.claimed
    ? '수령 완료'
    : reward.claimable
      ? '눌러서 수령'
      : `${reward.day}회 출석 시 해금`;
  return `<button type="button" class="attendance-reward ${reward.special ? 'special' : ''} ${reward.claimable ? 'claimable' : ''} ${reward.claimed ? 'claimed' : ''}" data-attendance-day="${reward.day}" ${reward.claimable ? '' : 'disabled'}>
    <span>${reward.day}일 출석</span>
    <img src="${escapeHtml(releaseVersionedAsset(reward.imageUrl))}" alt="${escapeHtml(reward.label)}" loading="lazy"/>
    <strong>${escapeHtml(reward.label)}</strong>
    <small>${stateLabel}</small>
  </button>`;
}

function attendanceSectionMarkup(overview: EventMissionOverview): string {
  const attendance = overview.attendance;
  return `<section class="attendance-section">
    <header><div><small>30-DAY CHECK-IN</small><strong>누적 출석 보상판</strong></div><span>${attendance.attendanceCount}/30회 출석</span></header>
    <p>연속 출석이 아니며, 서로 다른 날 접속할 때마다 출석 횟수가 1회 올라갑니다. 해금된 보상을 직접 눌러 수령하세요.</p>
    <div class="attendance-calendar">${attendance.rewards.map(attendanceRewardCardMarkup).join('')}</div>
  </section>`;
}

function showAttendancePremiumChoice(overview: EventMissionOverview): void {
  const choice = overview.attendance.premiumChoice;
  if (!choice?.pending) return;
  const modal = dismissibleModal(
    `<section class="attendance-choice-sheet" role="dialog" aria-modal="true" aria-labelledby="attendance-choice-title">
      <header><div><small>PREMIUM SELECT</small><h2 id="attendance-choice-title">프리미엄 스킨 선택권</h2></div><button type="button" data-modal-close aria-label="닫기">×</button></header>
      <p>서퍼 몽을 이미 보유하고 있어 같은 가격대의 프리미엄 스킨 1개를 선택할 수 있습니다. 캐릭터가 없어도 먼저 수령할 수 있습니다.</p>
      <div class="attendance-choice-grid">${choice.choices.map((item) => `<button type="button" data-attendance-choice="${escapeHtml(item.itemId)}"><img src="${escapeHtml(releaseVersionedAsset(item.imageUrl))}" alt="${escapeHtml(item.label)}"/><strong>${escapeHtml(item.label)}</strong><span>선택</span></button>`).join('')}</div>
    </section>`,
    'attendance-choice-modal',
  );
  modal.querySelectorAll<HTMLButtonElement>('[data-attendance-choice]').forEach((button) => {
    button.addEventListener('click', () => {
      const itemId = button.dataset.attendanceChoice;
      if (!itemId) return;
      button.disabled = true;
      void withGlobalActionLoading('프리미엄 스킨 수령 중', () => redeemAttendanceSkin(itemId))
        .then(async (result) => {
          account = await getAccount();
          if (eventMissionOverviewCache) {
            eventMissionOverviewCache = {
              ...eventMissionOverviewCache,
              customPoints: account.customPoints,
              attendance: result.overview,
            };
          }
          modal.remove();
          audio.play('item-pickup');
          toast('선택한 프리미엄 스킨을 수령했습니다.');
          if (eventMissionOverviewCache) renderAttendanceEventScreen(eventMissionOverviewCache);
        })
        .catch((error) => {
          button.disabled = false;
          toast(error instanceof Error ? error.message : '프리미엄 스킨을 수령하지 못했습니다.');
        });
    });
  });
}

function bindEventBackButton(): void {
  app.querySelector("[data-event-back]")?.addEventListener("click", () => {
    audio.play("button");
    homeScreen();
  });
}

function bindAttendanceRewardButtons(): void {
  app.querySelectorAll<HTMLButtonElement>('[data-attendance-day]').forEach((button) => {
    button.addEventListener('click', () => {
      const day = Number(button.dataset.attendanceDay);
      if (!Number.isInteger(day)) return;
      button.disabled = true;
      void claimAttendanceRewardForDay(day);
    });
  });
}

function renderAttendanceEventScreen(overview: EventMissionOverview): void {
  setContent(
    "events",
    `<main class="event-screen">
      <div class="event-screen-backdrop"></div>
      <header class="event-header"><button data-event-back aria-label="홈으로">‹</button><div><span>EVENT CENTER</span><h1>이벤트</h1></div><strong>✦ ${overview.customPoints.toLocaleString()} P</strong></header>
      <nav class="event-tabs event-center-tabs event-category-tabs" aria-label="이벤트 종류"><button type="button" class="attendance-tab active" data-event-category="attendance">출석보상</button></nav>
      ${attendanceSectionMarkup(overview)}
    </main>`,
  );
  bindEventBackButton();
  bindAttendanceRewardButtons();
  if (overview.attendance.premiumChoice?.pending) {
    window.setTimeout(() => showAttendancePremiumChoice(overview), 0);
  }
}

function renderMissionScreen(
  overview: EventMissionOverview,
  activePeriod: EventMissionPeriod,
): void {
  const period = overview.periods[activePeriod];
  setContent(
    "missions",
    `<main class="event-screen mission-screen">
      <div class="event-screen-backdrop"></div>
      <header class="event-header"><button data-event-back aria-label="홈으로">‹</button><div><span>MISSION</span><h1>미션</h1></div><strong>✦ ${overview.customPoints.toLocaleString()} P</strong></header>
      <section class="event-hero"><img src="/assets/ui/event-missions.webp?v=${APP_RELEASE_VERSION}" alt="생존 미션"/><div><small>MIDNIGHT ORDERS</small><h2>생존 보급 작전</h2><p>매일과 매주 갱신되는 임무를 달성하고 포인트를 받으세요.</p></div></section>
      <nav class="event-tabs" aria-label="미션 종류"><button class="${activePeriod === "daily" ? "active" : ""}" data-mission-period="daily">일일 미션</button><button class="${activePeriod === "weekly" ? "active" : ""}" data-mission-period="weekly">주간 미션</button></nav>
      <section class="event-mission-section"><header><div><small>${activePeriod === "daily" ? "TODAY" : "THIS WEEK"}</small><strong>${activePeriod === "daily" ? "오늘의 생존 지령" : "주간 생존 작전"}</strong></div><span>${eventMissionResetLabel(activePeriod, period.resetsAt)}</span></header><div class="event-mission-list">${period.missions.map(eventMissionCardMarkup).join("")}</div></section>
      <footer class="event-claim-footer"><span>${overview.claimableCount > 0 ? `수령 가능한 미션 보상 ${overview.claimableCount}개` : "수령 가능한 미션 보상이 없습니다"}</span><button data-claim-all ${overview.claimableCount > 0 ? "" : "disabled"}>보상 일괄수령</button></footer>
    </main>`,
  );
  bindEventBackButton();
  app
    .querySelectorAll<HTMLButtonElement>("[data-mission-period]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        audio.play("button");
        renderMissionScreen(overview, button.dataset.missionPeriod === 'weekly' ? 'weekly' : 'daily');
      }),
    );
  app
    .querySelectorAll<HTMLButtonElement>("[data-claim-mission]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const missionId = button.dataset.claimMission;
        if (!missionId) return;
        void claimMissionRewards([missionId], activePeriod);
      }),
    );
  app.querySelector<HTMLButtonElement>("[data-claim-all]")?.addEventListener("click", () => {
    void claimMissionRewards([], activePeriod);
  });
}

async function claimAttendanceRewardForDay(day: number): Promise<void> {
  try {
    const result = await withGlobalActionLoading('출석 보상 수령 중', () => claimAttendanceDay(day));
    account = await getAccount();
    if (!eventMissionOverviewCache || !account) return;
    eventMissionOverviewCache = {
      ...eventMissionOverviewCache,
      customPoints: account.customPoints,
      attendance: result.overview,
    };
    renderAttendanceEventScreen(eventMissionOverviewCache);
    audio.play('item-pickup');
    if (result.premiumChoiceRequired) toast('프리미엄 스킨 선택권을 받았습니다.');
    else if (result.awardedPoints > 0) toast(`${result.awardedPoints.toLocaleString()}P를 받았습니다.`);
    else toast('출석 특별 보상을 받았습니다.');
  } catch (error) {
    if (eventMissionOverviewCache) renderAttendanceEventScreen(eventMissionOverviewCache);
    toast(error instanceof Error ? error.message : '출석 보상을 수령하지 못했습니다.');
  }
}

async function claimMissionRewards(
  missionIds: readonly string[],
  activePeriod: EventMissionPeriod,
): Promise<void> {
  app
    .querySelectorAll<HTMLButtonElement>("[data-claim-mission], [data-claim-all]")
    .forEach((button) => {
      button.disabled = true;
  });
  try {
    const result = await withGlobalActionLoading(
      missionIds.length > 1 ? "미션 보상 일괄 수령 중" : "미션 보상 수령 중",
      () => claimEventMissions(missionIds),
    );
    eventMissionOverviewCache = result.overview;
    if (account) account.customPoints = result.overview.customPoints;
    renderMissionScreen(result.overview, activePeriod);
    if (result.awardedPoints > 0) {
      audio.play("item-pickup");
      toast(`미션 보상 ${result.awardedPoints.toLocaleString()}P를 받았습니다.`);
    } else {
      toast("새로 수령할 수 있는 보상이 없습니다.");
    }
  } catch (error) {
    if (eventMissionOverviewCache) {
      renderMissionScreen(eventMissionOverviewCache, activePeriod);
    }
    toast(error instanceof Error ? error.message : "미션 보상을 수령하지 못했습니다.");
  }
}

async function attendanceEventScreen(): Promise<void> {
  setContent(
    "events",
    loadingMarkup("이벤트를 불러오는 중", "누적 출석 보상을 확인하고 있습니다."),
  );
  try {
    eventMissionOverviewCache = await getEventMissions();
    if (account) account.customPoints = eventMissionOverviewCache.customPoints;
    if (currentView !== "events") return;
    renderAttendanceEventScreen(eventMissionOverviewCache);
  } catch (error) {
    if (currentView !== "events") return;
    setContent(
      "events",
      `<main class="screen"><section class="panel compact"><span class="eyebrow">EVENT CENTER</span><h2>이벤트를 열지 못했습니다</h2><p class="subtitle">${escapeHtml(error instanceof Error ? error.message : "잠시 후 다시 시도해주세요.")}</p><button class="btn primary" data-event-back>홈으로</button></section></main>`,
    );
    app.querySelector("[data-event-back]")?.addEventListener("click", homeScreen);
  }
}

async function missionScreen(initialPeriod: EventMissionPeriod = 'daily'): Promise<void> {
  setContent(
    "missions",
    loadingMarkup("미션을 불러오는 중", "오늘의 생존 지령을 확인하고 있습니다."),
  );
  try {
    eventMissionOverviewCache = await getEventMissions();
    if (account) account.customPoints = eventMissionOverviewCache.customPoints;
    if (currentView !== "missions") return;
    renderMissionScreen(eventMissionOverviewCache, initialPeriod);
  } catch (error) {
    if (currentView !== "missions") return;
    setContent(
      "missions",
      `<main class="screen"><section class="panel compact"><span class="eyebrow">MISSION</span><h2>미션을 열지 못했습니다</h2><p class="subtitle">${escapeHtml(error instanceof Error ? error.message : "잠시 후 다시 시도해주세요.")}</p><button class="btn primary" data-event-back>홈으로</button></section></main>`,
    );
    app.querySelector("[data-event-back]")?.addEventListener("click", homeScreen);
  }
}

function adFreeStatusText(profile: AccountProfile): string {
  if (!profile.adFree.active) return "광고 제거 상품을 선택해주세요.";
  if (profile.adFree.plan === "permanent") return "영구 광고 제거가 적용 중입니다.";
  if (!profile.adFree.expiresAt) return "한 달 광고 제거가 적용 중입니다.";
  return `${new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(profile.adFree.expiresAt)}까지 광고가 제거됩니다.`;
}

function showAdFreePurchase(): void {
  const currentAccount = account;
  if (!currentAccount) return;
  const modal = dismissibleModal(
    `<section class="panel compact ad-free-purchase" role="dialog" aria-modal="true" aria-labelledby="ad-free-title">
      <header class="ad-free-purchase-header">
        <div><span class="eyebrow">AD FREE</span><h2 id="ad-free-title">광고 제거</h2></div>
        <button data-modal-close aria-label="닫기">×</button>
      </header>
      <p class="ad-free-status ${currentAccount.adFree.active ? "active" : ""}">${escapeHtml(adFreeStatusText(currentAccount))}</p>
      <div class="ad-free-plans">
        <button type="button" data-ad-free-plan="monthly" ${currentAccount.adFree.plan === "permanent" ? "disabled" : ""}>
          <span>30 DAYS</span><strong>한 달 제거</strong><b>₩6,000</b>
          <small>구매일부터 30일 동안 광고 없이 2배 전리품을 받습니다.</small>
        </button>
        <button type="button" class="permanent" data-ad-free-plan="permanent" ${currentAccount.adFree.plan === "permanent" ? "disabled" : ""}>
          <span>FOREVER</span><strong>영구 제거</strong><b>₩30,000</b>
          <small>기간 제한 없이 광고 없이 2배 전리품을 받습니다.</small>
        </button>
      </div>
      <p class="ad-free-test-note">결제 연동 전 테스트 기간에는 버튼을 누르면 무료로 적용됩니다.</p>
    </section>`,
    "ad-free-purchase-modal",
  );
  modal
    .querySelectorAll<HTMLButtonElement>("[data-ad-free-plan]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const plan = button.dataset.adFreePlan === "permanent" ? "permanent" : "monthly";
        modal
          .querySelectorAll<HTMLButtonElement>("[data-ad-free-plan]")
          .forEach((candidate) => {
            candidate.disabled = true;
          });
        button.classList.add("loading");
        void purchaseAdFree(plan)
          .then((next) => {
            account = next;
            modal.remove();
            homeScreen();
            toast(plan === "permanent" ? "영구 광고 제거가 적용되었습니다." : "한 달 광고 제거가 적용되었습니다.");
          })
          .catch((error) => {
            button.classList.remove("loading");
            modal
              .querySelectorAll<HTMLButtonElement>("[data-ad-free-plan]")
              .forEach((candidate) => {
                candidate.disabled = currentAccount.adFree.plan === "permanent";
              });
            toast(error instanceof Error ? error.message : "광고 제거 상품을 적용하지 못했습니다.");
          });
      }),
    );
}

interface SkinLaunchCampaign {
  id: PromotionCampaignId;
  ownedSkinIds: readonly string[];
  targetSkinId?: string;
  action: "shop" | "hide-seek";
  actionLabel: string;
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
    id: "hide-seek-release",
    ownedSkinIds: [],
    action: "hide-seek",
    actionLabel: "게임플레이",
    className: "hide-seek-release-promo",
    ariaLabel: "심야 술래잡기 모드 출시",
    imageUrl: "/assets/events/hide-seek-release-v1.webp",
    imageAlt: "어두운 병동에서 랜턴 귀신을 피해 달리는 강아지와 토끼 생존자",
    eyebrow: "NEW MODE · NIGHT CHASE",
    title: "심야 술래잡기<br/>정식 출시!",
    body: "친구와 함께 숨고, 열쇠를 모으고,<br/>랜턴을 든 술래에게서 탈출하세요.",
    footnote: "귀신 1명 VS 생존자 최대 6명",
  },
  {
    id: "special-ops",
    ownedSkinIds: [POLICE_ENFORCER_CROCO_SKIN_ID, SECRET_AGENT_MONKEY_SKIN_ID],
    targetSkinId: POLICE_ENFORCER_CROCO_SKIN_ID,
    action: "shop",
    actionLabel: "스킨 보러 가기",
    className: "special-ops-premium-promo",
    ariaLabel: "경찰과 비밀요원 프리미엄 스킨 동시 출시",
    imageUrl: "/assets/cinematic/special-ops-premium-skins-event.webp",
    imageAlt: "무전기로 현장을 지휘하는 강력계 크로크와 권총을 겨눈 시크릿 에이전트 몽키",
    eyebrow: "SPECIAL OPS PREMIUM",
    title: "극비 작전<br/>개시!",
    body: "현장을 장악하는 강력계 크로크와<br/>그림자처럼 움직이는 몽키를 만나보세요.",
    footnote: "프리미엄 2종 · 각 8,000 P",
  },
  {
    id: "summer",
    ownedSkinIds: [SURFER_MONG_SKIN_ID, LIFEGUARD_RAON_SKIN_ID],
    targetSkinId: LIFEGUARD_RAON_SKIN_ID,
    action: "shop",
    actionLabel: "스킨 보러 가기",
    className: "summer-special-promo",
    ariaLabel: "썸머 특별 스킨 동시 출시",
    imageUrl: "/assets/cinematic/summer-special-skins-event.webp",
    imageAlt: "뒤집힐 듯 날아오른 서퍼 몽을 구하러 달려가는 해변 구조대 라온",
    eyebrow: "SUMMER SPECIAL SKINS",
    title: "썸머 특별 스킨<br/>동시 출시!",
    body: "파도를 타는 서퍼 몽과<br/>해변을 지키는 구조대 라온을 만나보세요.",
    footnote: "여름 한정 2종 · 각 8,000 P",
  },
  {
    id: "cyberpunk",
    ownedSkinIds: [NEON_RIDER_LULU_SKIN_ID, CYBER_DRIVER_KONG_SKIN_ID],
    targetSkinId: NEON_RIDER_LULU_SKIN_ID,
    action: "shop",
    actionLabel: "스킨 보러 가기",
    className: "cyberpunk-special-promo",
    ariaLabel: "사이버펑크 프리미엄 스킨 동시 출시",
    imageUrl: "/assets/cinematic/cyberpunk-premium-skins-event.webp",
    imageAlt: "네온 인라인을 타는 루루와 사이버 스포츠카를 모는 콩",
    eyebrow: "CYBERPUNK PREMIUM",
    title: "네온 시티를<br/>질주하라!",
    body: "네온 라이더 루루와<br/>사이버 드라이버 콩이 도착했습니다.",
    footnote: "프리미엄 2종 · 각 8,000 P",
  },
] as const;

function skinLaunchPromoDismissed(campaign: SkinLaunchCampaign): boolean {
  return account?.dismissedPromotionIds.includes(campaign.id) ?? false;
}

function storefrontThemeVisible(itemId: string, profile: AccountProfile): boolean {
  const theme = (profile.storefrontThemes ?? []).find((candidate) =>
    candidate.cosmeticIds.includes(itemId),
  );
  return theme?.isStoreVisible ?? true;
}

function storefrontCampaignOrder(campaign: SkinLaunchCampaign, profile: AccountProfile): number {
  return (profile.promotionCampaigns ?? []).find((setting) => setting.id === campaign.id)?.sortOrder
    ?? SKIN_LAUNCH_CAMPAIGNS.indexOf(campaign);
}

function storefrontCampaignVisible(campaign: SkinLaunchCampaign, profile: AccountProfile): boolean {
  const campaignSetting = (profile.promotionCampaigns ?? []).find(
    (setting) => setting.id === campaign.id,
  );
  const themeSetting = (profile.storefrontThemes ?? []).find(
    (setting) => setting.id === campaign.id,
  );
  return (campaignSetting?.isVisible ?? true)
    && (campaign.action !== "shop" || (themeSetting?.isStoreVisible ?? true));
}

function permanentlyDismissSkinLaunchPromo(campaign: SkinLaunchCampaign): void {
  const currentAccount = account;
  if (!currentAccount || skinLaunchPromoDismissed(campaign)) return;
  account = {
    ...currentAccount,
    dismissedPromotionIds: [
      ...currentAccount.dismissedPromotionIds,
      campaign.id,
    ],
  };
  void dismissPromotion(campaign.id)
    .then((profile) => {
      if (account?.id === currentAccount.id) account = profile;
    })
    .catch((error) => {
      if (account?.id === currentAccount.id) account = currentAccount;
      toast(error instanceof Error ? error.message : "이벤트 설정을 저장하지 못했습니다.");
    });
}

function showSkinLaunchPromoCarousel(): void {
  if (
    !account ||
    !account.tutorialCompleted ||
    skinLaunchPromoShownForAccountId === account.id
  ) return;
  const currentAccount = account;
  const campaigns = SKIN_LAUNCH_CAMPAIGNS.filter(
    (campaign) =>
      storefrontCampaignVisible(campaign, currentAccount)
      && !skinLaunchPromoDismissed(campaign)
      && (campaign.ownedSkinIds.length === 0 || !campaign.ownedSkinIds.every((skinId) =>
        currentAccount.ownedCosmetics.includes(skinId),
      )),
  ).sort((left, right) =>
    storefrontCampaignOrder(left, currentAccount) - storefrontCampaignOrder(right, currentAccount),
  );
  if (!campaigns.length) return;
  skinLaunchPromoShownForAccountId = currentAccount.id;
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
    modal.innerHTML = `<section class="surfer-mong-promo ${campaign.className}" role="dialog" aria-modal="true" aria-label="${campaign.ariaLabel}" data-launch-promo="${campaign.id}"><div class="surfer-mong-promo-art"><img src="${campaign.imageUrl}?v=${APP_RELEASE_VERSION}" alt="${campaign.imageAlt}"/><div class="surfer-mong-promo-copy"><span>${campaign.eyebrow}</span><h2>${campaign.title}</h2><p>${campaign.body}</p><small>${campaign.footnote}</small></div>${carouselControls}</div><footer><button type="button" class="surfer-promo-dismiss" data-launch-promo-dismiss>다시 보지 않기</button><button type="button" class="surfer-promo-shop" data-launch-promo-shop>${campaign.actionLabel}</button></footer></section>`;
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
      if (campaign.action === "hide-seek") {
        hideSeekLaunchGuideStep = "home-mode";
        app.querySelectorAll(".modal-backdrop").forEach((candidate) => candidate.remove());
        homeScreen();
      } else if (campaign.targetSkinId) {
        shopScreen("skin", campaign.targetSkinId);
      }
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

type GameMenuIconKind =
  | "announcement"
  | "event"
  | "adfree"
  | "ranking"
  | "guide"
  | "shop"
  | "home"
  | "locker"
  | "social"
  | "mail"
  | "settings"
  | "points";

function gameMenuIcon(kind: GameMenuIconKind): string {
  return `<span class="game-menu-icon game-menu-icon-${kind}" aria-hidden="true"></span>`;
}

function homeUtilityIcon(kind: "mail" | "social" | "settings"): string {
  return gameMenuIcon(kind);
}

function gameActionIcon(kind: "bed" | "repair"): string {
  if (kind === "repair") {
    return '<svg class="game-action-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M39 12a15 15 0 0 0-18 19L8 44l12 12 13-13a15 15 0 0 0 19-18l-9 9-10-3-3-10z"/><path d="m12 44 8 8m19-40-9 9m13 13 9-9"/></svg>';
  }
  return '<svg class="game-action-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M9 43h46v10H9zM13 26h38c3 0 5 2 5 5v12H8V31c0-3 2-5 5-5z"/><path d="M13 26v-8h15c4 0 7 3 7 7v1M14 53v4m36-4v4"/><circle cx="19" cy="22" r="4"/></svg>';
}

function homeFooterIcon(kind: "shop" | "event" | "stage" | "social" | "mail" | "custom"): string {
  if (kind === "shop") return gameMenuIcon("shop");
  if (kind === "event") return gameMenuIcon("event");
  if (kind === "stage") return gameMenuIcon("home");
  if (kind === "social") return gameMenuIcon("social");
  if (kind === "mail") return gameMenuIcon("mail");
  return gameMenuIcon("locker");
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

function dismissibleModal(markup: string, className: string, host: HTMLElement = app): HTMLElement {
  const modal = document.createElement("div");
  modal.className = `modal-backdrop ${className}`;
  modal.innerHTML = markup;
  modal.addEventListener("pointerdown", (event) => {
    if (event.target === modal) modal.remove();
  });
  modal
    .querySelector("[data-modal-close]")
    ?.addEventListener("click", () => modal.remove());
  host.appendChild(modal);
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
  const shownAt = performance.now();
  try {
    return await action();
  } finally {
    // Fast local responses otherwise remove the overlay before the browser has
    // painted a frame, which looks like an ignored tap on mobile.
    const remaining = 240 - (performance.now() - shownAt);
    if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
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
  const currentAccount = account;
  const modal = dismissibleModal(
    `<section class="home-picker-sheet" role="dialog" aria-modal="true" aria-labelledby="mode-picker-title"><header><div><small>PLAY MODE</small><h2 id="mode-picker-title">플레이 방식 선택</h2></div><button data-modal-close aria-label="닫기">×</button></header><div class="home-mode-options"><button class="${homePlayMode === "solo" ? "selected" : ""}" data-home-mode="solo"><i>☾</i><span><strong>혼자하기</strong><small>생존 봇 3명과 함께 방어합니다.</small></span><b>선택</b></button><button class="${homePlayMode === "multiplayer" ? "selected" : ""}" data-home-mode="multiplayer"><i>◎</i><span><strong>친구랑하기</strong><small>친구와 실시간으로 협동합니다.</small></span><b>선택</b></button><button class="${homePlayMode === "ranked" ? "selected" : ""} ${currentAccount.ranked.eligible ? "" : "locked"}" data-home-mode="ranked" ${currentAccount.ranked.eligible ? "" : "disabled"}><i>♛</i><span><strong>랭크전</strong><small>${currentAccount.ranked.eligible ? `${currentAccount.ranked.seasonId} · 48시간 계약` : "혼자하기 노말 5 · 일반 10회 필요"}</small></span><b>${currentAccount.ranked.eligible ? "선택" : "잠김"}</b></button><button class="hide-seek-mode-option ${hideSeekLaunchGuideStep === "hide-seek-option" ? "launch-guide-target" : ""}" data-home-hide-seek><i>♧</i><span><strong>심야 술래잡기</strong><small>술래를 피해 열쇠 5개를 모아 탈출하세요.</small></span><b>입장</b></button></div><div class="home-invite"><label for="invite-code">친구 방 초대 코드</label><div><input class="code-input" id="invite-code" type="text" maxlength="8" value="${escapeHtml(profile.recentRoomCode)}" placeholder="8자리 코드"/><button data-home-join>참가</button></div></div></section>`,
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
      const applySelection = (): void => {
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
      };
      if (next !== "ranked" || homePlayMode === "ranked") {
        applySelection();
        return;
      }
      const notice = dismissibleModal(
        `<section class="panel compact ranked-fair-play-modal" role="dialog" aria-modal="true" aria-labelledby="ranked-fair-play-title"><span class="eyebrow">RANKED FAIR PLAY</span><h2 id="ranked-fair-play-title">랭크전 사전 안내</h2><div class="ranked-fair-play-points"><p><strong>캐릭터 고유 능력</strong><span>랭크전에서도 그대로 적용됩니다.</span></p><p><strong>스킨 추가 능력</strong><span>적용되지 않으며 외형만 사용됩니다.</span></p><p><strong>시즌 제약</strong><span>${escapeHtml(rankedSeasonRuleSummary(currentAccount.ranked.seasonId))}</span></p><p><strong>사망·중도 이탈</strong><span>기여도와 생존 시간에 따라 RP가 감소할 수 있습니다.</span></p></div><div class="purchase-confirm-actions"><button class="btn ghost" data-modal-close>취소</button><button class="btn gold" data-ranked-rules-confirm>확인하고 선택</button></div></section>`,
        "ranked-fair-play-overlay",
      );
      notice
        .querySelector<HTMLButtonElement>("[data-ranked-rules-confirm]")
        ?.addEventListener("click", () => {
          notice.remove();
          applySelection();
        });
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
  modal
    .querySelector("[data-home-hide-seek]")
    ?.addEventListener("click", () => {
      hideSeekLaunchGuideStep = null;
      app.querySelector("[data-home-mode-picker]")?.classList.remove("launch-guide-target");
      modal.remove();
      showHideSeekEntry();
    });
}

function showHideSeekEntry(): void {
  const modal = dismissibleModal(
    `<section class="home-picker-sheet hide-seek-entry-sheet" role="dialog" aria-modal="true" aria-labelledby="hide-seek-entry-title"><header><div><small>NIGHT CHASE</small><h2 id="hide-seek-entry-title">심야 술래잡기</h2></div><button data-modal-close aria-label="닫기"></button></header><div class="hide-seek-entry-hero"><img src="/assets/hide-seek/lantern-ghost-v2.webp" width="86" height="102" alt="랜턴을 든 술래잡기 귀신"/><div><strong>1명의 귀신, 최대 6명의 생존자</strong><p>20초 안에 숨고, 팀과 탐험 지도를 공유하며 열쇠 5개로 탈출로를 여세요.</p></div></div><button class="hide-seek-create" data-hide-seek-create>새 술래잡기 방 만들기</button><button class="hide-seek-quick-join" data-hide-seek-quick-join>빠른 참가</button><div class="home-invite hide-seek-invite"><label for="hide-seek-code">술래잡기 초대 코드</label><div><input class="code-input" id="hide-seek-code" type="text" maxlength="8" value="${escapeHtml(profile.recentRoomCode)}" placeholder="8자리 코드"/><button data-hide-seek-join>참가</button></div></div><ul class="hide-seek-entry-rules"><li>모든 이동속도 1배 · 카메라 확대/축소 없음</li><li>귀신 주변 360도 2칸 · 100초마다 불켜기</li><li>인원이 부족하면 방장이 봇으로 빈자리를 채울 수 있음</li></ul></section>`,
    "hide-seek-entry-modal",
  );
  const codeInput = modal.querySelector<HTMLInputElement>("#hide-seek-code");
  codeInput?.addEventListener("input", () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z2-9]/g, "");
  });
  modal.querySelector("[data-hide-seek-create]")?.addEventListener("click", () => {
    modal.remove();
    void createHideSeekRoom();
  });
  modal.querySelector("[data-hide-seek-quick-join]")?.addEventListener("click", () => {
    modal.remove();
    void quickJoinHideSeekRoom();
  });
  modal.querySelector("[data-hide-seek-join]")?.addEventListener("click", () => {
    const code = codeInput?.value.trim().toUpperCase() ?? "";
    if (!/^[A-Z2-9]{8}$/.test(code)) {
      toast("술래잡기 초대 코드 8자리를 확인해주세요.");
      return;
    }
    modal.remove();
    void joinHideSeekRoom(code);
  });
}

async function createHideSeekRoom(): Promise<void> {
  audio.play("button");
  connectionOverlay("술래잡기 방을 만드는 중…");
  try {
    const response = await fetch("/api/hide-seek/rooms", { method: "POST" });
    const data = (await response.json().catch(() => null)) as { code?: string; error?: string } | null;
    if (!response.ok || !data?.code) throw new Error(data?.error ?? "술래잡기 방을 만들지 못했습니다.");
    profile.recentRoomCode = data.code;
    saveProfile(profile);
    await connectToHideSeekRoom(data.code);
  } catch (error) {
    homeScreen();
    toast(error instanceof Error ? error.message : "술래잡기 서버에 연결할 수 없습니다.");
  }
}

async function quickJoinHideSeekRoom(): Promise<void> {
  audio.play("button");
  connectionOverlay("참가할 술래잡기 방을 찾는 중…");
  try {
    const response = await fetch("/api/hide-seek/quick-join", { method: "POST" });
    const data = (await response.json().catch(() => null)) as { code?: string; created?: boolean; error?: string } | null;
    if (!response.ok || !data?.code) throw new Error(data?.error ?? "참가할 술래잡기 방을 찾지 못했습니다.");
    profile.recentRoomCode = data.code;
    saveProfile(profile);
    await connectToHideSeekRoom(
      data.code,
      data.created ? "현재 입장 가능한 방이 없어 새로운 방을 생성합니다." : undefined,
    );
  } catch (error) {
    homeScreen();
    toast(error instanceof Error ? error.message : "빠른 참가를 완료하지 못했습니다.");
  }
}

async function joinHideSeekRoom(code: string): Promise<void> {
  audio.play("button");
  connectionOverlay("술래잡기 방을 확인하는 중…");
  try {
    const response = await fetch(`/api/hide-seek/rooms/${code}/status`, { cache: "no-store" });
    const data = (await response.json().catch(() => null)) as { exists?: boolean; phase?: string; joinable?: boolean; error?: string } | null;
    if (!response.ok || !data?.exists) throw new Error(data?.error ?? "존재하지 않는 술래잡기 방입니다.");
    if (data.phase !== "LOBBY") throw new Error("이미 추격이 시작된 술래잡기 방입니다.");
    if (data.joinable === false) throw new Error("술래잡기 방이 가득 찼습니다.");
    profile.recentRoomCode = code;
    saveProfile(profile);
    await connectToHideSeekRoom(code);
  } catch (error) {
    homeScreen();
    toast(error instanceof Error ? error.message : "술래잡기 방에 참가할 수 없습니다.");
  }
}

async function connectToHideSeekRoom(code: string, initialNotice?: string): Promise<void> {
  network?.close();
  network = null;
  game?.destroy();
  game = null;
  stopSocialRealtime();
  hideSeekExperience?.destroy();
  currentView = "hide-seek";
  audio.setBackgroundTrack("main");
  const tokenKey = `hide-seek:${code}`;
  profile.activeHideSeekRoomCode = code;
  saveProfile(profile);
  let mountHideSeekExperience: typeof import("./hideSeek").mountHideSeekExperience;
  try {
    ({ mountHideSeekExperience } = await import("./hideSeek"));
  } catch (error) {
    if (recoverFromStaleBundle(error)) return;
    throw error;
  }
  hideSeekExperience = mountHideSeekExperience({
    app,
    code,
    deviceId: profile.deviceId,
    reconnectToken: profile.reconnectTokens[tokenKey],
    onReconnectToken: (token) => {
      profile.reconnectTokens[tokenKey] = token;
      saveProfile(profile);
    },
    onExit: () => {
      hideSeekExperience = null;
      profile.activeHideSeekRoomCode = "";
      delete profile.reconnectTokens[tokenKey];
      saveProfile(profile);
      homeScreen();
    },
    inviteFriends: (roomCode) => {
      void showSocialHub("friends", roomCode, "hide-seek");
    },
    playSound: () => audio.play("button"),
    openSettings: showSettings,
    setBackgroundTrack: (track) => audio.setBackgroundTrack(track),
    setGhostFootstepLevel: (level) => audio.setGhostFootstepLevel(level),
    adFreeActive: Boolean(account?.adFree.active),
    prepareDoubleReward: async (matchId) => {
      if (account && isNativeApp && !account.adFree.active) {
        await prepareStageClearReward(account.id, matchId);
      }
    },
    claimReward: claimRecordedVictoryReward,
    initialNotice,
  });
}

async function claimRecordedVictoryReward(matchId: string, multiplier: 1 | 2): Promise<number> {
  const adFreeActive = Boolean(account?.adFree.active);
  let rewardedAdCompleted = false;
  if (multiplier === 2 && !adFreeActive) {
    if (!account) throw new Error("로그인이 필요합니다.");
    if (!isNativeApp) {
      throw new Error("Chrome·Safari·PWA에서는 AdMob 광고가 실행되지 않습니다. Google Play 또는 App Store에서 설치한 앱에서 이용해주세요.");
    }
    await showStageClearReward(account.id, matchId);
    rewardedAdCompleted = true;
  }
  let claim: Awaited<ReturnType<typeof claimMatchReward>> | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      claim = await claimMatchReward(matchId, multiplier, rewardedAdCompleted);
      break;
    } catch (error) {
      if (attempt >= 4 || !(error instanceof Error) || !error.message.includes("정산이 아직")) throw error;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 320));
    }
  }
  if (!claim) throw new Error("승리 포인트를 지급하지 못했습니다.");
  account = claim.profile;
  return claim.pointsAwarded;
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

function showNicknameEditor(profileModal: HTMLElement): void {
  if (!account) return;
  const currentNickname = account.nickname;
  const modal = dismissibleModal(
    `<section class="home-picker-sheet profile-nickname-sheet" role="dialog" aria-modal="true" aria-labelledby="profile-nickname-title"><header><div><small>EDIT PROFILE</small><h2 id="profile-nickname-title">닉네임 변경</h2></div><button data-modal-close aria-label="닫기">×</button></header><form class="profile-nickname-form"><label for="profile-nickname-input">새 닉네임</label><input id="profile-nickname-input" type="text" minlength="2" maxlength="12" autocomplete="nickname" value="${escapeHtml(currentNickname)}"/><p data-profile-nickname-status>현재 사용 중인 닉네임입니다.</p><button class="btn primary" type="submit" data-profile-nickname-save disabled>변경하기</button></form></section>`,
    "home-picker-modal profile-nickname-modal",
  );
  const input = modal.querySelector<HTMLInputElement>(
    "[id=profile-nickname-input]",
  );
  const status = modal.querySelector<HTMLElement>(
    "[data-profile-nickname-status]",
  );
  const save = modal.querySelector<HTMLButtonElement>(
    "[data-profile-nickname-save]",
  );
  const form = modal.querySelector<HTMLFormElement>(
    ".profile-nickname-form",
  );
  if (!input || !status || !save || !form) return;

  let validationTimer = 0;
  let validationSequence = 0;
  let availableNickname = "";
  const validate = (): void => {
    if (validationTimer) window.clearTimeout(validationTimer);
    const nickname = input.value.normalize("NFKC").trim();
    availableNickname = "";
    save.disabled = true;
    status.className = "";
    if (nickname === currentNickname) {
      status.textContent = "현재 사용 중인 닉네임입니다.";
      return;
    }
    if (nickname.length < 2 || nickname.length > 12) {
      status.textContent = "닉네임은 2~12자로 입력해주세요.";
      status.classList.add("error");
      return;
    }
    const sequence = ++validationSequence;
    status.textContent = "중복 여부를 확인하는 중…";
    validationTimer = window.setTimeout(() => {
      void checkNicknameAvailability(nickname)
        .then((result) => {
          if (sequence !== validationSequence || input.value.normalize("NFKC").trim() !== nickname)
            return;
          if (!result.available) {
            status.textContent = "이미 사용 중인 닉네임입니다.";
            status.className = "error";
            return;
          }
          availableNickname = result.nickname;
          status.textContent = "사용할 수 있는 닉네임입니다.";
          status.className = "available";
          save.disabled = false;
        })
        .catch((error) => {
          if (sequence !== validationSequence) return;
          status.textContent =
            error instanceof Error
              ? error.message
              : "닉네임을 확인하지 못했습니다.";
          status.className = "error";
        });
    }, 320);
  };
  input.addEventListener("input", validate);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!availableNickname || save.disabled) return;
    save.disabled = true;
    input.disabled = true;
    status.textContent = "닉네임을 저장하는 중…";
    void setNickname(availableNickname)
      .then((updated) => {
        account = updated;
        modal.remove();
        profileModal.remove();
        homeScreen();
        showProfileDisplayPicker();
        toast("닉네임을 변경했습니다.");
      })
      .catch((error) => {
        input.disabled = false;
        save.disabled = false;
        status.textContent =
          error instanceof Error
            ? error.message
            : "닉네임을 변경하지 못했습니다.";
        status.className = "error";
      });
  });
  window.setTimeout(() => input.focus(), 0);
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
  const profileFrame = `<img class="profile-prestige-frame" src="${profileFrameAssetUrl(currentAccount.prestige.profileFrameId)}" alt="프로필 테두리"/>`;
  const modal = dismissibleModal(
    `<section class="home-picker-sheet profile-display-sheet" role="dialog" aria-modal="true" aria-labelledby="profile-display-title"><header><div><small>PROFILE SETTINGS</small><h2 id="profile-display-title">프로필 설정</h2></div><button data-modal-close aria-label="닫기">×</button></header><section class="profile-photo-editor"><button type="button" class="profile-avatar-preview profile-avatar-edit-trigger" data-profile-avatar-picker aria-label="프로필 이미지와 테두리 변경"><img src="${escapeHtml(profileAvatarSource(currentAccount.profileAvatarUrl))}" alt="${escapeHtml(currentAccount.nickname)} 프로필 사진"/>${profileFrame}<span>변경</span></button><div class="profile-name-editor"><strong>${escapeHtml(currentAccount.nickname)}</strong><button type="button" data-profile-nickname-edit aria-label="닉네임 변경">✎</button></div></section><h3 class="profile-display-heading">인게임 라벨 설정</h3><p class="profile-display-intro">선택한 뱃지와 라벨은 모든 인게임 이름표에 표시됩니다. 플레이 방식과 전투 능력치는 바뀌지 않습니다.</p><div class="profile-display-options">${cards}</div><section class="profile-title-slot"><div><small>칭호</small><strong>칭호 없음</strong></div><p>시즌 보상이나 업적 칭호를 획득하면 이곳에서 표시할 칭호를 고를 수 있습니다.</p></section></section>`,
    "home-picker-modal profile-display-modal",
  );
  modal
    .querySelector<HTMLButtonElement>("[data-profile-nickname-edit]")
    ?.addEventListener("click", () => {
      audio.play("button");
      showNicknameEditor(modal);
    });
  modal.querySelector<HTMLButtonElement>('[data-profile-avatar-picker]')?.addEventListener('click', () => {
    audio.play('button');
    showProfileAssetPicker(modal);
  });
  modal
    .querySelectorAll<HTMLButtonElement>("[data-profile-display-mode]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const next = button.dataset.profileDisplayMode as ProfileDisplayMode;
        button.disabled = true;
        void withGlobalActionLoading('인게임 라벨 변경 중', () => setProfileDisplayMode(next))
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
    .querySelectorAll<HTMLButtonElement>('[data-prestige-profile-image]')
    .forEach((button) => button.addEventListener('click', () => {
      button.disabled = true;
      const profileImageId = button.dataset.prestigeProfileImage === 'moonlit'
        ? 'profile-image-moonlit-phantom-fox'
        : null;
      void withGlobalActionLoading('프로필 이미지 변경 중', () => setPrestigeLoadout({ profileImageId })).then((updated) => {
        account = updated;
        modal.remove();
        homeScreen();
        showProfileDisplayPicker();
      }).catch((error) => {
        button.disabled = false;
        toast(error instanceof Error ? error.message : '프로필 이미지를 변경하지 못했습니다.');
      });
    }));
  modal.querySelectorAll<HTMLButtonElement>('[data-prestige-profile-frame]').forEach((button) => {
    button.addEventListener('click', () => {
      button.disabled = true;
      const profileFrameId = button.dataset.prestigeProfileFrame === 'moonlit'
        ? 'profile-frame-moonlit-phantom-fox'
        : null;
      void withGlobalActionLoading('프로필 테두리 변경 중', () => setPrestigeLoadout({ profileFrameId })).then((updated) => {
        account = updated;
        modal.remove();
        homeScreen();
        showProfileDisplayPicker();
      }).catch((error) => {
        button.disabled = false;
        toast(error instanceof Error ? error.message : '프로필 테두리를 변경하지 못했습니다.');
      });
    });
  });
  modal
    .querySelector<HTMLInputElement>("[data-profile-photo-input]")
    ?.addEventListener("change", (event) => {
      const input = event.currentTarget as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      input.disabled = true;
      void withGlobalActionLoading('프로필 사진 저장 중', () => compactProfileAvatar(file)
        .then((avatarData) => setPrestigeLoadout({ profileImageId: null }).then(() => setProfileAvatar(avatarData))))
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
      void withGlobalActionLoading('기본 프로필 이미지 적용 중', () => setPrestigeLoadout({ profileImageId: null })
        .then(() => setProfileAvatar(null)))
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

function showProfileAssetPicker(parentModal?: HTMLElement): void {
  if (!account) return;
  const currentAccount = account;
  parentModal?.remove();
  const ownedAccessories = new Set(currentAccount.prestige.ownedAccessoryIds);
  const presets = [
    { id: 'profile-image-moonlit-phantom-fox', label: '월령 여우', image: '/assets/profile-images/moonlit-phantom-fox.webp?v=prestige-v2', packageId: MOONLIT_PHANTOM_PACKAGE_ID },
    { id: 'profile-image-starlit-cloud-rabbit', label: '성운 모모', image: '/assets/profile-images/starlit-cloud-rabbit.webp?v=prestige-v2', packageId: STARLIT_CLOUD_RABBIT_PACKAGE_ID },
    { id: 'profile-image-abyssal-knight-gorilla', label: '심연 콩', image: '/assets/profile-images/abyssal-knight-gorilla.webp?v=prestige-v2', packageId: ABYSSAL_KNIGHT_GORILLA_PACKAGE_ID },
  ].filter((entry) => ownedAccessories.has(entry.id));
  const frames = [
    { id: 'profile-frame-basic', label: '기본 테두리', image: '/assets/profile-images/basic-profile-frame.svg' },
    { id: 'profile-frame-moonlit-phantom-fox', label: '월령 여우불', image: '/assets/profile-images/moonlit-phantom-frame.png', packageId: MOONLIT_PHANTOM_PACKAGE_ID },
    { id: 'profile-frame-starlit-cloud-rabbit', label: '성운 프리즘', image: '/assets/profile-images/starlit-cloud-frame.webp?v=prestige-v2', packageId: STARLIT_CLOUD_RABBIT_PACKAGE_ID },
    { id: 'profile-frame-abyssal-knight-gorilla', label: '심연 흑염', image: '/assets/profile-images/abyssal-knight-frame.webp?v=prestige-v2', packageId: ABYSSAL_KNIGHT_GORILLA_PACKAGE_ID },
  ].filter((entry) => !entry.packageId || ownedAccessories.has(entry.id));
  const imageCards = `<label class="profile-asset-card upload"><span>＋</span><strong>내 사진</strong><small>사진 추가 또는 변경</small><input type="file" accept="image/jpeg,image/png,image/webp" data-profile-picker-upload/></label>
    <button type="button" class="profile-asset-card ${!currentAccount.prestige.profileImageId && !currentAccount.uploadedProfileAvatarUrl ? 'selected' : ''}" data-profile-picker-image="basic"><img src="${DEFAULT_PROFILE_AVATAR}" alt=""/><strong>기본 이미지</strong></button>
    ${currentAccount.uploadedProfileAvatarUrl ? `<button type="button" class="profile-asset-card ${!currentAccount.prestige.profileImageId ? 'selected' : ''}" data-profile-picker-image="photo"><img src="${escapeHtml(profileAvatarSource(currentAccount.uploadedProfileAvatarUrl))}" alt=""/><strong>내 사진</strong></button>` : ''}
    ${presets.map((entry) => `<button type="button" class="profile-asset-card ${currentAccount.prestige.profileImageId === entry.id ? 'selected' : ''}" data-profile-picker-image="${entry.id}"><img src="${entry.image}" alt=""/><strong>${entry.label}</strong></button>`).join('')}`;
  const frameCards = frames.map((entry) => `<button type="button" class="profile-asset-card frame ${currentAccount.prestige.profileFrameId === entry.id ? 'selected' : ''}" data-profile-picker-frame="${entry.id}"><span class="profile-frame-sample"><img src="${DEFAULT_PROFILE_AVATAR}" alt=""/><img src="${entry.image}" alt=""/></span><strong>${entry.label}</strong></button>`).join('');
  const modal = dismissibleModal(
    `<section class="profile-asset-picker-sheet" role="dialog" aria-modal="true" aria-labelledby="profile-asset-picker-title"><header><div><small>PROFILE CUSTOMIZE</small><h2 id="profile-asset-picker-title">프로필 꾸미기</h2></div><button type="button" data-modal-close aria-label="닫기">×</button></header><nav class="profile-asset-tabs"><button type="button" class="active" data-profile-picker-tab="image">이미지</button><button type="button" data-profile-picker-tab="frame">테두리</button></nav><section class="profile-asset-grid" data-profile-picker-panel="image">${imageCards}</section><section class="profile-asset-grid hidden" data-profile-picker-panel="frame">${frameCards}</section></section>`,
    'profile-asset-picker-modal',
  );
  modal.querySelectorAll<HTMLButtonElement>('[data-profile-picker-tab]').forEach((button) => button.addEventListener('click', () => {
    const tab = button.dataset.profilePickerTab;
    modal.querySelectorAll('[data-profile-picker-tab]').forEach((candidate) => candidate.classList.toggle('active', (candidate as HTMLElement).dataset.profilePickerTab === tab));
    modal.querySelectorAll<HTMLElement>('[data-profile-picker-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.profilePickerPanel !== tab));
  }));
  const reopen = (updated: AccountProfile) => {
    account = updated;
    modal.remove();
    homeScreen();
    showProfileDisplayPicker();
  };
  modal.querySelectorAll<HTMLButtonElement>('[data-profile-picker-image]').forEach((button) => button.addEventListener('click', () => {
    const choice = button.dataset.profilePickerImage;
    button.disabled = true;
    const selectImage = choice === 'basic' || choice === 'photo' ? null : choice;
    void withGlobalActionLoading('프로필 이미지 변경 중', () => choice === 'basic'
      ? setProfileAvatar(null).then(() => setPrestigeLoadout({ profileImageId: null }))
      : setPrestigeLoadout({ profileImageId: selectImage })).then(reopen).catch((error) => {
      button.disabled = false;
      toast(error instanceof Error ? error.message : '프로필 이미지를 변경하지 못했습니다.');
    });
  }));
  modal.querySelectorAll<HTMLButtonElement>('[data-profile-picker-frame]').forEach((button) => button.addEventListener('click', () => {
    button.disabled = true;
    void withGlobalActionLoading('프로필 테두리 변경 중', () =>
      setPrestigeLoadout({ profileFrameId: button.dataset.profilePickerFrame ?? 'profile-frame-basic' }),
    ).then(reopen).catch((error) => {
      button.disabled = false;
      toast(error instanceof Error ? error.message : '프로필 테두리를 변경하지 못했습니다.');
    });
  }));
  modal.querySelector<HTMLInputElement>('[data-profile-picker-upload]')?.addEventListener('change', (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.disabled = true;
    void withGlobalActionLoading('프로필 사진 저장 중', () => compactProfileAvatar(file)
      .then(setProfileAvatar)
      .then(() => setPrestigeLoadout({ profileImageId: null })))
      .then(reopen)
      .catch((error) => {
      input.disabled = false;
      toast(error instanceof Error ? error.message : '프로필 사진을 저장하지 못했습니다.');
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
  type RankingMode = "solo" | "multiplayer" | "ranked";
  let activeMode: RankingMode = "ranked";
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
  const modal = dismissibleModal(
    `<section class="home-picker-sheet ranking-sheet" role="dialog" aria-modal="true" aria-labelledby="ranking-title"><header><div><small>RANKING</small><h2 id="ranking-title">랭킹</h2></div><button data-modal-close aria-label="닫기">×</button></header><nav class="ranking-tabs" aria-label="랭킹 모드"><button class="active" data-ranking-mode="ranked">랭크전</button><button data-ranking-mode="solo">혼자하기</button><button data-ranking-mode="multiplayer">친구랑하기</button></nav><div class="ranking-my-record ranked-my-record" data-ranking-my-record></div><p class="ranking-notice" data-ranking-notice></p><ol class="ranked-leaderboard" data-ranked-leaderboard><li>순위를 불러오는 중…</li></ol><div class="ranked-reward-strip" data-ranked-rewards><span>1위 · 금 왕관</span><span>2~5위 · 은 왕관</span><span>6~20위 · 동 왕관</span></div></section>`,
    "home-picker-modal ranking-modal",
  );
  const board = modal.querySelector<HTMLOListElement>("[data-ranked-leaderboard]");
  const myRecord = modal.querySelector<HTMLElement>("[data-ranking-my-record]");
  const notice = modal.querySelector<HTMLElement>("[data-ranking-notice]");
  const rewards = modal.querySelector<HTMLElement>("[data-ranked-rewards]");
  const renderMyRecord = (mode: RankingMode) => {
    if (!myRecord || !notice || !rewards) return;
    if (mode === "ranked") {
      const hasPlayed = currentAccount.ranked.contractsPlayed > 0;
      const tier = hasPlayed ? currentAccount.ranked.tier : "bronze";
      const label = hasPlayed ? RANKED_TIER_LABEL[tier] : "배치 전";
      myRecord.innerHTML = `${profileAvatarHtml(currentAccount.profileAvatarUrl, "ranking-my-avatar profile-avatar", currentAccount.prestige.profileFrameId)}<span class="ranking-my-tier"><img src="${hasPlayed ? rankedBadgeImage(tier) : rankBadgeImage("beginner")}" alt="${label}"/></span><div><small>내 랭크전 등급</small><strong>${escapeHtml(currentAccount.nickname)}</strong><p>${label}${hasPlayed ? ` · ${currentAccount.ranked.rating.toLocaleString()} RP` : ""} · 배치 ${Math.min(5, currentAccount.ranked.placementCompleted)}/5</p></div>`;
      notice.textContent = "4주 시즌 · 48시간 계약 14개 · 최고 8개 점수 반영 · 첫 5판 배치전";
      rewards.hidden = false;
      return;
    }
    const isSolo = mode === "solo";
    const xp = isSolo ? currentAccount.soloXp : currentAccount.multiplayerXp;
    const rank = isSolo ? currentAccount.soloRank : currentAccount.multiplayerRank;
    const stageIndex = isSolo ? currentAccount.soloStageIndex : currentAccount.multiplayerStageIndex;
    myRecord.innerHTML = `${profileAvatarHtml(currentAccount.profileAvatarUrl, "ranking-my-avatar profile-avatar", currentAccount.prestige.profileFrameId)}<span class="ranking-my-tier"><img src="${rankBadgeImage(rank)}" alt="${rankLabel(rank)}"/></span><div><small>내 ${isSolo ? "혼자하기" : "친구랑하기"} 등급</small><strong>${escapeHtml(currentAccount.nickname)}</strong><p>${rankLabel(rank)} · ${xp.toLocaleString()} XP · 최고 ${getStage(stagesThrough(stageIndex).at(-1)?.id ?? "easy-1").label}</p></div>`;
    notice.textContent = `${isSolo ? "혼자하기" : "친구랑하기"} 누적 XP 순위 · 최고 스테이지와 승리 기록을 함께 반영합니다.`;
    rewards.hidden = true;
  };
  const renderBoard = (mode: RankingMode) => {
    if (!board) return;
    activeMode = mode;
    modal.querySelectorAll<HTMLButtonElement>("[data-ranking-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.rankingMode === mode);
    });
    renderMyRecord(mode);
    board.innerHTML = "<li>순위를 불러오는 중…</li>";
    const endpoint = mode === "ranked" ? "/api/ranked/season" : `/api/rankings/${mode}`;
    void fetch(endpoint)
      .then(async (response) => response.ok ? response.json() as Promise<{ leaderboard?: Array<{ accountId: string; avatarUrl: string | null; profileFrameId?: string | null; rank: number; nickname: string; rating?: number; xp?: number; tier: RankId | keyof typeof RANKED_TIER_LABEL; stageIndex?: number; }> }> : Promise.reject(new Error("랭킹 조회 실패")))
      .then((data) => {
        if (!board || activeMode !== mode) return;
        board.innerHTML = data.leaderboard?.length
          ? data.leaderboard.map((entry) => {
            const isRanked = mode === "ranked";
            const placementCrown = isRanked ? crownForPlacement(entry.rank) : null;
            const crownImage = placementCrown ? `<img class="leader-crown" src="/assets/ranks/crown-${placementCrown}.png" alt="${entry.rank}위 왕관"/>` : "";
            const tierName = isRanked ? RANKED_TIER_LABEL[entry.tier as keyof typeof RANKED_TIER_LABEL] : rankLabel(entry.tier as RankId);
            const badge = isRanked ? rankedBadgeImage(entry.tier as keyof typeof RANKED_TIER_LABEL) : rankBadgeImage(entry.tier as RankId);
            const score = isRanked ? `${Math.max(0, entry.rating ?? 0).toLocaleString()} RP` : `${Math.max(0, entry.xp ?? 0).toLocaleString()} XP`;
            return `<li><button type="button" data-ranking-profile="${escapeHtml(entry.accountId)}" aria-label="${escapeHtml(entry.nickname)} 프로필 보기"><div class="leader-first"><b class="leader-place">${entry.rank}</b>${profileAvatarHtml(entry.avatarUrl, "leader-avatar profile-avatar", entry.profileFrameId)}<span class="leader-name">${escapeHtml(entry.nickname)}${crownImage}</span></div><span class="leader-tier"><img src="${badge}" alt="${escapeHtml(tierName)}"/><strong>${score}</strong></span></button></li>`;
          }).join("")
          : `<li>${mode === "ranked" ? "아직 기록된 시즌 계약이 없습니다." : "아직 기록된 플레이어가 없습니다."}</li>`;
        board.querySelectorAll<HTMLButtonElement>("[data-ranking-profile]").forEach((button) => button.addEventListener("click", () => showRankingProfile(button.dataset.rankingProfile ?? "")));
      })
      .catch(() => {
        if (board && activeMode === mode) board.innerHTML = "<li>순위를 불러오지 못했습니다.</li>";
      });
  };
  modal.querySelectorAll<HTMLButtonElement>("[data-ranking-mode]").forEach((button) => button.addEventListener("click", () => renderBoard(button.dataset.rankingMode as RankingMode)));
  renderBoard("ranked");
}

function showRankingProfile(accountId: string): void {
  if (!accountId) return;
  const modal = dismissibleModal(
    `<section class="home-picker-sheet ranking-profile-sheet" role="dialog" aria-modal="true" aria-labelledby="ranking-profile-title"><header><div><small>PLAYER PROFILE</small><h2 id="ranking-profile-title">플레이어 프로필</h2></div><button data-modal-close aria-label="닫기">×</button></header><div class="ranking-profile-content" data-ranking-profile-content><div class="spinner" aria-hidden="true"></div><p>프로필을 불러오는 중…</p></div></section>`,
    "home-picker-modal ranking-profile-modal",
  );
  const content = modal.querySelector<HTMLElement>("[data-ranking-profile-content]");
  void fetch(`/api/rankings/profile/${encodeURIComponent(accountId)}`)
    .then(async (response) => response.ok ? response.json() as Promise<{ profile: { avatarUrl: string | null; profileFrameId?: string | null; nickname: string; victories: number; solo: { xp: number; tier: RankId; stageIndex: number }; multiplayer: { xp: number; tier: RankId; stageIndex: number }; ranked: { rating: number; tier: keyof typeof RANKED_TIER_LABEL; contractsPlayed: number } } }> : Promise.reject(new Error("프로필 조회 실패")))
    .then(({ profile }) => {
      if (!content) return;
      const stageLabel = (index: number) => getStage(stagesThrough(index).at(-1)?.id ?? "easy-1").label;
      content.innerHTML = `<div class="ranking-profile-identity">${profileAvatarHtml(profile.avatarUrl, "ranking-profile-avatar profile-avatar", profile.profileFrameId)}<div><strong>${escapeHtml(profile.nickname)}</strong><small>총 승리 ${profile.victories.toLocaleString()}회</small></div></div><div class="ranking-profile-stats"><article><img src="${rankBadgeImage(profile.solo.tier)}" alt="${rankLabel(profile.solo.tier)}"/><div><small>혼자하기</small><strong>${rankLabel(profile.solo.tier)}</strong><span>${profile.solo.xp.toLocaleString()} XP · ${stageLabel(profile.solo.stageIndex)}</span></div></article><article><img src="${rankBadgeImage(profile.multiplayer.tier)}" alt="${rankLabel(profile.multiplayer.tier)}"/><div><small>친구랑하기</small><strong>${rankLabel(profile.multiplayer.tier)}</strong><span>${profile.multiplayer.xp.toLocaleString()} XP · ${stageLabel(profile.multiplayer.stageIndex)}</span></div></article><article><img src="${rankedBadgeImage(profile.ranked.tier)}" alt="${RANKED_TIER_LABEL[profile.ranked.tier]}"/><div><small>랭크전</small><strong>${profile.ranked.contractsPlayed ? RANKED_TIER_LABEL[profile.ranked.tier] : "배치 전"}</strong><span>${profile.ranked.contractsPlayed ? `${profile.ranked.rating.toLocaleString()} RP` : "시즌 기록 없음"}</span></div></article></div>`;
    })
    .catch(() => {
      if (content) content.innerHTML = "<p>프로필을 불러오지 못했습니다.</p>";
    });
}

type LockerSlot = CosmeticSlot | 'emote';
type LockerSection = 'character' | 'skin' | 'decorate' | 'item';
type ShopCatalogSlot = CosmeticSlot | "item" | PresentationCategory;
type CatalogPrimarySection = 'character' | 'skin' | 'decorate' | 'item';

const CUSTOM_SLOT_LABELS: Record<LockerSlot, string> = {
  character: "캐릭터",
  skin: "스킨",
  tile: "타일",
  turret: "포탑",
  emote: "이모티콘",
};

const SHOP_SLOT_LABELS: Record<ShopCatalogSlot, string> = {
  character: CUSTOM_SLOT_LABELS.character,
  skin: CUSTOM_SLOT_LABELS.skin,
  tile: CUSTOM_SLOT_LABELS.tile,
  turret: CUSTOM_SLOT_LABELS.turret,
  item: "아이템",
  nameplate: "명찰",
  background: "배경",
};

const CATALOG_PRIMARY_SECTIONS: readonly [CatalogPrimarySection, string][] = [
  ['character', '캐릭터'],
  ['skin', '스킨'],
  ['decorate', '꾸미기'],
  ['item', '아이템'],
];

const SKIN_SUBSECTIONS: readonly [Extract<CosmeticSlot, 'skin' | 'tile' | 'turret'>, string][] = [
  ['skin', '캐릭터'],
  ['tile', '타일'],
  ['turret', '포탑'],
];

const DECORATE_SUBSECTIONS: readonly [PresentationCategory, string][] = [
  ['nameplate', '명찰'],
  ['background', '배경'],
];

function primarySectionForSlot(slot: ShopCatalogSlot): CatalogPrimarySection {
  if (slot === 'skin' || slot === 'tile' || slot === 'turret') return 'skin';
  if (slot === 'nameplate' || slot === 'background') return 'decorate';
  return slot;
}

function catalogPrimaryTabs(
  active: CatalogPrimarySection,
  target: 'shop' | 'locker',
): string {
  const attribute = target === 'shop' ? 'data-shop-primary' : 'data-locker-section';
  return `<div class="catalog-primary-tabs" role="tablist">${CATALOG_PRIMARY_SECTIONS.map(([section, label]) => `<button type="button" class="custom-tab ${section === active ? 'active' : ''}" ${attribute}="${section}">${label}</button>`).join('')}</div>`;
}

function catalogSubTabs(slot: ShopCatalogSlot, target: 'shop' | 'locker'): string {
  const primary = primarySectionForSlot(slot);
  if (primary === 'skin') {
    const attribute = target === 'shop' ? 'data-shop-slot' : 'data-locker-skin-slot';
    return `<div class="catalog-sub-tabs" role="tablist">${SKIN_SUBSECTIONS.map(([section, label]) => `<button type="button" class="${section === slot ? 'active' : ''}" ${attribute}="${section}">${label}</button>`).join('')}</div>`;
  }
  if (primary === 'decorate') {
    const attribute = target === 'shop' ? 'data-shop-slot' : 'data-effect-category';
    return `<div class="catalog-sub-tabs" role="tablist">${DECORATE_SUBSECTIONS.map(([section, label]) => `<button type="button" class="${section === slot ? 'active' : ''}" ${attribute}="${section}">${label}</button>`).join('')}</div>`;
  }
  return '';
}

function catalogNavigation(slot: ShopCatalogSlot, target: 'shop' | 'locker'): string {
  const primary = primarySectionForSlot(slot);
  return `${catalogPrimaryTabs(primary, target)}${catalogSubTabs(slot, target)}`;
}

function tilePreviewUrl(tileSkinId: string | undefined): string {
  return (
    tileSkinTextureUrl(tileSkinId) ??
    "/assets/environment/hospital-room-tile-v2.png"
  );
}

const TURRET_ART_VERSION = 'prestige-evolution-v2-20260807';

const PRESTIGE_TURRET_HQ_PREVIEW_BY_ID: Readonly<Record<string, string>> = {
  'turret-basic-moonlit-foxfire': '/assets/turret-skins/skin-moonlit-foxfire/preview-hq.webp',
  'turret-basic-starlit-cloud': '/assets/turret-skins/skin-starlit-cloud/preview-hq.webp',
  'turret-basic-abyssal-knight': '/assets/turret-skins/skin-abyssal-knight/preview-hq.webp',
};

function turretPreviewAssetUrl(turretSkinId: string | undefined): string {
  if (!turretSkinId) return '/assets/buildings/cute-basic-turret-1.png';
  return PRESTIGE_TURRET_HQ_PREVIEW_BY_ID[turretSkinId]
    ?? turretSkinAssetUrl(turretSkinId, 1)
    ?? '/assets/buildings/cute-basic-turret-1.png';
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
    const previewUrl = turretPreviewAssetUrl(turretSkinId);
    return `<div class="custom-avatar-stage turret-skin-preview-stage" data-avatar-preview><button type="button" class="turret-level-preview-trigger" data-turret-levels-open data-turret-skin-id="${escapeHtml(turretSkinId ?? '')}">레벨별 외형 보기</button><img data-turret-preview src="${previewUrl}?v=${TURRET_ART_VERSION}" alt="선택한 포탑 스킨 Lv.1 미리보기"/><span>레벨별 외형 적용</span></div>`;
  }
  return `<div class="custom-avatar-stage ${turretMode ? "turret-stage" : ""}" data-avatar-preview>${characterViewSwitchMarkup()}</div>`;
}

function showTurretLevelGallery(turretSkinId: string): void {
  const item = cosmeticById(turretSkinId);
  if (!item || item.slot !== 'turret') return;
  const maxLevel = item.prestige ? 17 : 15;
  const cards = Array.from({ length: maxLevel }, (_, index) => {
    const level = index + 1;
    const imageUrl = turretSkinAssetUrl(item.id, level) ?? '/assets/buildings/cute-basic-turret-1.png';
    return `<article class="turret-level-gallery-card"><div><img src="${imageUrl}?v=${TURRET_ART_VERSION}" alt="${escapeHtml(item.label)} Lv.${level} 외형" loading="lazy" decoding="async"/></div><strong>Lv.${level}</strong></article>`;
  }).join('');
  dismissibleModal(
    `<section class="turret-level-gallery-sheet" role="dialog" aria-modal="true" aria-labelledby="turret-level-gallery-title"><header><div><small>TURRET EVOLUTION</small><h2 id="turret-level-gallery-title">${escapeHtml(item.label)}</h2><p>레벨마다 달라지는 포탑 외형을 확인하세요.</p></div><button type="button" data-modal-close aria-label="닫기">×</button></header><div class="turret-level-gallery-grid">${cards}</div></section>`,
    'turret-level-gallery-modal',
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

type LockerRoute = LockerSection | LockerSlot | PresentationCategory;

function customizationScreen(activeSlot: LockerRoute = "character"): void {
  if (activeSlot === 'decorate' || activeSlot === 'nameplate' || activeSlot === 'background') {
    effectsLockerScreen(activeSlot === 'background' ? 'background' : 'nameplate');
    return;
  }
  if (activeSlot === 'item') {
    itemLockerScreen();
    return;
  }
  if (activeSlot === 'emote') {
    emoteLockerScreen();
    return;
  }
  if (activeSlot === 'tile' || activeSlot === 'turret') {
    cosmeticCollectionScreen("customize", activeSlot, undefined, 'skin');
    return;
  }
  cosmeticCollectionScreen("customize", activeSlot === 'skin' ? 'skin' : 'character', undefined, activeSlot === 'skin' ? 'skin' : 'character');
}

function itemLockerScreen(): void {
  if (!account) return authScreen();
  const currentAccount = account;
  const randomBoxes = currentAccount.randomBoxes;
  const randomBoxCard = randomBoxes.remaining > 0
    ? `<article class="locker-item-card random-box-owned-card"><div class="locker-item-art"><img src="${releaseVersionedAsset('/assets/items/rewards/candle-coin-chest.png')}" alt="심야 랜덤 상자"/></div><div><span>DAILY DRAW</span><strong>심야 랜덤 상자</strong><small>오늘 게임에서 열 수 있는 남은 횟수</small></div><b>${randomBoxes.remaining}회</b></article>`
    : '';
  const supplyCards = SHOP_CONSUMABLES.flatMap((item) => {
    const quantity = currentAccount.consumables.find((owned) => owned.itemId === item.id)?.quantity ?? 0;
    return quantity > 0
      ? [`<article class="locker-item-card"><div class="locker-item-art"><img data-supply-art="${item.id}" alt="${escapeHtml(item.label)} 이미지"/></div><div><span>TACTICAL SUPPLY</span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.description)}</small></div><b>${quantity}개</b></article>`]
      : [];
  }).join('');
  const ownedCards = `${randomBoxCard}${supplyCards}`;
  setContent('customize', `<main class="custom-screen owned-custom-screen item-locker-screen catalog-item-screen"><div class="custom-backdrop"></div><header class="custom-header"><button class="custom-back" data-custom-back aria-label="홈으로">‹</button><div><span>MY LOCKER</span><h2>내 보관함</h2></div></header><section class="catalog-item-shell locker-items-shell"><nav class="catalog-item-navigation locker-nav">${catalogPrimaryTabs('item', 'locker')}</nav><div class="catalog-item-scroll locker-item-scroll"><header class="locker-items-heading"><span>OWNED ITEMS</span><h3>내 아이템</h3><p>현재 보유한 랜덤 상자와 전술 보급 수량입니다.</p></header><div class="locker-items-list">${ownedCards || '<p class="empty-collection locker-items-empty">보유한 아이템이 없습니다.<br/>상점에서 랜덤 상자와 전술 보급을 획득할 수 있습니다.</p>'}</div></div></section></main>`);
  hydrateCatalogArt(app, {
    appearance: currentAccount.appearance,
    turretSkins: currentAccount.turretSkins,
  });
  app.querySelector('[data-custom-back]')?.addEventListener('click', homeScreen);
  bindLockerPrimaryNavigation();
}

function bindLockerPrimaryNavigation(): void {
  app.querySelectorAll<HTMLButtonElement>('[data-locker-section]').forEach((button) => {
    button.addEventListener('click', () => customizationScreen(button.dataset.lockerSection as LockerSection));
  });
}

function presentationBackgroundUrl(id: string | null | undefined): string {
  const regular = presentationById(id);
  if (regular?.category === 'background') return regular.backgroundUrl ?? regular.imageUrl;
  const prestige = PRESTIGE_ACCESSORIES.find((item) => item.id === id && item.category === 'background');
  return prestige?.imageUrl ?? '/assets/cinematic/cute-haunted-hospital-lobby-v1.webp';
}

function nameplateInlineStyle(id: string | null | undefined): string {
  const nameplate = presentationById(id)
    ?? PRESTIGE_ACCESSORIES.find((item) => item.id === id && item.category === 'nameplate');
  return nameplate?.category === 'nameplate'
    ? ` style="--game-nameplate-image:url('${escapeHtml(releaseVersionedAsset(nameplate.imageUrl))}')"`
    : '';
}

function homePresentationPreviewMarkup(
  currentAccount: AccountProfile,
  backgroundId: string | null | undefined,
  nameplateId: string | null | undefined,
  stageClass: string,
): string {
  const backgroundUrl = presentationBackgroundUrl(backgroundId);
  const resolvedNameplateId = nameplateId ?? 'nameplate-basic';
  return `<div class="${stageClass} home-presentation-stage" style="--preview-home-background:url('${escapeHtml(backgroundUrl)}')"><div class="home-presentation-avatar">${homePoseMarkup(currentAccount.appearance, 'home-pose-avatar preview-home-pose')}</div><strong class="game-nameplate ${resolvedNameplateId}"${nameplateInlineStyle(nameplateId)}>${escapeHtml(currentAccount.nickname)}</strong></div>`;
}

function emoteLockerScreen(): void {
  effectsLockerScreen('emote');
}

type LockerEffectCategory = 'nameplate' | 'background' | 'emote';

function effectsLockerScreen(activeCategory: LockerEffectCategory = 'nameplate'): void {
  if (!account) return authScreen();
  const currentAccount = account;
  const owned = new Set(currentAccount.prestige.ownedAccessoryIds);
  const items = [...PRESTIGE_ACCESSORIES, ...PRESENTATION_CATALOG]
    .filter((item) => item.category === activeCategory && owned.has(item.id));
  const equippedEmotes = new Set(currentAccount.prestige.equippedEmoteIds);
  const cards = items.map((item) => {
    const selected = item.category === 'nameplate'
      ? currentAccount.prestige.nameplateId === item.id
      : item.category === 'background'
        ? currentAccount.prestige.homeBackgroundId === item.id
        : equippedEmotes.has(item.id);
    const action = item.category === 'emote' ? (selected ? '장착 해제' : '장착') : (selected ? '장착 중' : '장착');
    const detail = 'detail' in item ? item.detail : item.description;
    return `<article class="effect-locker-card ${selected ? 'selected previewing' : ''} ${item.category === 'nameplate' ? 'nameplate-effect-card' : ''}" data-effect-preview="${item.id}" tabindex="0"><img src="${escapeHtml(releaseVersionedAsset(item.imageUrl))}" alt="${escapeHtml(item.label)}"/><div><small>${escapeHtml(detail)}</small><strong>${escapeHtml(item.label)}</strong></div><button type="button" data-effect-equip="${item.id}" ${selected && item.category !== 'emote' ? 'disabled' : ''}>${action}</button></article>`;
  }).join('');
  const equippedPreviewId = activeCategory === 'nameplate'
    ? currentAccount.prestige.nameplateId
    : activeCategory === 'background'
      ? currentAccount.prestige.homeBackgroundId
      : currentAccount.prestige.equippedEmoteIds[0];
  const initialPreview = items.find((item) => item.id === equippedPreviewId) ?? items[0];
  const initialBackgroundId = activeCategory === 'background' ? initialPreview?.id : currentAccount.prestige.homeBackgroundId;
  const initialNameplateId = activeCategory === 'nameplate' ? initialPreview?.id : currentAccount.prestige.nameplateId;
  setContent('customize', `<main class="custom-screen owned-custom-screen effect-locker-screen"><div class="custom-backdrop"></div><header class="custom-header"><button class="custom-back" data-custom-back aria-label="이전 화면">‹</button><div><span>MY LOCKER</span><h2>내 보관함</h2></div></header><section class="custom-layout"><aside class="custom-preview effect-preview"><div data-effect-preview-host>${homePresentationPreviewMarkup(currentAccount, initialBackgroundId, initialNameplateId, 'effect-preview-stage')}</div><div><strong data-effect-preview-title>${escapeHtml(initialPreview?.label ?? '기본 연출')}</strong><small data-effect-preview-copy>${escapeHtml(initialPreview ? ('detail' in initialPreview ? initialPreview.detail : initialPreview.description) : '홈 화면과 인게임에 표시되는 모습을 확인하세요.')}</small></div></aside><section class="custom-catalog locker-catalog has-locker-subtabs"><nav class="locker-nav">${catalogNavigation(activeCategory === 'emote' ? 'nameplate' : activeCategory, 'locker')}</nav><div class="effect-locker-grid">${cards || '<p class="empty-collection">보유한 꾸미기 상품이 없습니다.<br/>상점 또는 구슬 교환에서 획득할 수 있습니다.</p>'}</div></section></section></main>`);
  app.querySelector('[data-custom-back]')?.addEventListener('click', homeScreen);
  bindLockerPrimaryNavigation();
  app.querySelectorAll<HTMLButtonElement>('[data-effect-category]').forEach((button) => button.addEventListener('click', () => effectsLockerScreen(button.dataset.effectCategory as LockerEffectCategory)));
  const showEffectPreview = (id: string): void => {
    const item = items.find((entry) => entry.id === id);
    const host = app.querySelector<HTMLElement>('[data-effect-preview-host]');
    if (!item || !host) return;
    const backgroundId = activeCategory === 'background' ? item.id : currentAccount.prestige.homeBackgroundId;
    const nameplateId = activeCategory === 'nameplate' ? item.id : currentAccount.prestige.nameplateId;
    host.innerHTML = homePresentationPreviewMarkup(currentAccount, backgroundId, nameplateId, 'effect-preview-stage');
    setText('[data-effect-preview-title]', item.label);
    setText('[data-effect-preview-copy]', 'detail' in item ? item.detail : item.description);
    app.querySelectorAll<HTMLElement>('[data-effect-preview]').forEach((card) => card.classList.toggle('previewing', card.dataset.effectPreview === id));
  };
  app.querySelectorAll<HTMLElement>('[data-effect-preview]').forEach((card) => {
    const select = (): void => showEffectPreview(card.dataset.effectPreview ?? '');
    card.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('[data-effect-equip]')) return;
      select();
    });
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      select();
    });
  });
  app.querySelectorAll<HTMLButtonElement>('[data-effect-equip]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.effectEquip ?? '';
    const item = [...PRESTIGE_ACCESSORIES, ...PRESENTATION_CATALOG].find((entry) => entry.id === id);
    if (!item) return;
    const next = item.category === 'emote'
      ? (equippedEmotes.has(id) ? currentAccount.prestige.equippedEmoteIds.filter((entry) => entry !== id) : [...currentAccount.prestige.equippedEmoteIds, id].slice(-4))
      : undefined;
    button.disabled = true;
    void withGlobalActionLoading('연출 장착 변경 중', () => setPrestigeLoadout({
      ...(item.category === 'nameplate' ? { nameplateId: id } : {}),
      ...(item.category === 'background' ? { homeBackgroundId: id } : {}),
      ...(item.category === 'emote' ? { emoteIds: next } : {}),
    })).then((updated) => {
      account = updated;
      effectsLockerScreen(activeCategory);
    }).catch((error) => {
      button.disabled = false;
      toast(error instanceof Error ? error.message : '연출 장착을 변경하지 못했습니다.');
    });
  }));
}

function shopScreen(
  activeSlot: ShopCatalogSlot = "character",
  previewItemId?: string,
): void {
  if (currentView !== "shop") supplyShopReturnView = "home";
  if (activeSlot === "item") {
    supplyShopScreen();
    return;
  }
  if (activeSlot === 'nameplate' || activeSlot === 'background') {
    presentationShopScreen(activeSlot, previewItemId);
    return;
  }
  cosmeticCollectionScreen("shop", activeSlot, previewItemId);
}

function bindShopPrimaryNavigation(): void {
  app.querySelectorAll<HTMLButtonElement>('[data-shop-primary]').forEach((button) => {
    button.addEventListener('click', () => {
      const section = button.dataset.shopPrimary as CatalogPrimarySection;
      if (section === 'skin') shopScreen('skin');
      else if (section === 'decorate') shopScreen('nameplate');
      else shopScreen(section);
    });
  });
}

function showCashRequired(message: string): void {
  const modal = dismissibleModal(
    `<section class="panel compact purchase-confirm" role="dialog" aria-modal="true" aria-labelledby="cash-required-title"><span class="eyebrow">CASH REQUIRED</span><h2 id="cash-required-title">캐시가 부족합니다</h2><p class="subtitle">${escapeHtml(message)}</p><div class="purchase-confirm-actions"><button class="btn ghost" data-modal-close>취소</button><button class="btn gold" data-open-cash-shop>캐시 충전</button></div></section>`,
    'purchase-confirm-modal',
  );
  modal.querySelector('[data-open-cash-shop]')?.addEventListener('click', () => {
    modal.remove();
    cashShopScreen();
  });
}

function presentationShopScreen(
  activeCategory: PresentationCategory,
  previewItemId?: string,
): void {
  if (!account) return authScreen();
  const currentAccount = account;
  const items = presentationsForCategory(activeCategory);
  const selected = items.find((item) => item.id === previewItemId) ?? items[0];
  const owned = new Set(currentAccount.prestige.ownedAccessoryIds);
  const cards = items.map((item) => {
    const isOwned = owned.has(item.id);
    const priceLabel = item.currency === 'cash'
      ? `${item.price.toLocaleString()} C`
      : `${item.price.toLocaleString()} P`;
    return `<article class="presentation-card catalog-card ${selected?.id === item.id ? 'previewing' : ''} ${isOwned ? 'owned' : ''}" data-presentation-preview="${item.id}" tabindex="0">
      <div class="presentation-card-art ${item.category}"><img src="${escapeHtml(releaseVersionedAsset(item.imageUrl))}" alt="${item.category === 'nameplate' ? `${escapeHtml(item.label)} 빈 명찰 디자인` : `${escapeHtml(item.label)} 배경`}" loading="lazy" decoding="async"/></div>
      <div class="presentation-card-copy"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.description)}</small></div>
      <button type="button" class="${isOwned ? '' : item.currency === 'cash' ? 'cash-currency-button' : 'point-currency-button'}" data-presentation-buy="${item.id}" ${isOwned ? 'disabled' : ''}>${isOwned ? '보유 중' : priceLabel}</button>
    </article>`;
  }).join('');
  const selectedBackground = selected?.category === 'background' ? selected : undefined;
  const selectedNameplate = selected?.category === 'nameplate' ? selected : undefined;
  const initialBackgroundId = selectedBackground?.id ?? currentAccount.prestige.homeBackgroundId;
  const initialNameplateId = selectedNameplate?.id ?? currentAccount.prestige.nameplateId;
  setContent('shop', `<main class="custom-screen shop-screen presentation-shop-screen"><div class="custom-backdrop"></div><header class="custom-header"><button class="custom-back" data-presentation-back aria-label="홈으로">‹</button><div><span>SHOP</span><h2>외형 상점</h2></div><div class="presentation-wallets"><strong><i>C</i>${currentAccount.cash.toLocaleString()}</strong><strong>✦ ${currentAccount.customPoints.toLocaleString()} P</strong></div></header><section class="custom-layout"><aside class="custom-preview presentation-preview"><div data-presentation-preview-host>${homePresentationPreviewMarkup(currentAccount, initialBackgroundId, initialNameplateId, 'presentation-preview-stage')}</div><div><strong data-presentation-preview-title>${escapeHtml(selected?.label ?? '')}</strong><small data-presentation-preview-copy>${escapeHtml(selected?.description ?? '')}</small></div></aside><section class="custom-catalog has-catalog-subtabs"><nav>${catalogNavigation(activeCategory, 'shop')}</nav><div class="presentation-grid">${cards}</div></section></section></main>`);
  app.querySelector('[data-presentation-back]')?.addEventListener('click', homeScreen);
  bindShopPrimaryNavigation();
  app.querySelectorAll<HTMLButtonElement>('[data-shop-slot]').forEach((button) => button.addEventListener('click', () => {
    shopScreen(button.dataset.shopSlot as ShopCatalogSlot);
  }));
  const showPresentationPreview = (id: string): void => {
    const item = items.find((entry) => entry.id === id);
    const host = app.querySelector<HTMLElement>('[data-presentation-preview-host]');
    if (!item || !host) return;
    host.innerHTML = homePresentationPreviewMarkup(
      currentAccount,
      item.category === 'background' ? item.id : currentAccount.prestige.homeBackgroundId,
      item.category === 'nameplate' ? item.id : currentAccount.prestige.nameplateId,
      'presentation-preview-stage',
    );
    setText('[data-presentation-preview-title]', item.label);
    setText('[data-presentation-preview-copy]', item.description);
    app.querySelectorAll<HTMLElement>('[data-presentation-preview]').forEach((card) => card.classList.toggle('previewing', card.dataset.presentationPreview === id));
  };
  app.querySelectorAll<HTMLElement>('[data-presentation-preview]').forEach((card) => {
    const open = (): void => showPresentationPreview(card.dataset.presentationPreview ?? '');
    card.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('[data-presentation-buy]')) return;
      open();
    });
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open();
    });
  });
  app.querySelectorAll<HTMLButtonElement>('[data-presentation-buy]').forEach((button) => button.addEventListener('click', () => {
    const item = presentationById(button.dataset.presentationBuy);
    if (!item) return;
    if (item.currency === 'cash' && currentAccount.cash < item.price) {
      showCashRequired(`보유 ${currentAccount.cash.toLocaleString()} C · ${item.price.toLocaleString()} C가 필요합니다.`);
      return;
    }
    const purchase = (): void => {
      void withGlobalActionLoading(`${item.label} 구매 중`, () => purchasePresentation(item.id)).then((updated) => {
        account = updated;
        presentationShopScreen(activeCategory, item.id);
        toast(`${item.label}을(를) 구매했습니다.`);
      }).catch((error) => toast(error instanceof Error ? error.message : '연출 상품을 구매하지 못했습니다.'));
    };
    if (item.currency === 'points') {
      confirmPointPurchase({ label: item.label, pointCost: item.price, onConfirm: purchase });
      return;
    }
    const modal = dismissibleModal(`<section class="panel compact purchase-confirm" role="dialog" aria-modal="true"><span class="eyebrow">CASH PURCHASE</span><h2>구매하시겠습니까?</h2><p class="subtitle"><strong>${escapeHtml(item.label)}</strong>을(를) 구매합니다.</p><div class="purchase-confirm-cost cash"><i>C</i> ${item.price.toLocaleString()}</div><div class="purchase-confirm-actions"><button class="btn ghost" data-modal-close>취소</button><button class="btn cash-currency-button" data-presentation-confirm>구매하기</button></div></section>`, 'purchase-confirm-modal');
    modal.querySelector('[data-presentation-confirm]')?.addEventListener('click', () => { modal.remove(); purchase(); });
  }));
}

function openLobbySupplyShop(): void {
  supplyShopReturnView = "lobby";
  supplyShopScreen();
}

function supplyShopScreen(): void {
  if (!account) {
    authScreen();
    return;
  }
  const currentAccount = account;
  const randomBox = currentAccount.randomBoxes;
  const randomBoxClaimLabel = randomBox.refillsClaimed >= randomBox.maxRefills
    ? '오늘 수령 완료'
    : currentAccount.adFree.active
      ? '즉시 수령'
      : '<span class="random-box-ad-icon" aria-hidden="true">▶</span><span>광고 시청하고 수령</span>';
  const randomBoxCard = `<article class="supply-card catalog-card random-box-shop-card"><div class="catalog-art supply-art"><img class="ready" src="${releaseVersionedAsset('/assets/items/rewards/candle-coin-chest.png')}" alt="심야 랜덤 상자"/></div><div class="supply-copy"><span>DAILY DRAW</span><strong>심야 랜덤 상자</strong><p>오늘 무료 ${randomBox.remaining}회 보유 · 광고 1회당 ${randomBox.refillAmount}회 보충</p></div><div class="supply-actions"><small>오늘 추가 수령 ${randomBox.refillsClaimed}/${randomBox.maxRefills}</small><button type="button" class="random-box-claim" data-random-box-claim ${randomBox.refillsClaimed >= randomBox.maxRefills ? 'disabled' : ''}>${randomBoxClaimLabel}</button></div></article>`;
  const supplyCards = SHOP_CONSUMABLES.map((item) => {
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
  const cards = randomBoxCard + supplyCards;
  setContent(
    "shop",
    `<main class="custom-screen shop-screen supply-shop-screen catalog-item-screen"><div class="custom-backdrop"></div><header class="custom-header"><button class="custom-back" data-supply-back aria-label="스토어에서 나가기">‹</button><div><span>SHOP</span><h2>외형 상점</h2></div><div class="custom-wallet"><small>보유 포인트</small><strong>✦ ${currentAccount.customPoints.toLocaleString()} P</strong></div></header><section class="catalog-item-shell supply-items-shell"><nav class="catalog-item-navigation supply-shop-tabs">${catalogPrimaryTabs('item', 'shop')}</nav><div class="catalog-item-scroll supply-item-scroll"><section class="supply-brief"><div><span class="eyebrow">TACTICAL SUPPLY</span><h3>전술 보급 아이템</h3><p>구매한 수량만큼 보관되며, 실제 전투에서 사용할 때만 차감됩니다.</p></div></section><section class="supply-grid">${cards}</section></div></section></main>`,
  );
  hydrateCatalogArt(app, {
    appearance: currentAccount.appearance,
    turretSkins: currentAccount.turretSkins,
  });
  app
    .querySelector("[data-supply-back]")
    ?.addEventListener("click", () => {
      if (supplyShopReturnView === "lobby" && snapshot?.status === "LOBBY") {
        supplyShopReturnView = "home";
        lobbyScreen(snapshot);
        return;
      }
      supplyShopReturnView = "home";
      shopScreen();
    });
  bindShopPrimaryNavigation();
  app.querySelector<HTMLButtonElement>('[data-random-box-claim]')?.addEventListener('click', (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    void (async () => {
      try {
        const rewardedAdCompleted = currentAccount.adFree.active
          ? false
          : devMode
            ? true
            : await showRandomBoxReward(currentAccount.id).then(() => true);
        account = await withGlobalActionLoading('랜덤 상자 수령 중', () => claimRandomBoxRefill(rewardedAdCompleted));
        supplyShopScreen();
        toast(`랜덤 상자 ${randomBox.refillAmount}회를 받았습니다.`);
      } catch (error) {
        button.disabled = false;
        toast(error instanceof Error ? error.message : '랜덤 상자를 받지 못했습니다.');
      }
    })();
  });
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
  lockerSection?: LockerSection,
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
  const resolvedLockerSection: LockerSection = lockerSection ?? (selectedSlot === 'character' ? 'character' : 'skin');
  const lockerHasSubtabs = !shopping && resolvedLockerSection === 'skin';
  const tabs = shopping
    ? catalogNavigation(selectedSlot, 'shop')
    : catalogNavigation(selectedSlot, 'locker');
  const catalog = cosmeticsForSlot(selectedSlot).filter(
    (item) =>
      (shopping || cosmeticEntitled(item, currentAccount)) &&
      (!shopping || cosmeticVisibleInPointShop(item)) &&
      (!shopping || storefrontThemeVisible(item.id, currentAccount)) &&
      (selectedSlot !== "tile" || item.id !== DEFAULT_TILE_SKIN_ID) &&
      (selectedSlot !== "turret" ||
        item.id === CYBERPUNK_LASER_TURRET_SKIN_ID ||
        item.id === SPECIAL_OPS_TRACKER_TURRET_SKIN_ID ||
        item.id === SURFER_WATER_TURRET_SKIN_ID ||
        item.id === LIFEGUARD_PARASOL_TURRET_SKIN_ID ||
        (!shopping && item.prestige === true)),
  );
  const displayCatalog =
    selectedSlot === "turret"
      ? [...catalog].sort((left, right) => {
          if (left.id === SPECIAL_OPS_TRACKER_TURRET_SKIN_ID) return -1;
          if (right.id === SPECIAL_OPS_TRACKER_TURRET_SKIN_ID) return 1;
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
              POLICE_ENFORCER_CROCO_SKIN_ID,
              SECRET_AGENT_MONKEY_SKIN_ID,
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
        : !shopping && selectedSlot === "skin"
          ? [...catalog].sort((left, right) => {
              // The locker is a collection: show the most valuable skins
              // first, rather than preserving authoring order.  Keep this
              // independent from point price because rank/reward skins do
              // not have a price.
              const grade = (item: CosmeticDefinition): number => {
                if (item.prestige) return 5;
                if (item.premium) return 4;
                if (item.unlock.kind === "rank") return 3;
                if (item.unlock.kind === "reward") return 2;
                if (item.unlock.kind === "points") return 1;
                return 0;
              };
              const gradeDelta = grade(right) - grade(left);
              if (gradeDelta !== 0) return gradeDelta;
              if (left.unlock.kind === "points" && right.unlock.kind === "points")
                return right.unlock.price - left.unlock.price;
              return left.label.localeCompare(right.label, "ko");
            })
          : catalog;
  const preferredPreviewId =
    selectedSlot === "skin"
      ? POLICE_ENFORCER_CROCO_SKIN_ID
      : selectedSlot === "tile"
        ? CYBERPUNK_NEON_TILE_SKIN_ID
        : selectedSlot === "turret"
          ? CYBERPUNK_LASER_TURRET_SKIN_ID
          : undefined;
  const initialCatalogPreviewId = shopping
    ? displayCatalog.find((item) => item.id === previewItemId)?.id
      ?? displayCatalog.find((item) => item.id === preferredPreviewId)?.id
      ?? displayCatalog[0]?.id
    : previewItemId;
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
      const premiumPoliceCroco = item.id === POLICE_ENFORCER_CROCO_SKIN_ID;
      const premiumSecretMonkey = item.id === SECRET_AGENT_MONKEY_SKIN_ID;
      const prestigePackageImage =
        item.id === MOONLIT_PHANTOM_SKIN_ID
          ? '/assets/prestige/moonlit-phantom-fox/featured-package.webp'
          : item.id === STARLIT_CLOUD_RABBIT_SKIN_ID
            ? '/assets/prestige/starlit-cloud-rabbit/featured-package.png'
            : item.id === ABYSSAL_KNIGHT_GORILLA_SKIN_ID
              ? '/assets/prestige/abyssal-knight-gorilla/featured-package.webp'
              : undefined;
      const prestigeSkin = Boolean(prestigePackageImage);
      const premiumSkin =
        premiumSurfer
        || premiumLifeguard
        || premiumNeonLulu
        || premiumCyberKong
        || premiumPoliceCroco
        || premiumSecretMonkey
        || prestigeSkin;
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
      // The collection is the source of truth for storefront presentation.
      // In particular, rank rewards can remain owned after the visible rank
      // changes, and must not be presented as an unlockable reward again.
      if (shopping && owned) {
        action = null;
        status = "보유 중";
      } else if (shopping && requiresCharacter) {
        action = null;
        status = "캐릭터 구매 필요";
        locked = true;
      } else if (shopping && item.unlock.kind === "points" && !owned) {
        action = "purchase";
        status = `${item.unlock.price.toLocaleString()} P`;
      } else if (shopping && item.unlock.kind === "cash" && !owned) {
        action = "purchase";
        status = `${item.unlock.price.toLocaleString()} C`;
      } else if (shopping && item.unlock.kind === "rank" && !entitled) {
        status = `${rankLabel(item.unlock.rank)} 해금`;
        locked = true;
      } else if (shopping && item.unlock.kind === "rank") {
        status = "등급 보상";
      } else if (shopping && item.unlock.kind === "starter") {
        status = "기본 지급";
      } else if (!shopping && requiresCharacter) {
        action = null;
        status = item.id === MOONLIT_PHANTOM_SKIN_ID
          ? "별여우 초롱 해금 필요"
          : `${cosmeticById(item.characterId ?? "")?.label ?? "캐릭터"} 해금 필요`;
        locked = true;
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
      const purchaseCurrencyClass = action === 'purchase' && item.unlock.kind === 'cash'
        ? 'cash-currency-button'
        : action === 'purchase' && item.unlock.kind === 'points'
          ? 'point-currency-button'
          : '';
      const actionButton = action
        ? `<button class="${purchaseCurrencyClass}" data-cosmetic-action="${action}" data-cosmetic-id="${item.id}">${status}</button>`
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
      const authoredStandardSkinPose =
        item.slot === "skin" && item.characterId && !item.assetDirectory
          ? homePoseAsset({
              character: item.characterId,
              skin: item.id,
              tileSkin: appearance.tileSkin,
            })
          : undefined;
      const authoredStandardSkinStyle = authoredStandardSkinPose
        ? [
            `background-image:url('${authoredStandardSkinPose.atlasUrl}')`,
            `background-size:${authoredStandardSkinPose.frameColumns * 100}% 500%`,
            `background-position:0% ${authoredStandardSkinPose.row * 25}%`,
          ].join(";")
        : "";
      const art =
        item.slot === "tile"
          ? `<div class="catalog-art cosmetic-art tile-skin-card-art" style="--swatch:${item.swatch}"><img class="ready" src="${tilePreviewUrl(item.id)}?v=${APP_RELEASE_VERSION}" alt="${escapeHtml(item.label)} 타일 미리보기" /></div>`
            : authoredTurretArt
            ? `<div class="catalog-art cosmetic-art turret-skin-card-art" style="--swatch:${item.swatch}"><img class="ready" src="${authoredTurretArt}?v=${TURRET_ART_VERSION}" alt="${escapeHtml(item.label)} Lv.1 미리보기" />${traitLabel ? `<span class="trait-ribbon">${escapeHtml(traitLabel)}</span>` : ""}</div>`
            : prestigePackageImage
              ? `<div class="catalog-art cosmetic-art prestige-package-card-art"><img class="ready" src="${prestigePackageImage}?v=${APP_RELEASE_VERSION}" alt="${escapeHtml(item.label)} 프레스티지 대표 이미지" loading="lazy" decoding="async" />${traitLabel ? `<span class="trait-ribbon">${escapeHtml(traitLabel)}</span>` : ""}</div>`
            : premiumSurfer
              ? `<div class="catalog-art cosmetic-art surfer-mong-card-art" style="--swatch:${item.swatch}"><span class="surfer-mong-card-sprite" role="img" aria-label="${escapeHtml(item.label)} 대표 이미지"></span>${traitLabel ? `<span class="trait-ribbon">${escapeHtml(traitLabel)}</span>` : ""}</div>`
              : premiumLifeguard
                ? `<div class="catalog-art cosmetic-art lifeguard-raon-card-art" style="--swatch:${item.swatch}"><span class="lifeguard-raon-card-sprite" role="img" aria-label="${escapeHtml(item.label)} 대표 이미지"></span>${traitLabel ? `<span class="trait-ribbon">${escapeHtml(traitLabel)}</span>` : ""}</div>`
                : premiumNeonLulu
                  ? `<div class="catalog-art cosmetic-art neon-rider-lulu-card-art" style="--swatch:${item.swatch}"><span class="neon-rider-lulu-card-sprite" role="img" aria-label="${escapeHtml(item.label)} 대표 이미지"></span>${traitLabel ? `<span class="trait-ribbon">${escapeHtml(traitLabel)}</span>` : ""}</div>`
                  : premiumCyberKong
                    ? `<div class="catalog-art cosmetic-art cyber-driver-kong-card-art" style="--swatch:${item.swatch}"><span class="cyber-driver-kong-card-sprite" role="img" aria-label="${escapeHtml(item.label)} 대표 이미지"></span>${traitLabel ? `<span class="trait-ribbon">${escapeHtml(traitLabel)}</span>` : ""}</div>`
                    : premiumPoliceCroco
                      ? `<div class="catalog-art cosmetic-art police-enforcer-croco-card-art" style="--swatch:${item.swatch}"><span class="police-enforcer-croco-card-sprite" role="img" aria-label="${escapeHtml(item.label)} 대표 이미지"></span>${traitLabel ? `<span class="trait-ribbon">${escapeHtml(traitLabel)}</span>` : ""}</div>`
                      : premiumSecretMonkey
                        ? `<div class="catalog-art cosmetic-art secret-agent-monkey-card-art" style="--swatch:${item.swatch}"><span class="secret-agent-monkey-card-sprite" role="img" aria-label="${escapeHtml(item.label)} 대표 이미지"></span>${traitLabel ? `<span class="trait-ribbon">${escapeHtml(traitLabel)}</span>` : ""}</div>`
                      : authoredStandardSkinPose
                        ? `<div class="catalog-art cosmetic-art standard-skin-card-art" style="--swatch:${item.swatch}"><span class="standard-skin-card-sprite" style="${authoredStandardSkinStyle}" role="img" aria-label="${escapeHtml(item.label)} 대표 이미지"></span>${traitLabel ? `<span class="trait-ribbon">${escapeHtml(traitLabel)}</span>` : ""}</div>`
                : `<div class="catalog-art cosmetic-art" style="--swatch:${item.swatch}"><img data-cosmetic-art="${item.id}" alt="${escapeHtml(item.label)} 인게임 미리보기" />${traitLabel ? `<span class="trait-ribbon">${escapeHtml(traitLabel)}</span>` : ""}</div>`;
      const premiumBadge = prestigeSkin
        ? '<span class="prestige-badge" aria-label="프레스티지 스킨">PRESTIGE</span>'
        : premiumSkin
          ? '<span class="cosmetic-new-badge" aria-label="신규 스킨">NEW</span>'
          : "";
      return `<article class="cosmetic-card catalog-card ${selected ? "selected" : ""} ${locked ? "locked" : ""} ${initiallyPreviewed ? "previewing" : ""} ${premiumSkin ? "premium-skin-card" : ""} ${prestigeSkin ? "prestige-package-card" : ""} ${premiumSurfer ? "surfer-mong-card" : ""} ${premiumLifeguard ? "lifeguard-raon-card" : ""} ${premiumNeonLulu ? "neon-rider-lulu-card" : ""} ${premiumCyberKong ? "cyber-driver-kong-card" : ""} ${premiumPoliceCroco ? "police-enforcer-croco-card" : ""} ${premiumSecretMonkey ? "secret-agent-monkey-card" : ""}" data-cosmetic-preview="${item.id}" tabindex="0">${premiumBadge}${art}<div class="cosmetic-copy"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(traitDescription)}</small></div><div class="cosmetic-card-action">${actionButton}</div></article>`;
    })
    .join("");
  const character = cosmeticById(appearance.character);
  const activeSkin = cosmeticById(appearance.skin);
  const initialTilePreviewId = shopping
    ? initialCatalogPreviewId
    : (previewItemId ??
      displayCatalog.find((item) => item.id === appearance.tileSkin)?.id ??
      displayCatalog[0]?.id);
  const initialTurretPreviewId = shopping
    ? initialCatalogPreviewId
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
        ? initialCatalogPreviewId
          ? cosmeticById(initialCatalogPreviewId)
          : undefined
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
  const rankedCosmeticNotice =
    shopping && (selectedSlot === "skin")
      ? `<aside class="ranked-cosmetic-notice" role="note"><div><span>랭크전에서는 캐릭터 고유 능력만 적용되며, 스킨의 능력치 상승 효과는 적용되지 않습니다.</span></div></aside>`
      : "";
  setContent(
    screen,
    `<main class="custom-screen ${shopping ? "shop-screen" : "owned-custom-screen"}"><div class="custom-backdrop"></div><header class="custom-header"><button class="custom-back" data-custom-back aria-label="이전 화면">‹</button><div><span>${shopping ? "SHOP" : "MY LOCKER"}</span><h2>${shopping ? "외형 상점" : "내 보관함"}</h2></div><div class="custom-wallet"><small>보유 포인트</small><strong>✦ ${currentAccount.customPoints.toLocaleString()} P</strong></div></header><section class="custom-layout"><aside class="custom-preview">${modelPreviewHtml(turretMode, tileMode ? initialPreviewItem?.id : undefined, turretMode ? initialTurret?.id : undefined, tileMode)}<div><strong data-custom-preview-title>${tileMode && !initialPreviewItem ? "기본 타일 사용 중" : turretMode ? escapeHtml(initialTurret?.label ?? "수호포 · 병동형") : escapeHtml(initialPreviewItem?.label ?? activeSkin?.label ?? character?.label ?? currentAccount.nickname)}</strong><small data-custom-preview-copy>${tileMode && !initialPreviewItem ? "타일 스킨을 보유하면 이곳에서 장착할 수 있습니다." : turretMode ? escapeHtml(initialTurretTrait?.description ?? "기본 수호 포탑 Lv.1 외형입니다.") : escapeHtml(initialPreviewItem?.description ?? activeSkin?.description ?? initialTrait.description)}</small></div></aside><section class="custom-catalog ${shopping ? "" : "locker-catalog"} ${shopping && primarySectionForSlot(selectedSlot) === 'skin' ? 'has-catalog-subtabs' : ''} ${lockerHasSubtabs ? "has-locker-subtabs" : ""} ${rankedCosmeticNotice ? "has-ranked-notice" : ""}"><nav${shopping ? "" : ' class="locker-nav"'}>${tabs}</nav>${rankedCosmeticNotice}<div class="cosmetic-grid ${cards ? "" : "is-empty"}">${cards || `<p class="empty-collection">${selectedSlot === "turret" ? "보유한 포탑 스킨이 없습니다." : selectedSlot === "tile" ? "보유한 타일 스킨이 없습니다." : "보유한 캐릭터의<br/>완성형 스킨은 여기에 표시됩니다."}</p>`}</div></section></section></main>`,
  );
  hydrateCatalogArt(app, {
    appearance,
    turretSkins: currentAccount.turretSkins,
  });
  const previewHost = app.querySelector<HTMLElement>("[data-avatar-preview]");
  const bindAvatarViewButtons = (): void => {
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
  };
  const mountCharacterPreview = (previewAppearance: AvatarAppearance): void => {
    if (!previewHost) return;
    customAvatarPreview?.destroy();
    customAvatarPreview = null;
    const previousPrestigeVideo = previewHost.querySelector<HTMLVideoElement>("[data-prestige-locker-video]");
    if (previousPrestigeVideo) stopPrestigeLockerPreviewVideo(previousPrestigeVideo);
    // An equipped prestige skin remains the active preview when entering the
    // point shop, even though prestige products themselves are not sold there.
    const prestigeVideoUrl = prestigeLockerPreviewVideoUrl(previewAppearance.skin);
    const prestigePosterUrl = prestigeLockerPreviewPosterUrl(previewAppearance.skin);
    const prestigeLabel =
      PRESTIGE_LOCKER_PREVIEW_LABEL_BY_SKIN[previewAppearance.skin] ?? "프레스티지 스킨";
    previewHost.classList.toggle("prestige-locker-video-stage", Boolean(prestigeVideoUrl));
    previewHost.innerHTML = prestigeVideoUrl
      ? prestigeLockerPreviewVideoMarkup(prestigeVideoUrl, prestigePosterUrl, prestigeLabel)
      : characterViewSwitchMarkup();
    if (prestigeVideoUrl) {
      const video = previewHost.querySelector<HTMLVideoElement>("[data-prestige-locker-video]");
      if (video) {
        video.addEventListener("error", () => {
          previewHost.classList.add("prestige-locker-video-unavailable");
        }, { once: true });
        startPrestigeLockerPreviewVideo(video);
      }
      return;
    }
    customAvatarPreview = new AvatarPreview2D(
      previewHost,
      previewAppearance,
      currentAccount.displayRank,
    );
    bindAvatarViewButtons();
  };
  if (previewHost && !tileMode && !turretMode) {
    mountCharacterPreview(initialPreviewAppearance);
  }
  const showPreview = (itemId: string): void => {
    const item = cosmeticById(itemId);
    if (!item) return;
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
        turretPreview.src = `${turretPreviewAssetUrl(item.id)}?v=${TURRET_ART_VERSION}`;
        turretPreview.alt = `${item.label} Lv.1 미리보기`;
      }
      const galleryButton = app.querySelector<HTMLButtonElement>('[data-turret-levels-open]');
      if (galleryButton) galleryButton.dataset.turretSkinId = item.id;
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
      mountCharacterPreview(previewAppearance);
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
            ? item.id === MOONLIT_PHANTOM_SKIN_ID
              ? "별여우 초롱을 해금해야 장착할 수 있습니다."
              : `${cosmeticById(item.characterId)?.label ?? "해당 캐릭터"}을 해금해야 장착할 수 있습니다.`
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
  app.querySelector<HTMLButtonElement>('[data-turret-levels-open]')?.addEventListener('click', (event) => {
    event.stopPropagation();
    const button = event.currentTarget as HTMLButtonElement;
    showTurretLevelGallery(button.dataset.turretSkinId ?? '');
  });
  app.querySelector("[data-custom-back]")?.addEventListener("click", () => {
    if (!shopping && customizeReturnView === "room-menu") roomMenu();
    else if (
      shopping &&
      supplyShopReturnView === "lobby" &&
      snapshot?.status === "LOBBY"
    ) {
      supplyShopReturnView = "home";
      lobbyScreen(snapshot);
    }
    else homeScreen();
  });
  if (shopping) {
    bindShopPrimaryNavigation();
    app.querySelectorAll<HTMLButtonElement>('[data-shop-slot]').forEach((button) => {
      button.addEventListener('click', () => shopScreen(button.dataset.shopSlot as ShopCatalogSlot));
    });
  } else {
    bindLockerPrimaryNavigation();
    app.querySelectorAll<HTMLButtonElement>('[data-locker-skin-slot]').forEach((button) => {
      button.addEventListener('click', () => customizationScreen(button.dataset.lockerSkinSlot as 'skin' | 'tile' | 'turret'));
    });
  }
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
        if (action === "purchase" && item.unlock.kind === "cash") {
          if (currentAccount.cash < item.unlock.price) {
            showCashRequired(`보유 ${currentAccount.cash.toLocaleString()} C · ${item.unlock.price.toLocaleString()} C가 필요합니다.`);
            return;
          }
          const modal = dismissibleModal(
            `<section class="panel compact purchase-confirm" role="dialog" aria-modal="true"><span class="eyebrow">PREMIUM SKIN</span><h2>구매하시겠습니까?</h2><p class="subtitle"><strong>${escapeHtml(item.label)}</strong>을(를) 구매합니다.</p><div class="purchase-confirm-cost cash"><i>C</i> ${item.unlock.price.toLocaleString()}</div><div class="purchase-confirm-actions"><button class="btn ghost" data-modal-close>취소</button><button class="btn cash-currency-button" data-premium-confirm>구매하기</button></div></section>`,
            'purchase-confirm-modal',
          );
          modal.querySelector('[data-premium-confirm]')?.addEventListener('click', () => {
            modal.remove();
            void withGlobalActionLoading(`${item.label} 구매 중`, () => purchaseCosmetic(itemId)).then((updated) => {
              account = updated;
              shopScreen(selectedSlot, itemId);
              toast('프리미엄 스킨을 구매했습니다.');
            }).catch((error) => toast(error instanceof Error ? error.message : '프리미엄 스킨을 구매하지 못했습니다.'));
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

function continueAfterAuthentication(next: AccountProfile): void {
  account = next;
  homePlayMode = next.selectedPlayMode;
  profile.nickname = next.nickname;
  profile.mustReauthenticate = false;
  saveProfile(profile);
  if (!next.tutorialCompleted) {
    loading();
    void createRoom(true, "tutorial-1");
    return;
  }
  homeScreen();
}

function googleNicknameScreen(
  signupToken: string,
  suggestedNickname = "",
  errorMessage = "",
  provider: "google" | "apple" = "google",
): void {
  setContent(
    "auth",
    `<main class="auth-screen"><div class="auth-backdrop" aria-hidden="true"></div><header class="auth-logo"><span>GOOGLE SURVIVOR</span><h1>심야 병동</h1><p>게임에서 사용할 이름을 정하면<br>첫 생존 훈련이 바로 시작됩니다.</p></header><section class="auth-sheet google-nickname-sheet"><div class="auth-heading"><small>ONE LAST STEP</small><h2>닉네임 설정</h2></div><form id="google-nickname-form" class="auth-form"><div class="auth-control"><label for="google-nickname">게임 닉네임</label><div><input id="google-nickname" type="text" minlength="2" maxlength="12" autocomplete="nickname" value="${escapeHtml(suggestedNickname)}" placeholder="2~12자 닉네임" required /></div></div><p class="auth-inline-error" data-nickname-error ${errorMessage ? "" : "hidden"}>${escapeHtml(errorMessage)}</p><button class="auth-submit" type="submit">가입완료</button></form><button class="auth-switch" type="button" data-google-cancel><span>다른 계정으로 로그인할까요?</span><strong>돌아가기</strong></button></section><footer class="auth-footnote">중복되지 않은 닉네임만 사용할 수 있습니다.</footer></main>`,
  );
  const input = app.querySelector<HTMLInputElement>("#google-nickname");
  input?.focus();
  app.querySelector("[data-google-cancel]")?.addEventListener("click", () => {
    void signOutGoogle().finally(() => authScreen());
  });
  app
    .querySelector<HTMLFormElement>("#google-nickname-form")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      const nickname = input?.value.trim() ?? "";
      connectionOverlay("닉네임 중복을 확인하는 중…");
      void (provider === "apple" ? completeAppleSignup(signupToken, nickname) : completeGoogleSignup(signupToken, nickname))
        .then(continueAfterAuthentication)
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : "닉네임을 저장하지 못했습니다.";
          googleNicknameScreen(signupToken, nickname, message);
        });
    });
}

function authScreen(mode: "login" | "register" = "login"): void {
  const registering = mode === "register";
  const googleIconMarkup = '<div class="gsi-material-button-state"></div><div class="gsi-material-button-content-wrapper"><div class="gsi-material-button-icon"><svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" xmlns:xlink="http://www.w3.org/1999/xlink" style="display: block;" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path><path fill="none" d="M0 0h48v48H0z"></path></svg></div><span>Google로 계속하기</span></div>';
  const googleControl = `<button class="auth-google gsi-material-button" type="button" data-google-login aria-label="Google 계정으로 로그인" title="Google 계정으로 로그인">${googleIconMarkup}</button>`;
  const appleControl = appleLoginAvailable ? '<button class="auth-apple" type="button" data-apple-login aria-label="Apple로 계속하기" title="Apple로 계속하기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.68 12.18c-.02-2.16 1.76-3.21 1.84-3.26-.99-1.45-2.54-1.65-3.09-1.68-1.31-.14-2.56.77-3.23.77-.68 0-1.71-.75-2.81-.73-1.44.02-2.79.85-3.53 2.15-1.53 2.64-.39 6.52 1.08 8.67.74 1.05 1.6 2.22 2.73 2.18 1.1-.05 1.51-.7 2.84-.7 1.32 0 1.69.7 2.85.67 1.19-.02 1.94-1.05 2.65-2.11.85-1.2 1.19-2.39 1.2-2.45-.03-.01-2.29-.87-2.53-3.51ZM14.55 5.85c.6-.75 1.01-1.77.89-2.8-.87.04-1.96.6-2.59 1.33-.56.65-1.06 1.7-.93 2.69.98.08 1.99-.5 2.63-1.22Z"/></svg><span>Apple로 계속하기</span></button>' : '';
  const googleButton = `<div class="auth-social-divider"><span>또는</span></div><div class="auth-social-actions">${googleControl}${appleControl}</div>`;
  setContent(
    "auth",
    `<main class="auth-screen ${registering ? "registering" : "logging-in"}"><div class="auth-backdrop" aria-hidden="true"></div><header class="auth-logo"><i aria-hidden="true">☾</i><span>MIDNIGHT WARD</span><h1>심야 병동</h1><p>문이 닫히기 전에 방을 찾고,<br/>오늘 밤을 함께 버텨보세요.</p></header><section class="auth-sheet"><i class="auth-sheet-handle" aria-hidden="true"></i><div class="auth-heading"><small>${registering ? "NEW SURVIVOR" : "SURVIVOR CHECK-IN"}</small><h2>${registering ? "새 생존자 등록" : "병동 체크인"}</h2><p>${registering ? "새 계정을 만들고 첫 생존 훈련을 시작하세요." : "저장된 계정으로 오늘의 생존 임무를 이어가세요."}</p></div><form id="auth-form" class="auth-form"><div class="auth-control"><label for="username">아이디</label><div><input id="username" type="text" minlength="4" maxlength="20" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="email" placeholder="영문 소문자·숫자 4~20자" /></div></div>${registering ? '<div class="auth-control"><label for="nickname">게임 닉네임</label><div><input id="nickname" type="text" minlength="2" maxlength="12" autocomplete="nickname" placeholder="게임에서 표시할 이름" /></div></div>' : ""}<div class="auth-control"><label for="password">비밀번호</label><div><input id="password" type="password" minlength="8" maxlength="72" autocomplete="${registering ? "new-password" : "current-password"}" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="email" placeholder="8자 이상" /><button type="button" class="auth-reveal" data-password-reveal aria-label="비밀번호 표시">보기</button></div></div><button class="auth-submit" type="submit"><span>${registering ? "생존자 등록" : "병동 입장"}</span><i aria-hidden="true">›</i></button></form>${googleButton}<button class="auth-switch" type="button" data-auth-tab="${registering ? "login" : "register"}" aria-label="${registering ? "로그인" : "새 계정"}"><span>${registering ? "이미 등록한 생존자인가요?" : "처음 병동에 왔나요?"}</span><strong>${registering ? "로그인" : "새 계정 만들기"}</strong></button></section><footer class="auth-footnote">진행도와 등급은 계정에 안전하게 저장됩니다.</footer></main>`,
  );
  const handleGoogleResult = (result: Awaited<ReturnType<typeof signInWithGoogle>>): void => {
    if (result.status === "nickname-required") {
      googleNicknameScreen(result.signupToken, result.suggestedNickname);
      return;
    }
    continueAfterAuthentication(result.profile);
  };
  const handleGoogleError = (error: unknown): void => {
    authScreen(mode);
    toast(error instanceof Error ? error.message : "Google 로그인에 실패했습니다.");
  };
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
        .then(continueAfterAuthentication)
        .catch((error) => {
          authScreen(mode);
          toast(
            error instanceof Error ? error.message : "로그인할 수 없습니다.",
          );
        });
    });
  app.querySelector<HTMLElement>("[data-google-login]")?.addEventListener("click", () => {
    audio.play("button");
    connectionOverlay("Google 계정에 로그인하는 중…");
    void signInWithGoogle()
      .then(handleGoogleResult)
      .catch(handleGoogleError);
  });
  app.querySelector<HTMLElement>("[data-apple-login]")?.addEventListener("click", () => {
    audio.play("button");
    connectionOverlay("Apple 계정에 로그인하는 중…");
    void signInWithApple().then((result) => {
      if (result.status === "nickname-required") {
        googleNicknameScreen(result.signupToken, result.suggestedNickname, "", "apple");
        return;
      }
      continueAfterAuthentication(result.profile);
    }).catch((error) => {
      authScreen(mode);
      toast(error instanceof Error ? error.message : "Apple 로그인에 실패했습니다.");
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

function stopRankedQueueClock(): void {
  if (rankedQueueClockTimer) window.clearInterval(rankedQueueClockTimer);
  rankedQueueClockTimer = 0;
  rankedQueueElapsedAnchor = 0;
  rankedQueueElapsedAnchorAt = 0;
}

function stopRankedQueueTimers(): void {
  stopRankedQueuePolling();
  stopRankedQueueClock();
}

function currentRankedQueueElapsed(now = performance.now()): number {
  if (!rankedQueueElapsedAnchorAt) return rankedQueueElapsedAnchor;
  return Math.max(
    0,
    rankedQueueElapsedAnchor +
      (now - rankedQueueElapsedAnchorAt) / 1_000,
  );
}

function syncRankedQueueClock(serverElapsedSeconds: number): void {
  const now = performance.now();
  rankedQueueElapsedAnchor = Math.max(
    serverElapsedSeconds,
    currentRankedQueueElapsed(now),
  );
  rankedQueueElapsedAnchorAt = now;
  const renderClock = (): void => {
    const clock = app.querySelector<HTMLElement>(
      "[data-ranked-queue-elapsed]",
    );
    if (!clock || currentView !== "ranked-queue") return;
    clock.textContent = formatTime(
      Math.floor(currentRankedQueueElapsed()),
    );
  };
  renderClock();
  if (!rankedQueueClockTimer) {
    // The display advances from a monotonic local clock. Network polling only
    // corrects the anchor, so a 60~90ms response cannot freeze one second and
    // then make the next response appear to jump by two.
    rankedQueueClockTimer = window.setInterval(renderClock, 200);
  }
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
    stopRankedQueueTimers();
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
  const elapsed = formatTime(
    Math.floor(
      rankedQueueElapsedAnchorAt
        ? Math.max(queue.elapsedSeconds, currentRankedQueueElapsed())
        : queue.elapsedSeconds,
    ),
  );
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
    `<main class="ranked-queue-screen"><div class="ranked-queue-backdrop"></div><section class="ranked-queue-shell"><header><span class="eyebrow">RANKED MATCHMAKING</span><h1>${account?.ranked.seasonId ?? "S1"} 랭크전</h1><p>비슷한 랭크의 생존자 4명을 찾고 있습니다.</p></header><aside class="ranked-queue-rule"><strong>공정 경쟁 규칙</strong><span>캐릭터 고유 능력 적용 · 스킨 추가 능력 제외</span><small>${escapeHtml(rankedSeasonRuleSummary(account?.ranked.seasonId ?? "S1"))}</small><small>사망·중도 이탈은 기여도와 생존 시간에 따라 RP에 반영됩니다.</small></aside><section class="ranked-queue-clock"><span>QUEUE TIME</span><strong data-ranked-queue-elapsed>${elapsed}</strong><small>${queue.playerCount}/${queue.requiredPlayers} 명 참가</small></section><ol class="ranked-queue-players">${slots}</ol><footer><button class="btn danger" data-ranked-queue-cancel>대기열 취소</button><small>매칭이 완료되면 별도 준비 없이 자동으로 시작됩니다.</small></footer></section></main>`,
  );
  syncRankedQueueClock(queue.elapsedSeconds);
  app
    .querySelector<HTMLButtonElement>("[data-ranked-queue-cancel]")
    ?.addEventListener("click", () => {
      stopRankedQueueTimers();
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
  lastSentMovementActive = false;
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
    syncAccountRandomBoxes(initial, id);
    inputSequence = reconcileMovementInputSequence(
      inputSequence,
      initial,
      id,
    );
    optimisticPowerPanelModes.clear();
    updateTestApi();
    profile.reconnectTokens[code] = roomNetwork.reconnectToken;
    saveProfile(profile);
    if (firstWelcome) {
      firstWelcome = false;
      safelyProcessGameSnapshot(initial, [], true, null);
      if (initial.tutorial?.active && initial.hostId === id) {
        window.setTimeout(() => {
          if (network === roomNetwork && snapshot?.status === "LOBBY")
            roomNetwork.start();
        }, 180);
      } else if (addSoloBots && initial.hostId === id) {
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
      consumableTurretTargetingId = null;
      consumableTileTargetingId = null;
      closeBuildPanel();
      game?.resetTransientInteraction();
      safelyProcessGameSnapshot(initial, [], false, null);
    }
    if (
      (initial.status === "COUNTDOWN" ||
        initial.status === "PLAYING" ||
        initial.status === "OVERTIME") &&
      !initial.players.find((player) => player.id === id)?.roomId
    ) {
      // A fresh socket owns a new transport sequence. Explicitly stop any
      // velocity persisted by the previous socket before accepting new drag
      // input, including a full-page resume whose welcome is the first one.
      if (pendingMovementTimer) window.clearTimeout(pendingMovementTimer);
      pendingMovementTimer = 0;
      if (movementKeepaliveTimer)
        window.clearInterval(movementKeepaliveTimer);
      movementKeepaliveTimer = 0;
      inputVector = { x: 0, y: 0 };
      lastSentMovementActive = false;
      game?.setLocalInput(inputVector);
      // A reconnect must stop the restored server velocity, never reuse a
      // rendered position captured from the stale pre-reconnect scene.
      sendMovement(true, false);
    }
    updateTestApi();
  });
  roomNetwork.on("snapshot", ({ snapshot: next, events }) => {
    if (network !== roomNetwork) return;
    const previous = snapshot;
    snapshot = next;
    syncAccountRandomBoxes(next, playerId);
    inputSequence = reconcileMovementInputSequence(
      inputSequence,
      next,
      playerId,
    );
    reconcileOptimisticPowerPanelModes(next);
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
    safelyProcessGameSnapshot(next, events, false, previous);
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
    optimisticPowerPanelModes.clear();
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
  roomNetwork.on("gameEmote", ({ playerId: speakerId, emoteId }) => {
    if (network !== roomNetwork || !snapshot) return;
    const speaker = snapshot.players.find((player) => player.id === speakerId);
    const emote = prestigeEmoteById(emoteId);
    if (speaker && emote) showQuickChatBubble(speaker.nickname, emote.label, emote.assetUrl);
  });
  roomNetwork.connect();
}

let lastSnapshotRecoveryAt = 0;

function recoverFromGameSnapshotFailure(error: unknown): void {
  console.error("Game snapshot processing failed; requesting a clean resync", error);
  selectedTile = null;
  selectedTarget = null;
  soulVialTargetingId = null;
  soulVialArmPendingId = null;
  consumableTurretTargetingId = null;
  consumableTileTargetingId = null;
  closeBuildPanel();
  game?.resetTransientInteraction();
  const now = performance.now();
  if (now - lastSnapshotRecoveryAt >= 1_000) {
    lastSnapshotRecoveryAt = now;
    network?.resync();
    toast("화면 동기화를 복구하고 있습니다.");
  }
}

function safelyProcessGameSnapshot(
  next: GameSnapshot,
  events: GameEvent[],
  force: boolean,
  previous: GameSnapshot | null,
): void {
  try {
    renderForSnapshot(next, force);
    game?.updateSnapshot(next, events);
  } catch (error) {
    recoverFromGameSnapshotFailure(error);
    return;
  }
  // Optional sound/toast/selection UI must never invalidate an otherwise
  // valid authoritative frame. Safari layout timing can throw while a modal
  // is being detached; treating that as a snapshot failure caused resync
  // loops, poster flicker and visible movement rewinds on iPhone.
  try {
    playEvents(events);
  } catch (error) {
    console.warn("Game event presentation skipped", error);
  }
  if (previous) {
    try {
      refreshSelectionPanel(previous);
    } catch (error) {
      console.warn("Selection panel refresh skipped", error);
      selectedTile = null;
      selectedTarget = null;
      closeBuildPanel();
    }
  }
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
        const friendAction =
          player.id !== playerId && !player.isBot && player.accountId
            ? `<button class="lobby-friend-add" data-lobby-friend-add="${escapeHtml(player.accountId)}" aria-label="${escapeHtml(player.nickname)}에게 친구 요청" title="친구 추가">＋</button>`
            : "";
        return `<article class="player-card ${profileDisplay.className} ${player.profileFrameId === 'profile-frame-moonlit-phantom-fox' ? 'moonlit-profile-card' : ''}" data-player-id="${player.id}">${playerPortraitHtml(player)}<div class="player-copy"><div class="player-name-row"><strong>${profileBadgeHtml(profileDisplay, "rank-badge-xs")} <span class="player-name">${escapeHtml(player.nickname)}${state.hostId === player.id ? " ★" : ""}</span></strong>${friendAction}</div></div><div class="member-controls"><b class="ready-badge">${state.ranked ? "MATCHED" : player.ready || player.id === state.hostId ? "READY" : "WAIT"}</b>${hostAction}</div></article>`;
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
  container
    .querySelectorAll<HTMLButtonElement>("[data-lobby-friend-add]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const accountId = button.dataset.lobbyFriendAdd;
        if (!accountId || button.disabled) return;
        button.disabled = true;
        button.textContent = "…";
        audio.play("button");
        void socialPost("/api/social/friends/request", { accountId })
          .then(() => {
            button.textContent = "✓";
            button.classList.add("sent");
            toast("친구 요청을 보냈습니다.");
          })
          .catch((error: unknown) => {
            button.disabled = false;
            button.textContent = "＋";
            toast(
              error instanceof Error
                ? error.message
                : "친구 요청을 보내지 못했습니다.",
            );
          });
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
  const rankedLoadout = Boolean(state.ranked);
  const selected = new Set(
    rankedLoadout
      ? me.consumableLoadout
      : owned.map(({ definition }) => definition.id),
  );
  // Lobby snapshots arrive continuously. Replacing this subtree for every
  // snapshot restarts image loading and causes the loadout list to flicker.
  // Only rebuild it when the inventory or selected loadout actually changes.
  const loadoutSignature = JSON.stringify({
    consumables: owned.map(({ entry }) => [entry.itemId, entry.quantity]),
    selected: me.consumableLoadout,
    rankedLoadout,
  });
  if (loadout.dataset.lobbyLoadoutSignature === loadoutSignature) return;
  loadout.dataset.lobbyLoadoutSignature = loadoutSignature;
  loadout.innerHTML = `<header><div><span class="eyebrow">TACTICAL LOADOUT</span><strong>${rankedLoadout ? `내 아이템 장착 <small>${selected.size}/3</small>` : `보유 아이템 전체 사용 <small>${selected.size}종</small>`}</strong></div><button class="btn ghost" data-open-supply-shop>상점</button></header>${owned.length ? `<div class="loadout-items">${owned.map(({ entry, definition }) => rankedLoadout ? `<button class="loadout-item ${selected.has(definition.id) ? "selected" : ""}" data-loadout-id="${definition.id}" aria-pressed="${selected.has(definition.id)}"><span class="loadout-item-art"><img data-supply-art="${definition.id}" alt="${escapeHtml(definition.label)} 이미지"/></span><span><strong>${escapeHtml(definition.label)}</strong><small>${entry.quantity}개 보유 · ${escapeHtml(definition.description)}</small></span><b>${selected.has(definition.id) ? "장착" : "선택"}</b></button>` : `<article class="loadout-item selected"><span class="loadout-item-art"><img data-supply-art="${definition.id}" alt="${escapeHtml(definition.label)} 이미지"/></span><span><strong>${escapeHtml(definition.label)}</strong><small>${entry.quantity}개 보유 · ${escapeHtml(definition.description)}</small></span><b>사용 가능</b></article>`).join("")}</div><p>${rankedLoadout ? "랭크전에서는 장착한 보급품 3종만 각각 한 번 사용할 수 있습니다." : "일반 모드에서는 보유한 모든 전술 보급을 사용할 수 있습니다."}</p>` : `<div class="loadout-empty"><span>아직 구매한 전술 보급이 없습니다.</span><button class="btn primary" data-open-supply-shop>전술 보급 상점</button></div>`}`;
  hydrateCatalogArt(loadout, {
    appearance: me.appearance,
    turretSkins: me.turretSkins,
  });
  loadout
    .querySelectorAll<HTMLButtonElement>("[data-open-supply-shop]")
    .forEach((button) => button.addEventListener("click", openLobbySupplyShop));
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
  const initialGameShellClass = cameraZoomLockedForSnapshot(state, playerId)
    ? ' class="camera-zoom-locked"'
    : "";
  setContent(
    "game",
    `<main id="game-shell"${initialGameShellClass}><div id="game-root"></div><div class="render-mode">TOP-DOWN 2.5D · ${stageThemeFor(state.stageId).label}</div>${me ? `<button class="player-focus ${me.profileFrameId === 'profile-frame-moonlit-phantom-fox' ? 'moonlit-profile-card' : ''}" data-focus-player aria-label="내 캐릭터 위치로 카메라 이동">${playerPortraitHtml(me)}<small>ME</small></button>` : ""}<div class="hud"><div class="stage-chip">${stageBadge}<div class="stage-copy"><span>${state.ranked ? `랭크전 · ${state.ranked.contractId}` : state.playMode === "solo" ? "혼자하기" : "친구랑하기"} · ${state.stageLabel}</span><strong>${stageRankLabel}</strong></div></div><div class="hud-group primary-stats"><div class="stat" data-gold-stat><i>◆</i><span>골드</span><strong data-gold>0</strong></div><div class="stat"><i>⚡</i><span>전력</span><strong data-power>0</strong></div><div class="stat"><i>▣</i><span>문</span><strong data-door>—</strong></div></div><div class="hud-player-list hidden" data-hud-players aria-label="다른 생존자 위치"></div><div class="hud-group battle-stats"><div class="stat"><i>☾</i><span>귀신</span><strong data-ghost>Lv.1</strong></div><div class="stat"><i>🎁</i><span>뽑기</span><strong data-draw>0/${me ? drawLimitForMatch(me.appearance, Boolean(state.ranked)) : 4}</strong></div><div class="stat"><i>◷</i><span>시간</span><strong data-time>00:00</strong></div></div><div class="network-pill" data-network data-testid="network">연결됨 · 0ms</div></div><aside class="opening-minimap hidden" data-opening-minimap aria-label="초반 병동 미니맵"><canvas data-opening-minimap-canvas></canvas><div><span class="self">내 위치</span><span class="team">팀원</span><span class="loot">아이템</span></div></aside><aside class="match-mission-panel hidden" data-match-missions aria-label="이번 판 미션"><button type="button" class="match-mission-hide" data-match-mission-hide aria-label="미션 창 숨기기">×</button><button type="button" class="match-mission-header" data-match-mission-toggle aria-expanded="true"><span><small>MATCH ORDERS</small><strong>이번 판 미션</strong></span><b data-match-mission-total>0P</b><i data-match-mission-arrow>⌃</i></button><ol data-match-mission-list></ol></aside><aside class="ghost-threat-poster hidden" data-ghost-intro aria-live="polite"></aside><div class="countdown-start-notice hidden" data-countdown-warning role="status" aria-live="assertive">귀신이 움직입니다. 시간 안에 귀신을 피해 방에 숨어야 합니다.</div><div class="phase-banner" data-phase>준비 시간</div><aside class="gold-lock-notice hidden" data-gold-lock-notice role="status" aria-live="assertive"><i aria-hidden="true">⛓</i><div><span>GOLD SEALED</span><strong>골드 획득 봉인</strong><small data-gold-lock-time></small></div></aside><aside class="first-match-guide hidden" data-first-match-guide aria-live="polite"></aside><div class="time-attack-clock hidden" data-time-attack></div><div class="time-attack-expired-notice hidden" data-time-attack-expired role="status" aria-live="assertive"></div><div class="camera-controls" aria-label="카메라 조작"><button data-camera="rotate-left" aria-label="카메라 축소">−</button><output data-camera-zoom>1.0×</output><button data-camera="zoom-in" aria-label="카메라 확대">＋</button></div><div class="controls"><div class="joystick" data-joystick><div class="joystick-knob"></div></div><div class="portrait-drag-hint"><i>↗</i><span>캐릭터를 누른 채<br>움직일 방향으로 드래그</span></div><div class="action-stack"><button type="button" class="match-mission-restore hidden" data-match-mission-restore aria-label="이번 판 미션 다시 표시"><span>✓</span><small>미션</small></button><button class="round-btn secondary" data-quick-chat aria-label="팀 채팅">💬</button><button class="round-btn repair-action hidden" data-free-repair aria-label="무료 문 수리">${gameActionIcon("repair")}<small data-free-repair-time>수리</small></button><button class="round-btn" data-interact data-testid="interact" aria-label="침대 점유">${gameActionIcon("bed")}</button></div></div><aside class="build-panel hidden" data-build-panel></aside><div class="connection-overlay hidden" data-connection><div class="connection-card"><div class="spinner"></div><strong>연결을 복구하는 중</strong><p class="subtitle" data-reconnect-copy>30초 안에 기존 생존자로 돌아갑니다.</p></div></div></main>`,
  );
  matchMissionsCollapsed = false;
  matchMissionsHidden = false;
  matchMissionRenderKey = "";
  app.querySelector<HTMLButtonElement>('[data-match-mission-toggle]')?.addEventListener('click', () => {
    const panel = app.querySelector<HTMLElement>('[data-match-missions]');
    const button = app.querySelector<HTMLButtonElement>('[data-match-mission-toggle]');
    const arrow = app.querySelector<HTMLElement>('[data-match-mission-arrow]');
    if (!panel || !button || !arrow) return;
    matchMissionsCollapsed = !matchMissionsCollapsed;
    panel.classList.toggle('collapsed', matchMissionsCollapsed);
    button.setAttribute('aria-expanded', String(!matchMissionsCollapsed));
    arrow.textContent = matchMissionsCollapsed ? '⌄' : '⌃';
    audio.play('button');
  });
  app.querySelector<HTMLButtonElement>('[data-match-mission-hide]')?.addEventListener('click', () => {
    matchMissionsHidden = true;
    updateMatchMissionPanel();
    audio.play('button');
  });
  app.querySelector<HTMLButtonElement>('[data-match-mission-restore]')?.addEventListener('click', () => {
    matchMissionsHidden = false;
    updateMatchMissionPanel();
    audio.play('button');
  });
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
    .querySelector("[data-quick-chat]")
    ?.addEventListener("click", showQuickChatPicker);
  app
    .querySelector("[data-free-repair]")
    ?.addEventListener("click", () => {
      audio.play("button");
      network?.freeRepair();
    });
  window.addEventListener(
    "dorm:tile-selected",
    onTileSelected as EventListener,
  );
  window.addEventListener(
    "dorm:ground-tile-selected",
    onGroundTileSelected as EventListener,
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
      inputVector = { x: 0, y: 0 };
      game?.setLocalInput(inputVector);
      if (pendingMovementTimer) window.clearTimeout(pendingMovementTimer);
      pendingMovementTimer = 0;
      if (movementKeepaliveTimer)
        window.clearInterval(movementKeepaliveTimer);
      movementKeepaliveTimer = 0;
      // Stop first, then interact on the same WebSocket. This prevents an
      // older cached iOS movement intent from being replayed after the bed is
      // claimed and visually ejecting the player from the room.
      // The prompt was shown from an authoritative in-room position. Do not
      // apply the ordinary finger-release prediction correction here: on a
      // bed beside a doorway that correction can push the server actor back
      // across the room boundary immediately before interact() is handled.
      sendMovement(true, false);
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
    if (currentView === "shop" && supplyShopReturnView === "lobby") return;
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
  "pickup-loot": {
    index: 1,
    title: "복도 아이템을 먼저 주워보세요",
    description: "방 근처 아이템으로 이동해 나타나는 줍기 버튼을 누르세요.",
  },
  "claim-bed": {
    index: 2,
    title: "방 안에 들어가 침대를 점유하세요",
    description: "침대 가까이 가면 나타나는 잠자기 버튼을 누르세요.",
  },
  "upgrade-bed": {
    index: 3,
    title: "침대를 업그레이드 해보세요",
    description: "침대 중앙의 강화 화살표를 눌러 Lv.2로 만드세요.",
  },
  "upgrade-door": {
    index: 4,
    title: "문을 업그레이드 해보세요",
    description: "문 중앙의 강화 화살표를 눌러 Lv.2로 만드세요.",
  },
  "build-turret": {
    index: 5,
    title: "포탑을 설치 해보세요",
    description: "빈 타일의 +를 누르고 수호 포탑을 설치하세요.",
  },
  "upgrade-turret": {
    index: 6,
    title: "포탑을 업그레이드 해보세요",
    description: "포탑 중앙의 강화 화살표를 눌러 Lv.2로 만드세요.",
  },
  "build-generator": {
    index: 7,
    title: "달빛 발전기를 설치 해보세요",
    description: "발전기가 매초 전력 1을 생산합니다.",
  },
  "build-net": {
    index: 8,
    title: "250 전력을 모아 그물을 설치하세요",
    description: "시작 전력 240에 발전기로 10을 더 모아 설치하세요.",
  },
  finish: {
    index: 9,
    title: "귀신을 물리치세요",
    description: "그물이 적중한 뒤 포탑의 다음 한 발로 마무리하세요.",
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
  const paused = tutorial.pauseRemaining > 0;
  guide.classList.remove("hidden");
  guide.classList.toggle("retreat-lesson", paused);
  guide.innerHTML = paused
    ? `<div class="tutorial-retreat-card"><span>GHOST RETREAT</span><strong>귀신이 회복하러 후퇴합니다</strong><div class="tutorial-ghost-hp"><i style="width:30%"></i><b></b></div><p>회색으로 남은 HP는 퇴각 구간입니다.<br/>귀신은 리스폰 구역에서 회복한 뒤 다시 돌아옵니다.</p></div>`
    : `<div class="tutorial-guide-card"><b>${copy.index}/9</b><div><span>첫 생존 훈련</span><strong>${escapeHtml(copy.title)}</strong><p>${escapeHtml(copy.description)}</p></div></div>`;
}

function updateHud(): void {
  if (!snapshot || currentView !== "game") return;
  const tutorialActive = Boolean(snapshot.tutorial?.active);
  app
    .querySelector("#game-shell")
    ?.classList.toggle("tutorial-mode", tutorialActive);
  const movementIntroLocked =
    snapshot.status === "RANKED_INTRO" ||
    snapshot.status === "GHOST_INTRO" ||
    snapshot.status === "EVENT_INTRO";
  app
    .querySelector("#game-shell")
    ?.classList.toggle("intro-movement-locked", movementIntroLocked);
  if (movementIntroLocked) resetMovementForIntro();
  const me = snapshot.players.find((player) => player.id === playerId);
  const cameraZoomLocked = cameraZoomLockedForSnapshot(snapshot, playerId);
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
    .querySelector("[data-interact]")
    ?.classList.toggle("hidden", Boolean(me?.roomId) || !me?.alive);
  const freeRepairButton = app.querySelector<HTMLButtonElement>(
    "[data-free-repair]",
  );
  if (freeRepairButton) {
    const freeRepairLocked =
      snapshot.repairSuppressedUntil > snapshot.elapsed;
    const repairActive = Boolean(
      room && snapshot.elapsed < room.freeRepairUntil,
    );
    const repairCooldown = Boolean(
      room && !repairActive && snapshot.elapsed < room.freeRepairReadyAt,
    );
    const repairAvailablePhase =
      snapshot.status === "PLAYING" || snapshot.status === "OVERTIME";
    const repairVisible = Boolean(me?.alive && room && repairAvailablePhase);
    const repairDisabled =
      !repairVisible ||
      repairActive ||
      repairCooldown ||
      freeRepairLocked ||
      !room ||
      room.doorHp <= 0 ||
      room.doorHp >= room.doorMaxHp;
    freeRepairButton.classList.toggle("hidden", !repairVisible);
    freeRepairButton.classList.toggle("is-active", repairActive);
    freeRepairButton.classList.toggle("is-cooldown", repairCooldown);
    freeRepairButton.disabled = repairDisabled;
    const time = freeRepairButton.querySelector<HTMLElement>(
      "[data-free-repair-time]",
    );
    if (time)
      time.textContent = repairActive
        ? `${Math.max(1, Math.ceil((room?.freeRepairUntil ?? 0) - snapshot.elapsed))}초`
        : repairCooldown
          ? `${Math.max(1, Math.ceil((room?.freeRepairReadyAt ?? 0) - snapshot.elapsed))}초`
          : freeRepairLocked
            ? "봉인"
            : "수리";
    freeRepairButton.setAttribute(
      "aria-label",
      repairActive
        ? "무료 문 수리 중"
        : repairCooldown
          ? `무료 문 수리 ${Math.ceil((room?.freeRepairReadyAt ?? 0) - snapshot.elapsed)}초 후 사용 가능`
          : "5초간 초당 15 무료 문 수리",
    );
  }
  updateHudTeammates();
  updateOpeningMinimap();
  updateMatchMissionPanel();
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
    `${me?.drawCount ?? 0}/${me ? drawLimitForMatch(me.appearance, Boolean(snapshot.ranked)) : 4}`,
  );
  setText("[data-time]", formatTime(snapshot.elapsed));
  const retreating = snapshot.ghosts.some(
    (ghost) => ghost.retreating || ghost.healing,
  );
  const goldLocked = Boolean(
    room && room.goldSuppressedUntil > snapshot.elapsed,
  );
  const goldLockRemaining = goldLocked
    ? Math.max(0, (room?.goldSuppressedUntil ?? 0) - snapshot.elapsed)
    : 0;
  app
    .querySelector("#game-shell")
    ?.classList.toggle("gold-lock-active", goldLocked);
  app
    .querySelector("[data-gold-stat]")
    ?.classList.toggle("gold-locked", goldLocked);
  const goldLockNotice = app.querySelector<HTMLElement>(
    "[data-gold-lock-notice]",
  );
  goldLockNotice?.classList.toggle("hidden", !goldLocked);
  setText(
    "[data-gold-lock-time]",
    goldLocked
      ? `귀신이 내 문 공격 중 · ${Math.ceil(goldLockRemaining)}초`
      : "",
  );
  const repairLocked = snapshot.repairSuppressedUntil > snapshot.elapsed;
  const skillWarning = goldLocked
    ? `⚠ 골드 획득 봉인 ${Math.ceil(goldLockRemaining)}초`
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
        const posterKey = `${artVariant}:${poster.title}:${poster.warning}`;
        if (ghostPoster.dataset.posterKey !== posterKey) {
          ghostPoster.dataset.posterKey = posterKey;
          ghostPoster.innerHTML = `<div class="ghost-threat-paper"><img src="/assets/ghost-intros/ghost-warning-frame.png" alt="" aria-hidden="true" decoding="async"/><img class="ghost-threat-art" src="/assets/sprites/ghosts/${artVariant}/concept.png" alt="${escapeHtml(poster.title)} 일러스트" decoding="async"/><div class="ghost-threat-copy"><span>HOSTILE ENTITY</span><strong>${escapeHtml(poster.title)}</strong><p>${escapeHtml(poster.warning)}</p></div></div>`;
        }
      }
    }
  }
  if (phase) {
    phase.hidden = tutorialActive || showGhostPoster || isRankedIntro;
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
  updateCountdownStartWarning(isCountdown && !tutorialActive);
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

function updateOpeningMinimap(): void {
  const minimap = app.querySelector<HTMLElement>("[data-opening-minimap]");
  const canvas = app.querySelector<HTMLCanvasElement>(
    "[data-opening-minimap-canvas]",
  );
  if (!minimap || !canvas || !snapshot || !mapData) return;
  const local = snapshot.players.find((player) => player.id === playerId);
  const visible = Boolean(
    local?.alive &&
      !local.roomId &&
      !snapshot.ranked &&
      (snapshot.status === "COUNTDOWN" || snapshot.status === "PLAYING"),
  );
  minimap.classList.toggle("hidden", !visible);
  if (!visible) return;

  const mapKey = `${mapData.seed}:${mapData.width}x${mapData.height}`;
  if (openingMinimapMapKey !== mapKey) {
    openingMinimapMapKey = mapKey;
    openingMinimapTrails.clear();
  }
  for (const player of snapshot.players) {
    if (!player.alive) continue;
    const trail = openingMinimapTrails.get(player.id) ?? [];
    const previous = trail.at(-1);
    if (
      !previous ||
      Math.hypot(
        previous.x - player.position.x,
        previous.y - player.position.y,
      ) >= 0.35
    ) {
      trail.push({ ...player.position });
      if (trail.length > 32) trail.shift();
      openingMinimapTrails.set(player.id, trail);
    }
  }

  const cssWidth = Math.max(120, Math.round(canvas.clientWidth || 154));
  const cssHeight = Math.max(88, Math.round(canvas.clientHeight || 112));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(cssWidth * dpr);
  const pixelHeight = Math.round(cssHeight * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  const padding = 5;
  const scale = Math.min(
    (cssWidth - padding * 2) / Math.max(1, mapData.width),
    (cssHeight - padding * 2) / Math.max(1, mapData.height),
  );
  const offsetX = (cssWidth - mapData.width * scale) / 2;
  const offsetY = (cssHeight - mapData.height * scale) / 2;
  const staticLayerKey = `${mapKey}:${pixelWidth}x${pixelHeight}`;
  if (!openingMinimapStaticLayer || openingMinimapStaticLayerKey !== staticLayerKey) {
    const layer = document.createElement("canvas");
    layer.width = pixelWidth;
    layer.height = pixelHeight;
    const layerContext = layer.getContext("2d");
    if (!layerContext) return;
    layerContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    layerContext.fillStyle = "#06111a";
    layerContext.fillRect(0, 0, cssWidth, cssHeight);
    const staticTileRect = (tile: Vec2, color: string, inset = 0): void => {
      layerContext.fillStyle = color;
      layerContext.fillRect(
        offsetX + tile.x * scale + inset,
        offsetY + tile.y * scale + inset,
        Math.max(0.7, scale - inset * 2),
        Math.max(0.7, scale - inset * 2),
      );
    };
    for (const tile of mapData.corridorTiles) staticTileRect(tile, "#173f50");
    for (const room of mapData.rooms)
      for (const tile of room.floorTiles) staticTileRect(tile, "#54435e");
    for (const wall of mapData.walls)
      staticTileRect(wall, "#101a25", scale * 0.08);
    openingMinimapStaticLayer = layer;
    openingMinimapStaticLayerKey = staticLayerKey;
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, pixelWidth, pixelHeight);
  context.drawImage(openingMinimapStaticLayer, 0, 0);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const tileRect = (tile: Vec2, color: string, inset = 0): void => {
    context.fillStyle = color;
    context.fillRect(
      offsetX + tile.x * scale + inset,
      offsetY + tile.y * scale + inset,
      Math.max(0.7, scale - inset * 2),
      Math.max(0.7, scale - inset * 2),
    );
  };

  for (const drop of snapshot.lootDrops) {
    if (drop.carriedBy) continue;
    tileRect(drop.tile, "#ffd55c", Math.max(0.35, scale * 0.2));
  }

  for (const player of snapshot.players) {
    const trail = openingMinimapTrails.get(player.id) ?? [];
    if (trail.length > 1) {
      context.beginPath();
      trail.forEach((position, index) => {
        const x = offsetX + (position.x + 0.5) * scale;
        const y = offsetY + (position.y + 0.5) * scale;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle =
        player.id === playerId
          ? "rgba(255,77,91,.72)"
          : "rgba(91,226,245,.52)";
      context.lineWidth = Math.max(1, scale * 0.3);
      context.lineCap = "round";
      context.stroke();
    }
    if (!player.alive) continue;
    context.beginPath();
    context.arc(
      offsetX + (player.position.x + 0.5) * scale,
      offsetY + (player.position.y + 0.5) * scale,
      Math.max(2.2, scale * 0.58),
      0,
      Math.PI * 2,
    );
    context.fillStyle =
      player.id === playerId
        ? "#ff3d50"
        : "#5be2f5";
    context.fill();
    context.strokeStyle = "rgba(255,255,255,.9)";
    context.lineWidth = 0.8;
    context.stroke();
  }
}

function updateMatchMissionPanel(): void {
  const panel = app.querySelector<HTMLElement>('[data-match-missions]');
  const restore = app.querySelector<HTMLButtonElement>('[data-match-mission-restore]');
  const list = app.querySelector<HTMLOListElement>('[data-match-mission-list]');
  const total = app.querySelector<HTMLElement>('[data-match-mission-total]');
  if (!panel || !restore || !list || !total || !snapshot) return;
  const local = snapshot.players.find((player) => player.id === playerId);
  const missions = local?.matchMissions ?? [];
  const visible = Boolean(
    !snapshot.ranked &&
      local?.alive &&
      local.roomId &&
      missions.length > 0 &&
      (snapshot.status === 'COUNTDOWN' ||
        snapshot.status === 'PLAYING' ||
        snapshot.status === 'OVERTIME'),
  );
  const visibility = matchMissionPanelVisibility(visible, matchMissionsHidden);
  panel.classList.toggle('hidden', !visibility.panelVisible);
  restore.classList.toggle('hidden', !visibility.restoreVisible);
  if (!visible) {
    matchMissionRenderKey = '';
    return;
  }
  panel.classList.toggle('collapsed', matchMissionsCollapsed);
  const earnedPoints = missions.reduce(
    (sum, mission) => sum + (mission.completed ? mission.rewardPoints : 0),
    0,
  );
  total.textContent = `+${earnedPoints}P`;
  const renderKey = missions
    .map((mission) => `${mission.id}:${mission.progress}:${mission.completed ? 1 : 0}`)
    .join('|');
  if (matchMissionRenderKey === renderKey) return;
  matchMissionRenderKey = renderKey;
  list.innerHTML = missions
    .map((mission, index) => {
      const progress = Math.min(mission.progress, mission.target);
      return `<li class="${mission.completed ? 'completed' : ''}"><span>${index + 1}</span><div><strong>${escapeHtml(mission.title)}</strong><small>${escapeHtml(mission.description)}</small></div><b>${mission.completed ? '✓' : `${Math.floor(progress)}/${mission.target}`}</b><em>+${mission.rewardPoints}P</em></li>`;
    })
    .join('');
}

interface ResultScreenPresentation {
  victory: boolean;
  stageLabel: string;
  title: string;
  description: string;
  elapsedLabel: string;
  ghostLevel: number;
  rewardMarkup: string;
  actionsMarkup: string;
}

function resultScreenMarkup(result: ResultScreenPresentation): string {
  return `<main class="result-screen ${result.victory ? "victory" : "defeat"}"><div class="result-backdrop" aria-hidden="true"></div><section class="result-card"><header class="result-card-head"><span class="result-kicker">${escapeHtml(result.stageLabel)} · ${result.victory ? "DAWN REPORT" : "NIGHT REPORT"}</span><div class="result-emblem" aria-hidden="true">${result.victory ? "✦" : "☾"}</div><h1>${escapeHtml(result.title)}</h1><p>${escapeHtml(result.description)}</p></header><div class="result-stats"><article><small>생존 시간</small><strong>${escapeHtml(result.elapsedLabel)}</strong></article><article><small>최종 귀신</small><strong>Lv.${result.ghostLevel}</strong></article><article><small>스테이지</small><strong>${escapeHtml(result.stageLabel)}</strong></article></div>${result.rewardMarkup}${result.actionsMarkup}</section></main>`;
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
  const rankedResult = Boolean(state.ranked);
  const adFreeActive = Boolean(account?.adFree.active);
  const resultActions = tutorialVictory
    ? '<div class="result-actions tutorial-result-actions"><button class="btn primary" data-tutorial-home>홈으로 이동</button></div>'
    : victory
      ? `<div class="result-actions victory-claim-actions ${adFreeActive ? "ad-free" : ""}">
          ${adFreeActive ? "" : '<button class="btn ghost" data-claim-reward="1">전리품 수령</button>'}
          <button class="btn primary" data-claim-reward="2">${adFreeActive ? "2배 전리품 수령" : "2배 수령"}</button>
        </div>`
      : rankedResult
        ? '<div class="result-actions ranked-result-actions"><button class="btn primary" data-leave>홈으로 이동</button></div>'
        : '<div class="result-actions"><button class="btn primary" data-rematch data-testid="rematch">다시 도전</button><button class="btn ghost" data-leave>게임 메뉴</button></div>';
  setContent(
    "result",
    resultScreenMarkup({
      victory,
      stageLabel: state.stageLabel,
      title: tutorialVictory
        ? "듀토리얼 완료"
        : victory
          ? "생존"
          : "스테이지 종료",
      description: tutorialVictory
        ? "기본 훈련을 모두 마쳤습니다."
        : victory
          ? "마지막 귀신을 몰아내고 병동의 아침을 지켜냈습니다."
          : "괜찮아요. 방어선을 정비하고 다시 도전해보세요.",
      elapsedLabel: formatTime(state.elapsed),
      ghostLevel: state.ghost.level,
      rewardMarkup: victory
        ? `<div class="result-reward"><span>CLEAR REWARD</span><strong>✦ +${tutorialVictory ? 100 : reward} P</strong><small>${tutorialVictory ? "이제 홈에서 이벤트와 모든 게임 기능을 이용할 수 있습니다." : adFreeActive ? "광고 제거 혜택으로 2배 전리품을 바로 받을 수 있습니다." : "전리품을 수령하면 포인트가 계정에 지급됩니다."}</small></div>`
        : '<div class="result-reward muted"><span>CHALLENGE RECORD</span><strong>도전 기록 저장</strong><small>이번 판에서 달성한 진행 기록은 그대로 유지됩니다.</small></div>',
      actionsMarkup: resultActions,
    }),
  );
  app.querySelector("[data-rematch]")?.addEventListener("click", () => {
    resultRecorded = false;
    network?.rematch();
    audio.play("button");
  });
  const leaveResultToHome = (): void => {
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
  };
  app.querySelector("[data-leave]")?.addEventListener("click", leaveResultToHome);
  if (victory && !tutorialVictory && account && isNativeApp && !adFreeActive) {
    void prepareStageClearReward(account.id, state.matchId).catch(() => undefined);
  }
  app
    .querySelectorAll<HTMLButtonElement>("[data-claim-reward]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const multiplier: 1 | 2 = button.dataset.claimReward === "2" ? 2 : 1;
        const claimButtons = app.querySelectorAll<HTMLButtonElement>("[data-claim-reward]");
        claimButtons.forEach((candidate) => {
          candidate.disabled = true;
        });
        button.classList.add("loading");
        void (async () => {
          let rewardedAdCompleted = false;
          if (multiplier === 2 && !adFreeActive) {
            if (!account) throw new Error("로그인이 필요합니다.");
            if (!isNativeApp) {
              throw new Error("Chrome·Safari·PWA에서는 AdMob 광고가 실행되지 않습니다. Google Play 또는 App Store에서 설치한 앱에서 이용해주세요.");
            }
            await showStageClearReward(account.id, state.matchId);
            rewardedAdCompleted = true;
          }
          let claim: Awaited<ReturnType<typeof claimMatchReward>> | null = null;
          for (let attempt = 0; attempt < 5; attempt += 1) {
            try {
              claim = await claimMatchReward(state.matchId, multiplier, rewardedAdCompleted);
              break;
            } catch (error) {
              if (
                attempt >= 4
                || !(error instanceof Error)
                || !error.message.includes("정산이 아직")
              ) throw error;
              await new Promise<void>((resolve) => window.setTimeout(resolve, 320));
            }
          }
          if (!claim) throw new Error("전리품을 지급하지 못했습니다.");
          account = claim.profile;
          toast(`✦ ${claim.pointsAwarded.toLocaleString()} P를 받았습니다.`);
          leaveResultToHome();
        })().catch((error) => {
          button.classList.remove("loading");
          claimButtons.forEach((candidate) => {
            candidate.disabled = false;
          });
          toast(error instanceof Error ? error.message : "전리품을 지급하지 못했습니다.");
        });
      }),
    );
  const finishTutorialResult = async (): Promise<void> => {
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
    homeScreen();
  };
  app
    .querySelector("[data-tutorial-home]")
    ?.addEventListener("click", () => {
      audio.play("button");
      void finishTutorialResult().catch(() => authScreen());
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
  if (consumableTileTargetingId) {
    toast("보급품을 사용할 복도 타일을 선택하세요.");
    return;
  }
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

function onGroundTileSelected(event: CustomEvent<Tile>): void {
  if (!consumableTileTargetingId) return;
  const itemId = consumableTileTargetingId;
  consumableTileTargetingId = null;
  network?.useConsumable(itemId, { tile: event.detail });
  audio.play("button");
  toast("선택한 복도 타일에 전술 보급품을 사용했습니다.");
}

function beginConsumableUseFromInstallPanel(itemId: ConsumableId): void {
  const gameState = snapshot;
  const me = gameState?.players.find((player) => player.id === playerId);
  const item = shopConsumableById(itemId);
  const quantity = me?.consumables.find((owned) => owned.itemId === itemId)?.quantity ?? 0;
  const availableInMode = Boolean(
    me && (gameState?.ranked ? me.consumableLoadout.includes(itemId) : quantity > 0),
  );
  if (!gameState || !me || !item || !availableInMode) return;
  if (me.usedConsumables.includes(itemId) || quantity <= 0) {
    toast(me.usedConsumables.includes(itemId) ? "이 보급품은 이번 판에 이미 사용했습니다." : "보급 재고가 없습니다.");
    return;
  }
  if (item.target === "tile") {
    consumableTileTargetingId = itemId;
    consumableTurretTargetingId = null;
    closeBuildPanel();
    audio.play("button");
    toast("8칸 안의 복도 타일을 선택하세요.");
    return;
  }
  if (item.target === "building") {
    consumableTurretTargetingId = itemId;
    consumableTileTargetingId = null;
    selectedTarget = null;
    closeBuildPanel();
    audio.play("button");
    toast("전술 보급을 적용할 현재 방의 포탑을 선택하세요.");
    return;
  }
  if (item.target === "install") {
    if (!selectedTile || selectedTile.roomId !== me.roomId) {
      toast("내 방의 빈 설치 타일을 선택하세요.");
      return;
    }
    const installTile = { ...selectedTile };
    closeBuildPanel();
    network?.useConsumable(itemId, { tile: installTile });
    audio.play("button");
    toast("원혼 유도 송신기를 설치합니다.");
    return;
  }
  if ((item.target === "room" || item.target === "door") && !me.roomId) {
    toast("방을 점유한 뒤 사용할 수 있습니다.");
    return;
  }
  closeBuildPanel();
  network?.useConsumable(itemId, me.roomId ? { roomId: me.roomId } : {});
  audio.play("button");
}

function onTargetSelected(event: CustomEvent<SceneSelection>): void {
  // 건물을 선택한 캔버스 터치와 같은 입력이 업그레이드/철거 버튼으로
  // 이어지지 않게, 선택 뒤에는 별도 터치를 한 번 더 요구한다.
  buildPanelInputBlockedUntil = performance.now() + BUILD_PANEL_OPEN_GUARD_MS;
  if (consumableTileTargetingId) {
    toast("보급품을 사용할 복도 타일을 선택하세요.");
    return;
  }
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
  if (consumableTurretTargetingId && snapshot) {
    const itemId = consumableTurretTargetingId;
    const target = snapshot.buildings.find(
      (building) => building.id === event.detail.targetId,
    );
    const me = snapshot.players.find((player) => player.id === playerId);
    if (
      !target ||
      !me?.roomId ||
      target.roomId !== me.roomId ||
      !["basic-turret", "golden-turret"].includes(target.kind)
    ) {
      toast("전술 보급을 적용할 현재 방의 포탑을 선택하세요.");
      return;
    }
    showConsumableTurretConfirm(itemId, target);
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

function roomSingletonBuildLimitReason(
  gameState: GameSnapshot,
  player: PlayerState,
  kind: BuildingKind,
): string | null {
  if (!player.roomId || !ROOM_SINGLETON_BUILD_KINDS.has(kind)) return null;
  return gameState.buildings.some(
    (building) =>
      building.roomId === player.roomId && building.kind === kind,
  )
    ? "방에 이미 설치됨"
    : null;
}

/** Keeps an open install/upgrade sheet live while passive income changes. */
function refreshOpenPanelAffordability(): void {
  if (!snapshot || currentView !== "game") return;
  const gameState = snapshot;
  const panel = app.querySelector<HTMLElement>("[data-build-panel]");
  if (!panel || panel.classList.contains("hidden")) return;
  const me = gameState.players.find((player) => player.id === playerId);
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
      const kind = button.dataset.build as BuildingKind | undefined;
      const roomSingleton = button.dataset.roomSingleton === "true";
      const liveLimitReason = roomSingleton && kind
        ? roomSingletonBuildLimitReason(gameState, me, kind)
        : null;
      const installLimited = roomSingleton
        ? Boolean(liveLimitReason)
        : button.dataset.buildLimit === "true";
      const enabled = affordable && !installLimited;
      button.disabled = !enabled;
      button.classList.toggle("resource-insufficient", !enabled);
      button.setAttribute("aria-disabled", String(!enabled));
      const liveLimitNote = button.querySelector<HTMLElement>(
        "[data-live-build-limit]",
      );
      if (liveLimitNote) {
        liveLimitNote.hidden = !liveLimitReason;
        liveLimitNote.textContent = liveLimitReason ?? "";
      }
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
  panel.classList.remove("tutorial-upgrade-lock");
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
    "build-net": "ghost-net",
  };
  const guidedKind = gameState.tutorial?.active
    ? tutorialGuidedKinds[gameState.tutorial.step]
    : undefined;
  const tutorialBuildTab = gameState.tutorial?.active
    ? gameState.tutorial.step === "build-net"
      ? "power"
      : "gold"
    : null;
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
  const rankedRules = gameState.ranked
    ? (gameState.ranked.seasonRules ??
      rankedSeasonRules(gameState.ranked.seasonId))
    : null;
  const buildLimitReason = (kind: BuildingKind): string | null => {
    const roomSingletonReason = roomSingletonBuildLimitReason(
      gameState,
      me,
      kind,
    );
    if (roomSingletonReason) return roomSingletonReason;
    if (
      rankedRules?.constraint.kind === "turret-limit" &&
      isRankedTurretKind(kind) &&
      ownedBuildings.filter((building) => isRankedTurretKind(building.kind))
        .length >= rankedRules.constraint.maxTurrets
    )
      return `이번 시즌 최대 ${rankedRules.constraint.maxTurrets}개`;
    if (
      kind === "lucky-machine" &&
      ownedBuildings.filter((building) => building.kind === kind).length >=
        (rankedRules?.constraint.kind === "random-box-limit"
          ? rankedRules.constraint.maxRandomBoxes
          : 1)
    )
      return rankedRules?.constraint.kind === "random-box-limit"
        ? `이번 시즌 최대 ${rankedRules.constraint.maxRandomBoxes}개`
        : "이미 설치됨";
    if (
      [
        "overload-capacitor",
        "reflect-mirror",
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
    const roomSingleton = ROOM_SINGLETON_BUILD_KINDS.has(kind);
    const enabled = affordable && !limitReason;
    return `<button class="build-card catalog-card ${powerOnly ? "power-only-build" : ""}${enabled ? "" : " resource-insufficient"}" type="button" data-build="${kind}" data-cost-gold="${cost.gold}" data-cost-power="${cost.power}"${roomSingleton ? ' data-room-singleton="true"' : ""}${limitReason ? ' data-build-limit="true"' : ""} ${enabled ? "" : 'disabled aria-disabled="true"'}><span class="catalog-art build-art"><img data-building-art="${kind}" alt="${escapeHtml(definition.label)} 인게임 탑다운 모습" /></span><span class="build-card-copy"><strong>${definition.label}</strong>${powerOnly ? `<em class="power-only-badge">⚡ 전력 전용</em>` : ""}<small>${definition.description}</small>${roomSingleton ? `<em class="build-limit-note" data-live-build-limit${limitReason ? "" : " hidden"}>${limitReason ?? ""}</em>` : limitReason ? `<em class="build-limit-note">${limitReason}</em>` : ""}</span><span class="build-card-cost">${ticketBuild ? '<span class="resource-cost gold">🎟 <b>티켓 1장</b></span>' : resourceCostMarkup(cost)}</span></button>`;
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
  const availableSupplyIds = gameState.ranked
    ? me.consumableLoadout
    : me.consumables
        .filter((owned) => owned.quantity > 0)
        .map((owned) => owned.itemId);
  const supplyCards =
    availableSupplyIds
      .map((itemId) => {
        const owned = me.consumables.find((candidate) => candidate.itemId === itemId);
        const supply = shopConsumableById(itemId);
        if (!supply) return "";
        const quantity = owned?.quantity ?? 0;
        const used = me.usedConsumables.includes(itemId);
        const targetLabel = supply.target === "tile"
          ? "복도 지정"
          : supply.target === "install"
            ? "빈 타일에 설치"
          : supply.target === "building"
            ? "포탑 지정"
            : supply.target === "door"
              ? "문에 사용"
              : supply.target === "room"
                ? "방에 사용"
                : "즉시 사용";
        const unavailable = used || quantity <= 0;
        return `<article class="build-card catalog-card supply-build-card${unavailable ? " resource-insufficient" : ""}"><span class="catalog-art build-art"><img data-supply-art="${supply.id}" alt="${escapeHtml(supply.label)}" /></span><span class="build-card-copy"><strong>${escapeHtml(supply.label)} ×${quantity}</strong><small>${escapeHtml(supply.description)}</small></span><button class="build-card-cost supply-target-button" type="button" data-use-build-consumable="${supply.id}"${unavailable ? ' disabled aria-disabled="true"' : ""}>${used ? (supply.target === "install" ? "이번 판 설치 완료" : "이번 판 사용 완료") : targetLabel}</button></article>`;
      })
      .join("") ||
    `<p class="empty-build-tab">${gameState.ranked ? "장착한 전투 보급이 없습니다. 대기실에서 최대 3종을 장착하세요." : "사용할 수 있는 보유 전술 보급이 없습니다."}</p>`;
  const initialBuildTab = tutorialBuildTab ?? "gold";
  panel.innerHTML = `${panelHeadingMarkup("INSTALL", "빈 타일에 설비 설치")}<div class="panel-wallet"><span>타일 ${tile.x + 1}, ${tile.y + 1}</span><strong>◆ <b data-owned-gold>${Math.floor(me.gold)}</b></strong><strong>⚡ <b data-owned-power>${Math.floor(me.power)}</b></strong></div><nav class="build-resource-tabs ${tutorialBuildTab ? "tutorial-tab-locked" : ""}"><button class="${initialBuildTab === "gold" ? "active" : ""}" data-build-tab="gold"${tutorialBuildTab ? " disabled" : ""}>골드</button><button class="${initialBuildTab === "power" ? "active" : ""}" data-build-tab="power"${tutorialBuildTab ? " disabled" : ""}>전력</button><button data-build-tab="supply"${tutorialBuildTab ? " disabled" : ""}>보급</button></nav><section class="build-tab-panel ${initialBuildTab === "gold" ? "" : "hidden"}" data-build-tab-panel="gold"><div class="build-grid">${goldCards}</div></section><section class="build-tab-panel ${initialBuildTab === "power" ? "" : "hidden"}" data-build-tab-panel="power"><div class="build-grid">${powerCards}</div></section><section class="build-tab-panel hidden" data-build-tab-panel="supply"><div class="build-grid">${supplyCards}</div></section>`;
  panel.classList.remove("hidden");
  refreshOpenPanelAffordability();
  hydrateCatalogArt(panel, {
    appearance: me.appearance,
    turretSkins: me.turretSkins,
  });
  if (guidedKind) {
    const guidedBuildButton = panel.querySelector<HTMLButtonElement>(
      `[data-build="${guidedKind}"]`,
    );
    if (guidedBuildButton) {
      panel.classList.add("tutorial-upgrade-lock");
      guidedBuildButton.insertAdjacentHTML(
        "afterend",
        '<div class="tutorial-upgrade-pointer"><i>↑</i><span>화살표 위의 설비를 설치하세요</span></div>',
      );
    }
  }
  if (!tutorialBuildTab) {
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
  }
  panel
    .querySelectorAll<HTMLButtonElement>("[data-use-build-consumable]")
    .forEach((button) =>
      wirePanelAction(button, () =>
        beginConsumableUseFromInstallPanel(
          button.dataset.useBuildConsumable as ConsumableId,
        ),
      ),
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
        closeBuildPanel();
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
  panel.classList.remove("tutorial-upgrade-lock");
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
  if (building && kind === "ghost-lure-beacon") {
    const uses = Math.max(0, Math.floor(building.lureUses ?? 0));
    const remaining = Math.max(
      0,
      (building.lureReadyAt ?? 0) - snapshot.elapsed,
    );
    const ghostRespawning = snapshot.ghosts.some(
      (ghost) => ghost.hp > 0 && (ghost.retreating || ghost.healing),
    );
    const activeGhosts = snapshot.ghosts.filter(
      (ghost) => ghost.hp > 0 && !ghost.retreating && !ghost.healing,
    );
    const ready = uses < 2 && remaining <= 0 && !ghostRespawning && activeGhosts.length > 0;
    const stateLabel = ghostRespawning || activeGhosts.length === 0
      ? "귀신 리스폰 중"
      : remaining > 0
        ? "재충전 중"
        : "유인 준비 완료";
    const actionLabel = ghostRespawning || activeGhosts.length === 0
      ? "리스폰 종료 대기"
      : remaining > 0
        ? `${Math.ceil(remaining)}초 후 다시 사용`
        : uses === 0
          ? "귀신 유인"
          : "귀신 다시 유인";
    panel.innerHTML = `${panelHeadingMarkup("ACTIVE", `${buildingIconMarkup(kind)} ${definition.label}`)}<p class="panel-description">${definition.description}</p><div class="target-card"><div class="target-card-title"><span>${stateLabel}</span><strong>남은 사용 ${Math.max(0, 2 - uses)}/2</strong></div><small>발동하면 현재 활동 중인 모든 귀신이 내 방을 공격 목표로 선택합니다. 두 번째 발동 후 송신기는 사라집니다.</small></div><button class="upgrade-cta${ready ? "" : " resource-insufficient"}" type="button" data-use-ghost-lure ${ready ? "" : 'disabled aria-disabled="true"'}>${actionLabel}</button>`;
    panel.classList.remove("hidden");
    wireBuildPanelClose(panel);
    const button = panel.querySelector<HTMLButtonElement>("[data-use-ghost-lure]");
    if (button)
      wirePanelAction(button, () => {
        if (button.disabled) return;
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
        network?.activateBuilding(building.id, "use");
      });
    return;
  }
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
    const mode =
      optimisticPowerPanelModes.get(building.id) ??
      building.powerPanelMode ??
      "attack";
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
    panel.innerHTML = `${panelHeadingMarkup("MODE", `${buildingIconMarkup(kind)} ${definition.label}`)}<p class="panel-description">한 가지를 강화하면 다른 능력에는 반드시 손해가 생깁니다.</p><div class="build-grid power-panel-modes" role="radiogroup" aria-label="배전 제어판 모드">${modes.map((entry) => `<button class="build-card ${entry.id === mode ? "active" : ""}" type="button" role="radio" aria-checked="${entry.id === mode}" data-panel-mode="${entry.id}"><span class="build-card-copy"><strong>${entry.label}</strong><small>${entry.copy}</small></span></button>`).join("")}</div>${removalMarkup}`;
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
            .querySelectorAll<HTMLElement>("[data-panel-mode]")
            .forEach((candidate) => {
              const selected = candidate === button;
              candidate.classList.toggle("active", selected);
              candidate.setAttribute("aria-checked", String(selected));
            });
          const selectedMode = button.dataset.panelMode as
            | "attack"
            | "defense"
            | "production";
          optimisticPowerPanelModes.set(building.id, selectedMode);
          network?.activateBuilding(building.id, selectedMode);
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
    const drawLimit = drawLimitForMatch(me.appearance, Boolean(snapshot?.ranked));
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
      cost && me.randomBoxesRemaining > 0 && canAffordResources(me, cost.gold, cost.power),
    );
    const refillAvailable = Boolean(account && account.randomBoxes.refillsClaimed < account.randomBoxes.maxRefills);
    const stockNotice = me.randomBoxesRemaining <= 0 && refillAvailable
      ? '<p class="random-box-refill-note">상점 &gt; 아이템 탭에서 보충하세요.</p>'
      : '';
    panel.innerHTML = `${panelHeadingMarkup("DRAW", `${buildingIconMarkup(kind)} ${definition.label}`)}<p class="panel-description">${definition.description}</p><div class="target-card"><div class="target-card-title"><span>이번 판 사용 횟수</span><strong>${me.drawCount} / ${drawLimit}회</strong></div><small>오늘 남은 랜덤 상자 ${me.randomBoxesRemaining}회</small><small>${owned}</small></div>${stockNotice}${cost ? `<button class="upgrade-cta draw-cta${canAffordDraw ? "" : " resource-insufficient"}" type="button" data-draw data-cost-gold="${cost.gold}" data-cost-power="${cost.power}"${me.randomBoxesRemaining <= 0 ? ' data-build-limit="true"' : ''} ${canAffordDraw ? "" : 'disabled aria-disabled="true"'}><span data-cost-action-label data-ready-label="${me.drawCount + 1}번째 랜덤 뽑기">${me.randomBoxesRemaining <= 0 ? '랜덤 상자 횟수 부족' : `${me.drawCount + 1}번째 랜덤 뽑기${canAffordDraw ? "" : " · 재화 부족"}`}</span><strong>${resourceCostMarkup(cost)}</strong></button>` : `<button class="btn ghost panel-disabled" disabled>이번 판 ${drawLimit}회 완료</button>`}<small class="odds-note">신화·전설 아이템은 매우 낮은 확률이며, 꽝 장식품은 단 두 종류만 등장합니다.</small>${removalMarkup}`;
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
  const matchTrait = characterTraitForMatch(me.appearance, Boolean(snapshot?.ranked));
  const traitMaximum = matchTrait.basicTurretMaxLevel;
  const maxLevel = maxBuildingLevel(kind, modeRank, traitMaximum);
  const nextLevel = currentLevel + 1;
  const current = buildingStats(kind, currentLevel);
  const doorDestroyed = selection.type === "door" && (room?.doorHp ?? 0) <= 0;
  const requirement = upgradeRequirement(kind, currentLevel, {
    bedLevel: room?.bedLevels[me.bedIndex ?? 0] ?? 1,
    doorLevel: room?.doorLevel ?? 1,
  });
  const cost =
    !doorDestroyed && !requirement && currentLevel < maxLevel
      ? upgradeCostForTrait(
          kind,
          upgradeCost(kind, nextLevel, modeRank, traitMaximum),
          matchTrait,
        )
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
  const tutorialUpgradeTarget = Boolean(
    upgradeButton &&
      snapshot.tutorial?.active &&
      ((snapshot.tutorial.step === "upgrade-bed" && selection.type === "bed") ||
        (snapshot.tutorial.step === "upgrade-door" && selection.type === "door") ||
        (snapshot.tutorial.step === "upgrade-turret" &&
          selection.type === "building" &&
          kind === "basic-turret")),
  );
  if (tutorialUpgradeTarget && upgradeButton) {
    panel.classList.add("tutorial-upgrade-lock");
    panel
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((button) => {
        if (button !== upgradeButton) button.disabled = true;
      });
    upgradeButton.insertAdjacentHTML(
      "afterend",
      '<div class="tutorial-upgrade-pointer" aria-hidden="true"><i>↑</i><span>이 버튼을 눌러 강화하세요</span></div>',
    );
  }
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
  if (snapshot.tutorial?.active) {
    closeBuildPanel();
    return;
  }
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
    const previousBuilding = selectedTarget.buildingId
      ? previous?.buildings.find(
          (building) => building.id === selectedTarget?.buildingId,
        )
      : undefined;
    const nextBuilding = selectedTarget.buildingId
      ? snapshot?.buildings.find(
          (building) => building.id === selectedTarget?.buildingId,
        )
      : undefined;
    const previousLureCooldown = previousBuilding?.kind === "ghost-lure-beacon"
      ? Math.max(0, Math.ceil((previousBuilding.lureReadyAt ?? 0) - (previous?.elapsed ?? 0)))
      : null;
    const nextLureCooldown = nextBuilding?.kind === "ghost-lure-beacon"
      ? Math.max(0, Math.ceil((nextBuilding.lureReadyAt ?? 0) - (snapshot?.elapsed ?? 0)))
      : null;
    const previousLureRespawning = previousBuilding?.kind === "ghost-lure-beacon"
      ? previous?.ghosts.some((ghost) => ghost.hp > 0 && (ghost.retreating || ghost.healing))
      : false;
    const nextLureRespawning = nextBuilding?.kind === "ghost-lure-beacon"
      ? snapshot?.ghosts.some((ghost) => ghost.hp > 0 && (ghost.retreating || ghost.healing))
      : false;
    const lurePanelChanged = nextBuilding?.kind === "ghost-lure-beacon" && (
      previousBuilding?.lureUses !== nextBuilding.lureUses ||
      previousLureCooldown !== nextLureCooldown ||
      previousLureRespawning !== nextLureRespawning
    );
    if (selectedTarget.type === "building" && after === null) {
      closeBuildPanel();
      return;
    }
    if (
      previous === null ||
      before !== after ||
      previousPlayer?.drawCount !== nextPlayer?.drawCount ||
      doorDestroyed ||
      lurePanelChanged ||
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
  lastSentMovementActive = false;
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

function flushMovement(releasePosition?: Vec2): boolean {
  pendingMovementTimer = 0;
  const nextInputSequence = inputSequence + 1;
  const sent = network?.move(
    inputVector.x,
    inputVector.y,
    nextInputSequence,
    releasePosition,
  ) ?? false;
  if (!sent) {
    // Do not acknowledge a sequence locally when no packet left the device.
    // The unsequenced setLocalInput() call still provides immediate visuals,
    // and the next pointer/keepalive edge will retry this same sequence.
    lastSentMovementActive = false;
    return false;
  }
  inputSequence = nextInputSequence;
  lastMovementSentAt = performance.now();
  // Keep prediction tied to the exact input accepted by the socket, so a bot
  // occupancy frame cannot be mistaken for a movement collision.
  game?.setLocalInput(inputVector, nextInputSequence);
  lastSentMovementActive = Math.hypot(inputVector.x, inputVector.y) > 0.001;
  return true;
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
  }, MOVEMENT_KEEPALIVE_INTERVAL_MS);
}

function sendMovement(
  force = false,
  includeReleasePosition = true,
): void {
  if (movementLockedByIntro()) {
    resetMovementForIntro();
    return;
  }
  game?.setLocalInput(inputVector);
  syncMovementKeepalive();
  if (force) {
    if (pendingMovementTimer) window.clearTimeout(pendingMovementTimer);
    const releasePosition =
      includeReleasePosition && Math.hypot(inputVector.x, inputVector.y) <= 0.001
        ? game?.getLocalRenderedPosition() ?? undefined
        : undefined;
    const sent = flushMovement(releasePosition);
    if (!sent && network && currentView === "game") {
      // A stop packet is just as important as a start packet. Recompute from
      // the current input on retry so a resumed drag cannot be paired with a
      // stale releasePosition (which the protocol correctly rejects).
      pendingMovementTimer = window.setTimeout(
        () => sendMovement(true, includeReleasePosition),
        MOVEMENT_SEND_INTERVAL_MS,
      );
    }
    return;
  }
  // pointer-down sends a zero vector first. Never throttle the first non-zero
  // vector behind it: iOS may deliver that move immediately before pointer-up,
  // whose forced zero would otherwise cancel the only real movement packet.
  if (shouldFlushMovementStart(lastSentMovementActive, inputVector)) {
    if (pendingMovementTimer) window.clearTimeout(pendingMovementTimer);
    pendingMovementTimer = 0;
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
      "door-repair",
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
  const freeRepair = events.find(
    (event) => event.kind === "door-repair" && event.playerId === playerId,
  );
  if (freeRepair?.label) toast(`${freeRepair.label} · 5초간 초당 15`);
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
  const localRoomId = snapshot?.players.find(
    (player) => player.id === playerId,
  )?.roomId;
  const localGoldLock = events.find(
    (event) =>
      event.kind === "ghost-skill" &&
      event.itemId === "gold-lock" &&
      event.roomId === localRoomId &&
      event.label === "골드 획득 봉인 5초",
  );
  if (localGoldLock)
    toast("귀신이 내 문을 공격해 골드 획득이 봉인됐습니다.");
  const lightsOn = events.find((event) => event.kind === "lights-on");
  if (lightsOn?.label) toast(lightsOn.label);
  const autoBedClaim = events.find(
    (event) => event.kind === "auto-bed-claim" && event.playerId === playerId,
  );
  if (autoBedClaim?.label) showCenteredGameNotice(autoBedClaim.label);
  const starterAllocation = events.find(
    (event) => event.kind === "starter-allocation" && event.playerId === playerId,
  );
  if (starterAllocation?.label)
    showCenteredGameNotice(starterAllocation.label, 3_000);
  if (
    events.some(
      (event) =>
        event.kind === "ghost-skill" &&
        event.label === TIME_ATTACK_EXPIRED_MESSAGE,
    )
  )
    showCenteredGameNotice(TIME_ATTACK_EXPIRED_MESSAGE, 3_000);
  if (
    profile.vibration &&
    events.some(
      (event) => event.kind === "door-hit" || event.kind === "player-hit",
    )
  )
    navigator.vibrate?.(35);
}

function showCenteredGameNotice(label: string, duration = 2_400): void {
  const notice = app.querySelector<HTMLElement>("[data-time-attack-expired]");
  if (!notice) return;
  notice.textContent = label;
  notice.classList.remove("hidden");
  window.requestAnimationFrame(() => notice.classList.add("show"));
  window.clearTimeout(timeAttackExpiredTimer);
  timeAttackExpiredTimer = window.setTimeout(() => {
    notice.classList.remove("show");
    window.setTimeout(() => notice.classList.add("hidden"), 220);
  }, duration);
}

const QUICK_CHAT_PHRASES: readonly QuickChatPhrase[] = [
  "문 위험!",
  "포탑 강화해!",
  "내가 끝낼게!",
  "좋은 아이템 발견!",
];

function showQuickChatPicker(): void {
  quickChatCleanup?.();
  const picker = document.createElement("section");
  picker.className = "quick-chat-picker";
  picker.setAttribute("aria-label", "인게임 팀 채팅");
  const emoteOptions = (account?.prestige.equippedEmoteIds ?? []).map((id) => prestigeEmoteById(id)).filter(Boolean);
  picker.innerHTML = `<header><strong>팀 채팅</strong><button type="button" class="quick-chat-close" data-chat-close aria-label="채팅 닫기">×</button></header><form class="game-chat-form" data-game-chat-form><input data-game-chat-input maxlength="80" autocomplete="off" enterkeyhint="send" placeholder="메시지를 입력하세요" aria-label="팀 채팅 메시지"/><button type="submit">전송</button></form><div class="quick-chat-options" aria-label="빠른 문구">${QUICK_CHAT_PHRASES.map((phrase) => `<button type="button" data-quick-phrase="${escapeHtml(phrase)}">${escapeHtml(phrase)}</button>`).join("")}</div>${emoteOptions.length ? `<div class="quick-chat-emotes" aria-label="장착 이모티콘">${emoteOptions.map((emote) => `<button type="button" data-game-emote="${emote!.id}" aria-label="${escapeHtml(emote!.label)}"><img src="${emote!.assetUrl}" alt=""/></button>`).join('')}</div>` : ''}`;
  const stableHeight = app.offsetHeight;
  const pageScrollY = window.scrollY;
  app.style.setProperty("--chat-stable-height", `${stableHeight}px`);
  app.classList.add("chat-keyboard-open");
  document.documentElement.classList.add("game-chat-active");
  document.body.classList.add("game-chat-active");
  app.appendChild(picker);
  const positionPicker = (): void => {
    if (!picker.isConnected) return;
    const viewport = window.visualViewport;
    const visibleTop = viewport?.offsetTop ?? 0;
    const visibleHeight = viewport?.height ?? window.innerHeight;
    const panelTop = Math.max(
      visibleTop + 8,
      visibleTop + visibleHeight - picker.offsetHeight - 12,
    );
    picker.style.top = `${panelTop}px`;
  };
  const closePicker = (): void => {
    window.visualViewport?.removeEventListener("resize", positionPicker);
    window.visualViewport?.removeEventListener("scroll", positionPicker);
    app.classList.remove("chat-keyboard-open");
    app.style.removeProperty("--chat-stable-height");
    document.documentElement.classList.remove("game-chat-active");
    document.body.classList.remove("game-chat-active");
    picker.remove();
    window.scrollTo(0, pageScrollY);
    if (quickChatCleanup === closePicker) quickChatCleanup = null;
  };
  quickChatCleanup = closePicker;
  window.visualViewport?.addEventListener("resize", positionPicker);
  window.visualViewport?.addEventListener("scroll", positionPicker);
  picker
    .querySelector("[data-chat-close]")
    ?.addEventListener("click", closePicker);
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
      closePicker();
    });
  picker
    .querySelectorAll<HTMLButtonElement>("[data-quick-phrase]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const phrase = button.dataset.quickPhrase as QuickChatPhrase;
        if (!QUICK_CHAT_PHRASES.includes(phrase)) return;
        network?.quickChat(phrase);
        audio.play("button");
        closePicker();
      }),
    );
  picker.querySelectorAll<HTMLButtonElement>('[data-game-emote]').forEach((button) => button.addEventListener('click', () => {
    network?.gameEmote(button.dataset.gameEmote ?? '');
    audio.play('button');
    closePicker();
  }));
  window.setTimeout(() => {
    positionPicker();
    picker
      .querySelector<HTMLInputElement>("[data-game-chat-input]")
      ?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    window.requestAnimationFrame(positionPicker);
  }, 0);
}

function showQuickChatBubble(nickname: string, phrase: string, emoteUrl?: string): void {
  const existing = app.querySelector(".quick-chat-bubble");
  existing?.remove();
  const bubble = document.createElement("div");
  bubble.className = "quick-chat-bubble";
  bubble.innerHTML = `<strong>${escapeHtml(nickname)}</strong>${emoteUrl ? `<img class="game-emote-message" src="${escapeHtml(emoteUrl)}" alt="${escapeHtml(phrase)}"/>` : `<span>${escapeHtml(phrase)}</span>`}`;
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

function showConsumableTurretConfirm(
  itemId: ConsumableId,
  target: GameSnapshot["buildings"][number],
): void {
  const item = shopConsumableById(itemId);
  if (!item) {
    consumableTurretTargetingId = null;
    return;
  }
  const modal = dismissibleModal(
    `<section class="panel compact purchase-confirm" role="dialog" aria-modal="true" aria-label="전술 보급품 사용 확인"><span class="eyebrow">TACTICAL SUPPLY</span><h2>${escapeHtml(item.label)}을 사용하시겠습니까?</h2><p class="subtitle">선택한 Lv.${target.level} 포탑에 적용합니다.</p><div class="purchase-confirm-actions"><button class="btn ghost" data-cancel-consumable>취소</button><button class="btn gold" data-confirm-consumable>사용</button></div></section>`,
    "purchase-confirm-modal",
  );
  const cancel = (): void => {
    consumableTurretTargetingId = null;
    modal.remove();
  };
  modal.addEventListener("pointerdown", (event) => {
    if (event.target === modal) cancel();
  });
  modal
    .querySelector<HTMLButtonElement>("[data-cancel-consumable]")
    ?.addEventListener("click", cancel);
  modal
    .querySelector<HTMLButtonElement>("[data-confirm-consumable]")
    ?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      consumableTurretTargetingId = null;
      network?.useConsumable(itemId, { targetId: target.id });
      audio.play("button");
      modal.remove();
    });
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
  const isInGameSettings = currentView === "game" || currentView.startsWith("hide-seek");
  const showHomeVersion = currentView === "home";
  const leaveAction = network || hideSeekExperience
    ? '<button class="btn danger settings-leave" data-leave-game data-testid="leave-game">게임 나가기</button>'
    : "";
  const logoutAction =
    account && !isInGameSettings
      ? '<button class="btn ghost settings-logout" data-logout-account>로그아웃</button>'
      : "";
  const versionMarkup = showHomeVersion
    ? `<div class="settings-version" data-settings-version><div><span>현재 버전</span><strong>${APP_RELEASE_VERSION}</strong></div><small data-version-status>최신 버전 확인 중…</small><button class="btn primary hidden" type="button" data-settings-update>업데이트</button></div>`
    : "";
  modal.innerHTML = `<section class="panel compact"><span class="eyebrow">SETTINGS</span><h2>게임 설정</h2><div class="setting-row"><span>배경음</span><button class="vibration-toggle ${profile.musicEnabled ? "on" : "off"}" type="button" aria-pressed="${profile.musicEnabled}" data-music-toggle>${profile.musicEnabled ? "켜짐" : "꺼짐"}</button></div><label class="setting-row"><span>배경음 음량</span><input type="range" min="0" max="1" step="0.05" value="${profile.musicVolume}" data-music-volume ${profile.musicEnabled ? "" : "disabled"}></label><label class="setting-row"><span>효과음 음량</span><input type="range" min="0" max="1" step="0.05" value="${profile.volume}" data-volume></label><div class="setting-row"><span>진동 피드백</span><button class="vibration-toggle ${profile.vibration ? "on" : "off"}" type="button" aria-pressed="${profile.vibration}" data-vibration>${profile.vibration ? "켜짐" : "꺼짐"}</button></div><p class="subtitle settings-note">실제 기기 식별 정보는 수집하지 않습니다. 브라우저에 생성한 임의 UUID만 재접속에 사용합니다.</p>${versionMarkup}<div class="settings-actions">${leaveAction}${logoutAction}<button class="btn primary" data-close>완료</button></div></section>`;
  app.appendChild(modal);
  const versionStatus =
    modal.querySelector<HTMLElement>("[data-version-status]");
  const settingsUpdate =
    modal.querySelector<HTMLButtonElement>("[data-settings-update]");
  settingsUpdate?.addEventListener("click", () => {
    const latestVersion = settingsUpdate.dataset.latestVersion;
    if (!latestVersion) return;
    settingsUpdate.disabled = true;
    settingsUpdate.textContent = "업데이트 중…";
    void forceRefreshForUpdate(latestVersion, { resetWorker: true });
  });
  if (showHomeVersion) {
    void fetchLatestAppUpdate()
      .then((latest) => {
        if (!modal.isConnected || !versionStatus || !settingsUpdate) return;
        if (
          latest &&
          isUpdateAvailable(APP_RELEASE_VERSION, latest.version)
        ) {
          versionStatus.textContent = `최신 ${latest.version}`;
          settingsUpdate.dataset.latestVersion = latest.version;
          settingsUpdate.classList.remove("hidden");
        } else {
          versionStatus.textContent = "최신 버전입니다";
        }
      })
      .catch(() => {
        if (versionStatus && modal.isConnected)
          versionStatus.textContent = "버전 확인 실패";
      });
  }
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
      if (hideSeekExperience) {
        hideSeekExperience.requestLeave();
        return;
      }
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

async function fetchLatestAppUpdate(): Promise<AppUpdate | null> {
  const response = await fetch(
    `/api/app-updates/latest?checkedAt=${Date.now()}`,
    {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "cache-control": "no-cache" },
    },
  );
  if (!response.ok) throw new Error("최신 버전을 확인하지 못했습니다.");
  const data = (await response.json()) as { latest?: AppUpdate | null };
  return data.latest ?? null;
}

function announcementStorageKey(): string {
  return `midnight-dorm-seen-announcement:${account?.id ?? "guest"}`;
}

function syncAnnouncementUnreadIndicators(): void {
  app.querySelectorAll<HTMLElement>("[data-announcement-alert]").forEach((indicator) =>
    indicator.classList.toggle("visible", announcementUnread),
  );
}

async function refreshAnnouncementUnread(): Promise<void> {
  try {
    const latest = await fetchLatestAppUpdate();
    announcementUnread = Boolean(latest && localStorage.getItem(announcementStorageKey()) !== latest.version);
    syncAnnouncementUnreadIndicators();
  } catch {
    // Announcements are supplementary; avoid blocking home if the feed is unavailable.
  }
}

function markAnnouncementRead(version: string): void {
  localStorage.setItem(announcementStorageKey(), version);
  announcementUnread = false;
  syncAnnouncementUnreadIndicators();
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
    // The unread badge is calculated from `/latest`, not merely the first D1
    // row in the history list. Resolve that same canonical version before
    // marking it read so returning home cannot recreate the red dot.
    const latest = await fetchLatestAppUpdate().catch(() => null);
    const readVersion = latest?.version ?? updates[0]?.version;
    if (readVersion) markAnnouncementRead(readVersion);
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
  const socket = new WebSocket(nativeWebSocketUrlSync("/api/social/ws"));
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
  const avatar = profileAvatarSource(person.avatarUrl);
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
  inviteMode: SocialInviteMode = "defense",
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
      content.innerHTML = `<section class="social-section"><h3>받은 방 초대</h3>${social.invites.length ? social.invites.map((invite: SocialInvite) => socialPersonCard(invite, `<button data-social-invite-action="accept" data-social-invite-id="${invite.id}">수락</button><button class="ghost" data-social-invite-action="decline" data-social-invite-id="${invite.id}">거절</button>`, `${invite.mode === "hide-seek" ? "술래잡기 초대" : "친구방 초대"} · ${invite.roomCode}`)).join("") : '<p class="social-empty">받은 방 초대가 없습니다.</p>'}</section>`;
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
          if (!action || !id || button.disabled) return;
          const card = button.closest<HTMLElement>(".social-person-card");
          const actionButtons = card
            ? Array.from(card.querySelectorAll<HTMLButtonElement>("button"))
            : [button];
          actionButtons.forEach((candidate) => {
            candidate.disabled = true;
          });
          void socialPost(
            `/api/social/friends/${encodeURIComponent(id)}/${action}`,
          )
            .then(async () => {
              await reload();
              await render();
            })
            .catch((error: unknown) => {
              actionButtons.forEach((candidate) => {
                candidate.disabled = false;
              });
              toast(
                error instanceof Error
                  ? error.message
                  : "친구 요청을 처리하지 못했습니다.",
              );
            });
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
            mode: inviteMode,
          })
            .then(() => toast(inviteMode === "hide-seek" ? "친구에게 술래잡기 초대를 보냈습니다." : "친구에게 방 초대를 보냈습니다."))
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
                if (data.mode === "hide-seek") await joinHideSeekRoom(data.roomCode);
                else await joinRoomFromInvite(data.roomCode);
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

async function forceRefreshForUpdate(
  version: string,
  options: { resetWorker?: boolean } = { resetWorker: true },
): Promise<void> {
  const resetWorker = options.resetWorker ?? true;
  let registrations: readonly ServiceWorkerRegistration[] = [];
  if ("serviceWorker" in navigator) {
    registrations = await navigator.serviceWorker
      .getRegistrations()
      .catch(() => []);
    await Promise.allSettled(
      registrations.map((registration) => registration.update()),
    );
  }

  const workers = new Set<ServiceWorker>();
  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    workers.add(navigator.serviceWorker.controller);
  }
  registrations.forEach((registration) => {
    if (registration.installing) workers.add(registration.installing);
    if (registration.waiting) workers.add(registration.waiting);
    if (registration.active) workers.add(registration.active);
  });
  await Promise.allSettled(
    [...workers].map(
      (worker) =>
        new Promise<void>((resolve) => {
          const channel = new MessageChannel();
          const timeout = window.setTimeout(resolve, 1_500);
          channel.port1.onmessage = () => {
            window.clearTimeout(timeout);
            resolve();
          };
          try {
            worker.postMessage({ type: "PURGE_APP_CACHES" }, [channel.port2]);
          } catch {
            window.clearTimeout(timeout);
            resolve();
          }
        }),
    ),
  );

  if ("caches" in window) {
    const keys = await caches.keys().catch(() => []);
    await Promise.allSettled(keys.map((key) => caches.delete(key)));
  }
  if (resetWorker) {
    await Promise.allSettled(
      registrations.map((registration) => registration.unregister()),
    );
  }

  const nonce = `${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  const nextUrl = buildForceRefreshUrl(location.href, version, nonce);
  // Warm the exact one-use URL from the network before navigating. The old
  // controller may remain attached until this document closes, but the unique
  // URL plus reload cache mode prevents it and WebKit from returning old HTML.
  await fetch(nextUrl, {
    cache: "reload",
    credentials: "same-origin",
    headers: { "cache-control": "no-cache" },
  }).catch(() => undefined);
  location.replace(nextUrl);
}

function recoverFromStaleBundle(error: unknown): boolean {
  if (!isStaleDynamicImportError(error)) return false;
  if (staleBundleRefreshStarted) return true;

  const refreshKey = `midnight-dorm:stale-bundle:${APP_RELEASE_VERSION}`;
  let refreshedRecently = false;
  try {
    const previous = Number(sessionStorage.getItem(refreshKey) ?? 0);
    refreshedRecently = Number.isFinite(previous) && Date.now() - previous < 60_000;
    if (!refreshedRecently) sessionStorage.setItem(refreshKey, String(Date.now()));
  } catch {
    // Storage can be unavailable in private WebViews. The in-memory guard
    // still prevents repeated recovery inside this document.
  }
  if (refreshedRecently) return false;

  staleBundleRefreshStarted = true;
  connectionOverlay("최신 게임 파일로 갱신하는 중…");
  void forceRefreshForUpdate(APP_RELEASE_VERSION).catch(() => location.reload());
  return true;
}

window.addEventListener("vite:preloadError", (event) => {
  const preloadEvent = event as Event & { payload?: unknown };
  if (!recoverFromStaleBundle(preloadEvent.payload)) return;
  // Vite otherwise rethrows the failed import after dispatching this event.
  event.preventDefault();
});

async function checkForAppUpdate(): Promise<void> {
  if (testShellMode || updatePromptOpen) return;
  try {
    const latest = await fetchLatestAppUpdate();
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
  if (snapshot?.ranked && network) {
    const leavingNetwork = network;
    leavingNetwork.leaveRoom();
    // The room-exit message normally performs cleanup. Keep a short fallback
    // for a socket that closes between the explicit ranked abandon request
    // and the acknowledgement.
    window.setTimeout(() => {
      if (network !== leavingNetwork || currentView !== "game") return;
      const code = leavingNetwork.code;
      leavingNetwork.close();
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
    }, 1_200);
    return;
  }
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
  if (element && element.textContent !== value) element.textContent = value;
}

function destroyGame(): void {
  window.removeEventListener(
    "dorm:tile-selected",
    onTileSelected as EventListener,
  );
  window.removeEventListener(
    "dorm:ground-tile-selected",
    onGroundTileSelected as EventListener,
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
  openingMinimapMapKey = "";
  openingMinimapTrails.clear();
  openingMinimapStaticLayer = null;
  openingMinimapStaticLayerKey = "";
  inputVector = { x: 0, y: 0 };
  lastSentMovementActive = false;
  consumableTurretTargetingId = null;
  consumableTileTargetingId = null;
  quickChatCleanup?.();
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
      sendMovement(true, false);
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
let pageHiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  audio.setPageVisible(!document.hidden);
  if (document.hidden) {
    pageHiddenAt = performance.now();
    game?.pause();
    return;
  }
  // Mobile browsers can suspend a lobby WebSocket without dispatching a
  // close event. Replace a deceptively OPEN socket after a real suspension.
  const suspendedFor = pageHiddenAt > 0 ? performance.now() - pageHiddenAt : 0;
  pageHiddenAt = 0;
  if (suspendedFor >= 1_500) network?.wakeAfterSuspension();
  else {
    network?.connect();
    network?.resync();
  }
  if (suspendedFor >= 1_500) hideSeekExperience?.wakeAfterSuspension();
  if (!game) return;
  game.resume();
});

function renderUiPreview(mode: string): void {
  if (mode === "hide-seek-entry" || mode === "hide-seek-lobby") {
    if (!hideSeekPreviewStylesLoaded) {
      void import("./hideSeek").then(() => {
        hideSeekPreviewStylesLoaded = true;
        renderUiPreview(mode);
      }).catch((error) => {
        recoverFromStaleBundle(error);
      });
      return;
    }
  }
  if (mode === "hide-seek-entry") {
    currentView = "home";
    audio.setBackgroundTrack(null);
    app.dataset.view = "home";
    app.innerHTML = '<main class="game-home" aria-hidden="true"></main>';
    showHideSeekEntry();
    return;
  }
  if (mode === "hide-seek-lobby") {
    currentView = "hide-seek-lobby";
    audio.setBackgroundTrack(null);
    app.dataset.view = "hide-seek-lobby";
    app.innerHTML = `<main class="hide-seek-lobby"><div class="hide-seek-lobby-art" aria-hidden="true"><img src="/assets/hide-seek/lantern-ghost-v2.webp" alt=""/></div><header><span class="hide-seek-lobby-emblem" aria-hidden="true">☾</span><div><small>NIGHT CHASE</small><h1>심야 술래잡기</h1></div><button class="hide-seek-code"><small>초대 코드</small><strong>J3886B4M</strong></button></header><section class="hide-seek-rule-card"><span>최대 1 VS 6</span><h2>불이 꺼지면, 소리 없이 숨으세요</h2><p>20초 동안 숨고 열쇠 5개를 모아 탈출하세요. 랜턴에 잡히면 추격이 시작됩니다.</p></section><section class="hide-seek-role-picker"><small>희망 역할</small><div><button>생존자</button><button class="active">상관없음</button><button>술래</button></div></section><section class="hide-seek-roster"><header><strong>참가자 <b>7/7</b></strong><small>술래 1명 · 생존자 최대 6명</small></header><ol>${['루키바보', '야간봇 1', '야간봇 2', '야간봇 3', '야간봇 4', '야간봇 5', '야간봇 6'].map((name, index) => `<li class="${index === 0 ? 'host' : ''}"><span class="hide-seek-member-badge"><img src="${rankBadgeImage(index > 4 ? 'expert' : index > 2 ? 'intermediate' : 'beginner')}" alt=""/><em>${index === 0 ? '01' : 'BOT'}</em></span><div><strong>${name}${index === 0 ? ' ★' : ''}</strong><small>${index > 4 ? '고수' : index > 2 ? '중수' : '하수'} · 역할 무관</small></div><b class="ready">READY</b>${index > 0 ? '<button aria-label="봇 제거">봇 제거</button>' : ''}</li>`).join('')}</ol></section><footer><div class="hide-seek-lobby-tools"><button class="danger">방 나가기</button><button>＋ 봇 추가</button><button>빈자리 채우기</button></div><div class="hide-seek-lobby-actions"><button class="secondary">준비</button><button class="primary">추격 시작</button></div></footer></main>`;
    return;
  }
  if (mode === "opening") {
    currentView = "opening";
    audio.setBackgroundTrack(null);
    app.dataset.view = "opening";
    app.innerHTML = openingMarkup();
    return;
  }
  if (mode === "loading") {
    setContent(
      "loading",
      loadingMarkup("7병동으로 이동 중", "잠시 후 생존 임무가 시작됩니다."),
    );
    return;
  }
  if (mode === "auth-register") {
    authScreen("register");
    return;
  }
  if (mode === "result-victory" || mode === "result-defeat") {
    const victory = mode === "result-victory";
    setContent(
      "result",
      resultScreenMarkup({
        victory,
        stageLabel: "어려움 5",
        title: victory ? "생존" : "스테이지 종료",
        description: victory
          ? "마지막 귀신을 몰아내고 병동의 아침을 지켜냈습니다."
          : "괜찮아요. 방어선을 정비하고 다시 도전해보세요.",
        elapsedLabel: victory ? "08:42" : "04:18",
        ghostLevel: victory ? 15 : 9,
        rewardMarkup: victory
          ? '<div class="result-reward"><span>CLEAR REWARD</span><strong>✦ +120 P</strong><small>전리품을 수령하면 포인트가 계정에 지급됩니다.</small></div>'
          : '<div class="result-reward muted"><span>CHALLENGE RECORD</span><strong>도전 기록 저장</strong><small>이번 판에서 달성한 진행 기록은 그대로 유지됩니다.</small></div>',
        actionsMarkup: victory
          ? '<div class="result-actions victory-claim-actions"><button class="btn ghost">전리품 수령</button><button class="btn primary">2배 수령</button></div>'
          : '<div class="result-actions"><button class="btn primary">다시 도전</button><button class="btn ghost">게임 메뉴</button></div>',
      }),
    );
    return;
  }
  authScreen("login");
}

if ("serviceWorker" in navigator && !devMode && !isNativeApp)
  window.addEventListener(
    "load",
    () =>
      void navigator.serviceWorker
        .register(`/sw.js?v=${encodeURIComponent(APP_RELEASE_VERSION)}`, {
          updateViaCache: "none",
        })
        .then((registration) => registration.update())
        .catch(() => undefined),
  );

loading();
if (uiPreviewMode) {
  window.setTimeout(() => renderUiPreview(uiPreviewMode), 0);
} else {
  if (!isNativeApp) void checkForAppUpdate();
  window.setTimeout(() => {
    const mobile =
      matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
    if (!devMode && !mobile) desktopNotice();
    else openingTeaser(() => void resumeOrEnter());
  }, 350);
}

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
  const hideSeekCode = profile.activeHideSeekRoomCode;
  const hideSeekToken = profile.reconnectTokens[`hide-seek:${hideSeekCode}`];
  if (!freshMode && /^[A-Z2-9]{8}$/.test(hideSeekCode) && hideSeekToken) {
    try {
      const response = await fetch(`/api/hide-seek/rooms/${hideSeekCode}/status`, { cache: "no-store" });
      const room = (await response.json().catch(() => null)) as { exists?: boolean; phase?: string } | null;
      if (!response.ok || !room?.exists || room.phase === "RESULT" || room.phase === "CLOSED") throw new Error("ended");
      await connectToHideSeekRoom(hideSeekCode);
      return;
    } catch {
      profile.activeHideSeekRoomCode = "";
      delete profile.reconnectTokens[`hide-seek:${hideSeekCode}`];
      saveProfile(profile);
    }
  }
  const code = profile.recentRoomCode;
  const tutorialRequired = !account.tutorialCompleted;
  if (
    freshMode ||
    !/^[A-Z2-9]{8}$/.test(code) ||
    !profile.reconnectTokens[code]
  ) {
    if (tutorialRequired) await createRoom(true, "tutorial-1");
    else homeScreen();
    return;
  }
  try {
    const room = await getRoomStatus(code);
    if (!isResumableRoom(room.status)) throw new Error("ended");
    connectToRoom(code, false);
  } catch {
    forgetRoom(code);
    if (tutorialRequired) await createRoom(true, "tutorial-1");
    else homeScreen();
  }
}
