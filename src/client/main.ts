import {
  BALANCE,
  buildingStats,
  maxBuildingLevel,
  upgradeCost,
  upgradeRequirement,
} from "../shared/balance";
import { DRAW_COSTS, getRandomItem } from "../shared/randomItems";
import { SHOP_CONSUMABLES, shopConsumableById } from "../shared/shopConsumables";
import {
  characterTrait,
  characterTraitForAppearance,
  drawLimitForAppearance,
} from "../shared/characterTraits";
import { turretSkinTrait } from "../shared/turretSkinTraits";
import {
  characterAvailable,
  cosmeticAvailable,
  cosmeticById,
  cosmeticsForSlot,
  customizationReward,
  defaultSkinForCharacter,
} from "../shared/customization";
import {
  rankBadgeImage,
  rankBenefits,
  getStage,
  rankedBadgeImage,
  RANKED_TIER_LABEL,
  rankLabel,
  stagesThrough,
} from "../shared/progression";
import { stageThemeFor } from "../shared/stageThemes";
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
  RankId,
  StageId,
  Tile,
  Vec2,
} from "../shared/types";
import { SynthAudio, type BackgroundTrack } from "./audio";
import {
  equipCosmetic,
  getAccount,
  loginAccount,
  logoutAccount,
  purchaseCosmetic,
  purchaseConsumable,
  registerAccount,
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
let account: AccountProfile | null = null;
let customizeReturnView: "home" | "room-menu" = "home";
type HomePlayMode = PlayMode | 'ranked';
let homePlayMode: HomePlayMode = "solo";
const homeStageSelection: Partial<Record<PlayMode, StageId>> = {};
let selectedTile: Tile | null = null;
let selectedTarget: SceneSelection | null = null;
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
let tileSelectionBlockedUntil = 0;
let buildPanelInputBlockedUntil = 0;
const pendingActions = new Map<string, number>();
let ping = 0;
let resultRecorded = false;
let toastTimer = 0;
let deathNoticeTimer = 0;
let rankedQueuePollTimer = 0;
const e2eMode = new URLSearchParams(location.search).get("e2e") === "1";
const automationMode =
  new URLSearchParams(location.search).get("automation") === "1";
const testShellMode = e2eMode || automationMode;
const devMode = new URLSearchParams(location.search).get("dev") === "1";
const freshMode = new URLSearchParams(location.search).get("fresh") === "1";
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
  "starter-grave": "†",
};

interface RoomStatusResponse {
  exists: boolean;
  status: GameStatus;
  players: number;
}

interface RankedQueueResponse {
  status: 'waiting' | 'matched' | 'idle';
  elapsedSeconds: number;
  playerCount: number;
  requiredPlayers: number;
  ratingWindow: number;
  players: Array<{ nickname: string; rating: number }>;
  roomCode?: string;
  botCount?: number;
}

const isResumableRoom = (status: GameStatus): boolean =>
  status === "LOBBY" || status === "EVENT_INTRO" || status === "COUNTDOWN" || status === "PLAYING" || status === 'OVERTIME';
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
  if (mode === 'ranked') {
    const rankText = `${RANKED_TIER_LABEL[currentAccount.ranked.tier]} · ${currentAccount.ranked.rating} RP`;
    return {
      mode,
      modeLabel: '랭크전',
      rankText,
      labelText: `랭크전 · ${rankText}`,
      badgeUrl: rankedBadgeImage(currentAccount.ranked.tier),
      badgeAlt: `${RANKED_TIER_LABEL[currentAccount.ranked.tier]} 랭크 뱃지`,
      className: `ranked-profile tier-${currentAccount.ranked.tier}`,
    };
  }
  const rank = mode === 'multiplayer' ? currentAccount.multiplayerRank : currentAccount.soloRank;
  const modeLabel = mode === 'multiplayer' ? '친구랑하기' : '혼자하기';
  return {
    mode,
    modeLabel,
    rankText: rankLabel(rank),
    labelText: `${modeLabel} · ${rankLabel(rank)}`,
    badgeUrl: rankBadgeImage(rank),
    badgeAlt: `${rankLabel(rank)} 등급 뱃지`,
    className: `rank-border-${rank}`,
  };
}

function playerProfileDisplayInfo(player: PlayerState): ProfileDisplayInfo {
  if (player.profileDisplayMode === 'ranked') {
    const rankText = `${RANKED_TIER_LABEL[player.profileRankedTier]} · ${player.profileRankedRating} RP`;
    return {
      mode: 'ranked',
      modeLabel: '랭크전',
      rankText,
      labelText: `랭크전 · ${rankText}`,
      badgeUrl: rankedBadgeImage(player.profileRankedTier),
      badgeAlt: `${RANKED_TIER_LABEL[player.profileRankedTier]} 랭크 뱃지`,
      className: `ranked-profile tier-${player.profileRankedTier}`,
    };
  }
  const rank = player.profileDisplayMode === 'multiplayer' ? player.multiplayerRank : player.soloRank;
  const modeLabel = player.profileDisplayMode === 'multiplayer' ? '친구랑하기' : '혼자하기';
  return {
    mode: player.profileDisplayMode,
    modeLabel,
    rankText: rankLabel(rank),
    labelText: `${modeLabel} · ${rankLabel(rank)}`,
    badgeUrl: rankBadgeImage(rank),
    badgeAlt: `${rankLabel(rank)} 등급 뱃지`,
    className: `rank-border-${rank}`,
  };
}

const profileBadgeHtml = (display: ProfileDisplayInfo, badgeClass = ''): string =>
  `<span class="rank-identity ${display.className}"><img class="rank-badge ${badgeClass}" src="${display.badgeUrl}" alt="${escapeHtml(display.badgeAlt)}" /><b>${escapeHtml(display.rankText)}</b></span>`;
const playerFaceHtml = (appearance: AvatarAppearance): string => {
  const animal = appearance.character.replace("character-", "");
  return `<span class="player-face face-${escapeHtml(animal)}" aria-hidden="true"><i class="face-ear left"></i><i class="face-ear right"></i><b class="face-eye left"></b><b class="face-eye right"></b><em></em></span>`;
};

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
  app.innerHTML = `${html}<button class="btn icon-btn" data-settings aria-label="설정">⚙</button><div class="toast" id="toast"></div>`;
  app.querySelector("[data-settings]")?.addEventListener("click", showSettings);
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
  const selectedNormalRank = homePlayMode === "multiplayer"
    ? currentAccount.multiplayerRank
    : currentAccount.soloRank;
  const profileDisplay = accountProfileDisplayInfo(currentAccount);
  const benefits = rankBenefits(selectedNormalRank);
  const stage = selectedHomeStage(currentAccount, homePlayMode);
  const modeLabel = homePlayMode === "solo" ? "혼자하기" : homePlayMode === 'multiplayer' ? "친구랑하기" : "랭크전";
  const stageLabel = homePlayMode === 'ranked' ? `${currentAccount.ranked.seasonId} 시즌 계약` : stage.label;
  const perk = `${benefits.speedMultiplier > 1 ? `이동 +${Math.round((benefits.speedMultiplier - 1) * 100)}%` : "기본 이동"} · 문 Lv.15 · 포탑 Lv.15`;
  setContent(
    "home",
    `<main class="game-home"><div class="home-atmosphere"></div><header class="home-topbar"><button class="home-account in-game-label ${profileDisplay.className}" data-profile-display-picker aria-haspopup="dialog" aria-label="인게임 라벨 선택"><div class="rank-emblem"><img class="home-profile-badge rank-badge" src="${profileDisplay.badgeUrl}" alt="${escapeHtml(profileDisplay.badgeAlt)}"/></div><div><span>인게임 라벨</span><strong>${escapeHtml(currentAccount.nickname)}</strong><small>${escapeHtml(profileDisplay.labelText)}</small><em>표시 설정</em></div></button><div class="home-utility"><strong>✦ ${currentAccount.customPoints.toLocaleString()} P</strong><button data-ranking aria-label="랭킹">${homeUtilityIcon("ranking")}</button><button data-home-settings aria-label="설정">${homeUtilityIcon("settings")}</button></div></header><section class="home-avatar-showcase" aria-label="병원 복도를 천천히 걷는 내 캐릭터"><div class="home-avatar-model" data-home-avatar></div></section><button class="home-stage-summary" data-home-stage-picker aria-label="스테이지 난이도 선택" ${homePlayMode === 'ranked' ? 'disabled' : ''}><span>${homePlayMode === 'ranked' ? '시즌 계약' : '현재 스테이지'}</span><strong>${stageLabel}</strong><small>${modeLabel} · ${homePlayMode === 'ranked' ? `배치 ${Math.min(5, currentAccount.ranked.placementCompleted)}/5 · ${currentAccount.ranked.eligible ? '참가 가능' : '참가 조건 확인'}` : perk}</small><i>⌄</i></button><footer class="home-actions"><div class="home-launch"><button class="home-mode-select" data-home-mode-picker aria-haspopup="dialog"><span>${homePlayMode === "solo" ? "☾" : homePlayMode === 'multiplayer' ? "◎" : "♛"}</span><div><small>플레이 방식</small><strong>${modeLabel}</strong></div><i>⌄</i></button><button class="game-start" data-stage-start data-testid="home-stage-start"><i>⚔</i><span><small>${stageLabel}</small>${homePlayMode === 'ranked' ? '계약 시작' : '스테이지 시작'}</span></button></div><nav class="home-footer-nav" aria-label="게임 메뉴"><button data-shop aria-label="상점">${homeFooterIcon("shop")}</button><button class="active" data-stage-menu aria-label="스테이지">${homeFooterIcon("stage")}</button><button data-customize aria-label="커스텀">${homeFooterIcon("custom")}</button></nav></footer></main>`,
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
    if (homePlayMode === 'ranked') void joinRankedQueue();
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
  app
    .querySelector("[data-home-settings]")
    ?.addEventListener("click", showSettings);
}

function homeUtilityIcon(kind: "ranking" | "settings"): string {
  if (kind === "ranking") {
    return '<svg class="home-utility-icon" viewBox="0 0 48 48" aria-hidden="true"><path d="m8 15 9 8 7-13 7 13 9-8-3 22H11z"/><path d="M12 32h24M14 38h20"/><circle cx="8" cy="13" r="2"/><circle cx="24" cy="8" r="2"/><circle cx="40" cy="13" r="2"/></svg>';
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
  const progressionMode: PlayMode = mode === 'multiplayer' ? 'multiplayer' : 'solo';
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
  modal.querySelector<HTMLButtonElement>("[data-purchase-confirm]")?.addEventListener("click", () => {
    modal.remove();
    options.onConfirm();
  });
}

function showHomeModePicker(): void {
  if (!account) return;
  const modal = dismissibleModal(
    `<section class="home-picker-sheet" role="dialog" aria-modal="true" aria-labelledby="mode-picker-title"><header><div><small>PLAY MODE</small><h2 id="mode-picker-title">플레이 방식 선택</h2></div><button data-modal-close aria-label="닫기">×</button></header><div class="home-mode-options"><button class="${homePlayMode === "solo" ? "selected" : ""}" data-home-mode="solo"><i>☾</i><span><strong>혼자하기</strong><small>생존 봇 3명과 함께 방어합니다.</small></span><b>선택</b></button><button class="${homePlayMode === "multiplayer" ? "selected" : ""}" data-home-mode="multiplayer"><i>◎</i><span><strong>친구랑하기</strong><small>친구와 실시간으로 협동합니다.</small></span><b>선택</b></button><button class="${homePlayMode === 'ranked' ? "selected" : ""} ${account.ranked.eligible ? '' : 'locked'}" data-home-mode="ranked" ${account.ranked.eligible ? '' : 'disabled'}><i>♛</i><span><strong>랭크전</strong><small>${account.ranked.eligible ? `${account.ranked.seasonId} · 48시간 계약` : '혼자하기 노말 5 · 일반 10회 필요'}</small></span><b>${account.ranked.eligible ? '선택' : '잠김'}</b></button></div><div class="home-invite"><label for="invite-code">친구 방 초대 코드</label><div><input class="code-input" id="invite-code" type="text" maxlength="8" value="${escapeHtml(profile.recentRoomCode)}" placeholder="8자리 코드"/><button data-home-join>참가</button></div></div></section>`,
    "home-picker-modal",
  );
  modal.querySelectorAll<HTMLElement>("[data-home-mode]").forEach((button) =>
    button.addEventListener("click", () => {
      const next: HomePlayMode = button.dataset.homeMode === 'ranked'
        ? 'ranked'
        : button.dataset.homeMode === "multiplayer" ? "multiplayer" : "solo";
      void setSelectedPlayMode(next).then((updated) => {
        account = updated;
        homePlayMode = next;
        modal.remove();
        homeScreen();
      }).catch((error) => toast(error instanceof Error ? error.message : '플레이 방식을 저장하지 못했습니다.'));
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

function showProfileDisplayPicker(): void {
  if (!account) return;
  const currentAccount = account;
  const modes: readonly ProfileDisplayMode[] = ['solo', 'multiplayer', 'ranked'];
  const cards = modes.map((mode) => {
    const display = accountProfileDisplayInfo(currentAccount, mode);
    const selected = currentAccount.profileDisplayMode === mode;
    return `<button class="profile-display-option ${display.className} ${selected ? 'selected' : ''}" data-profile-display-mode="${mode}" aria-pressed="${selected}"><img src="${display.badgeUrl}" alt="${escapeHtml(display.badgeAlt)}"/><span><em>${display.modeLabel}</em><strong>${escapeHtml(display.rankText)}</strong><small>${escapeHtml(display.labelText)} · ${escapeHtml(currentAccount.nickname)}</small></span><b>${selected ? '표시 중' : '선택'}</b></button>`;
  }).join('');
  const modal = dismissibleModal(
    `<section class="home-picker-sheet profile-display-sheet" role="dialog" aria-modal="true" aria-labelledby="profile-display-title"><header><div><small>IN-GAME LABEL</small><h2 id="profile-display-title">인게임 라벨 설정</h2></div><button data-modal-close aria-label="닫기">×</button></header><p class="profile-display-intro">선택한 뱃지와 라벨은 모든 인게임 이름표에 표시됩니다. 플레이 방식과 전투 능력치는 바뀌지 않습니다.</p><div class="profile-display-options">${cards}</div><section class="profile-title-slot"><div><small>칭호</small><strong>칭호 없음</strong></div><p>시즌 보상이나 업적 칭호를 획득하면 이곳에서 표시할 칭호를 고를 수 있습니다.</p></section></section>`,
    'home-picker-modal profile-display-modal',
  );
  modal.querySelectorAll<HTMLButtonElement>('[data-profile-display-mode]').forEach((button) =>
    button.addEventListener('click', () => {
      const next = button.dataset.profileDisplayMode as ProfileDisplayMode;
      button.disabled = true;
      void setProfileDisplayMode(next).then((updated) => {
        account = updated;
        modal.remove();
        homeScreen();
        toast('인게임 라벨을 변경했습니다.');
      }).catch((error) => {
        button.disabled = false;
        toast(error instanceof Error ? error.message : '인게임 라벨을 저장하지 못했습니다.');
      });
    }),
  );
}

function showHomeStagePicker(): void {
  if (!account) return;
  const currentAccount = account;
  const progressionMode: PlayMode = homePlayMode === 'multiplayer' ? 'multiplayer' : 'solo';
  const unlocked = stagesThrough(
    progressionMode === "solo"
      ? currentAccount.soloStageIndex
      : currentAccount.multiplayerStageIndex,
  );
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
  const crown = currentAccount.ranked.tier === 'challenger' || currentAccount.ranked.tier === 'master'
    ? 'gold'
    : currentAccount.ranked.tier === 'diamond' || currentAccount.ranked.tier === 'platinum'
      ? 'silver'
      : 'bronze';
  const crownForPlacement = (placement: number): 'gold' | 'silver' | 'bronze' | null =>
    placement === 1 ? 'gold' : placement <= 5 ? 'silver' : placement <= 20 ? 'bronze' : null;
  dismissibleModal(
    `<section class="home-picker-sheet ranking-sheet" role="dialog" aria-modal="true" aria-labelledby="ranking-title"><header><div><small>RANKING</small><h2 id="ranking-title">${currentAccount.ranked.seasonId} 새벽 랭크전</h2></div><button data-modal-close aria-label="닫기">×</button></header><div class="ranking-my-record ranked-my-record"><span><img src="${rankedBadgeImage(currentAccount.ranked.tier)}" alt="${RANKED_TIER_LABEL[currentAccount.ranked.tier]}"/></span><div><small>내 랭크전 등급</small><strong>${escapeHtml(currentAccount.nickname)}<img class="season-crown" src="/assets/ranks/crown-${crown}.png" alt="시즌 왕관"/></strong><p>${RANKED_TIER_LABEL[currentAccount.ranked.tier]} · ${currentAccount.ranked.rating} RP · 배치 ${Math.min(5, currentAccount.ranked.placementCompleted)}/5</p></div></div><p class="ranking-notice">2주 시즌 · 48시간 계약 7개 · 최고 5개 점수 반영. 시즌 종료 뒤 순위 보상과 한정 칭호를 지급합니다.</p><ol class="ranked-leaderboard" data-ranked-leaderboard><li>시즌 순위를 불러오는 중…</li></ol><div class="ranked-reward-strip"><span>1위 · 금 왕관</span><span>2~5위 · 은 왕관</span><span>6~20위 · 동 왕관</span></div></section>`,
    "home-picker-modal",
  );
  const board = document.querySelector<HTMLOListElement>('[data-ranked-leaderboard]');
  void fetch('/api/ranked/season')
    .then(async (response) => response.ok ? response.json() as Promise<{ leaderboard?: Array<{ rank: number; nickname: string; score: number }> }> : Promise.reject(new Error('랭킹 조회 실패')))
    .then((data) => {
      if (!board) return;
      board.innerHTML = (data.leaderboard?.length
        ? data.leaderboard.map((entry) => {
          const placementCrown = crownForPlacement(entry.rank);
          const crownImage = placementCrown
            ? `<img class="leader-crown" src="/assets/ranks/crown-${placementCrown}.png" alt="${entry.rank}위 왕관"/>`
            : '';
          return `<li><span class="leader-name">${escapeHtml(entry.nickname)}${crownImage}</span><strong class="leader-score">${entry.score.toLocaleString()}</strong><b class="leader-place">${entry.rank}</b></li>`;
        }).join('')
        : '<li>아직 기록된 시즌 계약이 없습니다.</li>');
    })
    .catch(() => {
      if (board) board.innerHTML = '<li>시즌 순위를 불러오지 못했습니다.</li>';
    });
}

const CUSTOM_SLOT_LABELS: Record<CosmeticSlot, string> = {
  character: "캐릭터",
  skin: "스킨",
  turret: "포탑",
};

function modelPreviewHtml(turretMode = false): string {
  const aria = turretMode ? "포탑 보는 방향" : "캐릭터 보는 방향";
  return `<div class="custom-avatar-stage ${turretMode ? "turret-stage" : ""}" data-avatar-preview><div class="custom-view-switch" aria-label="${aria}"><button class="active" data-avatar-view="front">앞</button><button data-avatar-view="side">옆</button><button data-avatar-view="back">뒤</button></div></div>`;
}

function cosmeticEntitled(
  item: NonNullable<ReturnType<typeof cosmeticById>>,
  currentAccount: AccountProfile,
): boolean {
  return cosmeticAvailable(item, currentAccount.displayRank, currentAccount.ownedCosmetics);
}

function customizationScreen(activeSlot: CosmeticSlot = "character"): void {
  cosmeticCollectionScreen("customize", activeSlot);
}

function shopScreen(activeSlot: CosmeticSlot = "character"): void {
  cosmeticCollectionScreen("shop", activeSlot);
}

function supplyShopScreen(): void {
  if (!account) {
    authScreen();
    return;
  }
  const currentAccount = account;
  const cards = SHOP_CONSUMABLES.map((item) => {
    const quantity = currentAccount.consumables.find((owned) => owned.itemId === item.id)?.quantity ?? 0;
    return `<article class="supply-card catalog-card supply-${item.category}"><div class="catalog-art supply-art"><img data-supply-art="${item.id}" alt="${escapeHtml(item.label)} 3D 상품 이미지" /></div><div class="supply-copy"><span>${item.category === "scout" ? "정찰" : item.category === "survival" ? "생존" : "건설"}</span><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.description)}</p></div><div class="supply-actions"><small>보유 ${quantity}개</small><div><button data-supply-buy="${item.id}" data-supply-quantity="1">${item.price.toLocaleString()} P</button><button data-supply-buy="${item.id}" data-supply-quantity="5">5개</button></div></div></article>`;
  }).join("");
  setContent(
    "shop",
    `<main class="custom-screen shop-screen supply-shop-screen"><div class="custom-backdrop"></div><header class="custom-header"><button class="custom-back" data-supply-back aria-label="스토어로 돌아가기">‹</button><div><span>TACTICAL SUPPLY</span><h2>전술 보급</h2></div><div class="custom-wallet"><small>보유 포인트</small><strong>✦ ${currentAccount.customPoints.toLocaleString()} P</strong></div></header><section class="supply-brief"><div><span class="eyebrow">MATCH CONSUMABLES</span><h3>구매한 수량만큼, 실제 사용 때만 차감됩니다.</h3><p>각 보급품은 한 판에 한 번만 장착·사용할 수 있으며 랜덤 뽑기 보상과 중복되지 않습니다.</p></div><button class="btn ghost" data-cosmetic-store>외형 상점</button></section><section class="supply-grid">${cards}</section></main>`,
  );
  hydrateCatalogArt(app, {
    appearance: currentAccount.appearance,
    turretSkins: currentAccount.turretSkins,
  });
  app.querySelector("[data-supply-back]")?.addEventListener("click", () => shopScreen());
  app.querySelector("[data-cosmetic-store]")?.addEventListener("click", () => shopScreen());
  app.querySelectorAll<HTMLButtonElement>("[data-supply-buy]").forEach((button) =>
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
              account = await purchaseConsumable(itemId, quantity);
              supplyShopScreen();
              toast(`${quantity}개를 보급함에 넣었습니다.`);
            } catch (error) {
              toast(error instanceof Error ? error.message : "보급품을 구매하지 못했습니다.");
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
): void {
  if (!account) {
    authScreen();
    return;
  }
  const selectedSlot: Exclude<CosmeticSlot, "turret"> = activeSlot === "skin" ? "skin" : "character";
  const currentAccount = account;
  const appearance = currentAccount.appearance;
  const shopping = screen === "shop";
  const visibleSlots = (Object.keys(CUSTOM_SLOT_LABELS) as CosmeticSlot[])
    .filter((slot) => slot !== "turret");
  const tabs = visibleSlots
    .map(
      (slot) =>
        `<button class="custom-tab ${slot === selectedSlot ? "active" : ""}" data-custom-slot="${slot}">${CUSTOM_SLOT_LABELS[slot]}</button>`,
    )
    .join("");
  const catalog = cosmeticsForSlot(selectedSlot)
    .filter((item) => shopping || cosmeticEntitled(item, currentAccount));
  const cards = catalog
    .map((item) => {
      const selected = appearance[selectedSlot] === item.id;
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
      let action: "purchase" | "equip" | "unequip" | null = shopping ? null : "equip";
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
        if (item.slot === "skin") {
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
      const characterTraitInfo = item.slot === "character" ? characterTrait(item.id) : null;
      const skinTraitInfo = item.slot === "skin" && item.characterId
        ? characterTraitForAppearance({ character: item.characterId, skin: item.id })
        : null;
      const turretTraitInfo = item.slot === "turret" ? turretSkinTrait(item.id, item.turretKind) : null;
      const traitLabel = characterTraitInfo && characterTraitInfo.id !== "none"
        ? characterTraitInfo.label
        : skinTraitInfo && skinTraitInfo.id !== "none"
          ? skinTraitInfo.label
        : turretTraitInfo && item.unlock.kind !== "starter"
          ? turretTraitInfo.label
          : "";
      const traitDescription = characterTraitInfo?.description ?? skinTraitInfo?.description ?? turretTraitInfo?.description ?? item.description;
      return `<article class="cosmetic-card catalog-card ${selected ? "selected" : ""} ${locked ? "locked" : ""}" data-cosmetic-preview="${item.id}" tabindex="0"><div class="catalog-art cosmetic-art" style="--swatch:${item.swatch}"><img data-cosmetic-art="${item.id}" alt="${escapeHtml(item.label)} 인게임 미리보기" />${traitLabel ? `<span class="trait-ribbon">${escapeHtml(traitLabel)}</span>` : ""}</div><div class="cosmetic-copy"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(traitDescription)}</small></div><div class="cosmetic-card-action">${actionButton}</div></article>`;
    })
    .join("");
  const character = cosmeticById(appearance.character);
  const activeSkin = cosmeticById(appearance.skin);
  const turretMode = false;
  const initialTurret = turretMode
    ? cosmeticById(currentAccount.turretSkins["basic-turret"])
    : undefined;
  const initialTrait = characterTraitForAppearance(appearance);
  const initialTurretTrait = initialTurret?.turretKind
    ? turretSkinTrait(initialTurret.id, initialTurret.turretKind)
    : null;
  setContent(
    screen,
    `<main class="custom-screen ${shopping ? "shop-screen" : "owned-custom-screen"}"><div class="custom-backdrop"></div><header class="custom-header"><button class="custom-back" data-custom-back aria-label="이전 화면">‹</button><div><span>${shopping ? "SHOP" : turretMode ? "TURRET WORKSHOP" : "MY LOCKER"}</span><h2>${shopping ? "외형 상점" : turretMode ? "포탑 외형 격납고" : "내 보관함"}</h2></div>${shopping ? '<button class="custom-shop-switch" data-open-supplies>전술 보급</button>' : ""}<div class="custom-wallet"><small>보유 포인트</small><strong>✦ ${currentAccount.customPoints.toLocaleString()} P</strong></div></header><section class="custom-layout"><aside class="custom-preview">${modelPreviewHtml(turretMode)}<div><strong data-custom-preview-title>${turretMode ? escapeHtml(initialTurret?.label ?? "수호포 · 병동형") : escapeHtml(activeSkin?.label ?? character?.label ?? currentAccount.nickname)}</strong><small data-custom-preview-copy>${turretMode ? escapeHtml(initialTurretTrait?.description ?? "실제 인게임 포탑 외형입니다.") : escapeHtml(activeSkin?.description ?? initialTrait.description)}</small></div></aside><section class="custom-catalog"><nav>${tabs}</nav><div class="cosmetic-grid ${cards ? '' : 'is-empty'}">${cards || '<p class="empty-collection">보유한 캐릭터의<br/>완성형 스킨은 여기에 표시됩니다.</p>'}</div></section></section></main>`,
  );
  hydrateCatalogArt(app, {
    appearance,
    turretSkins: currentAccount.turretSkins,
  });
  app.querySelector("[data-open-supplies]")?.addEventListener("click", supplyShopScreen);
  const previewHost = app.querySelector<HTMLElement>("[data-avatar-preview]");
  if (previewHost) {
    customAvatarPreview = turretMode
      ? new AvatarPreview3D(previewHost, appearance, currentAccount.displayRank)
      : new AvatarPreview2D(previewHost, appearance, currentAccount.displayRank);
    if (customAvatarPreview instanceof AvatarPreview3D && turretMode && initialTurret?.turretKind) {
      customAvatarPreview.updateTurret(
        initialTurret.turretKind,
        initialTurret.id,
      );
    }
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
    if (item.slot === "turret") {
      if (!item.turretKind) return;
      if (customAvatarPreview instanceof AvatarPreview3D) {
        customAvatarPreview.updateTurret(item.turretKind, item.id);
      }
    } else {
      const previewAppearance: AvatarAppearance = item.slot === "character"
        ? { character: item.id, skin: defaultSkinForCharacter(item.id) }
        : item.slot === "skin"
          ? {
              character: item.characterId ?? appearance.character,
              skin: item.id,
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
                  account = await purchaseCosmetic(itemId);
                  shopScreen(selectedSlot);
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
            account = await equipCosmetic(
              action === "unequip"
                ? currentAccount.appearance.character
                : itemId,
            );
            customizationScreen(selectedSlot);
            toast(
              action === "unequip"
                ? "스킨 착용을 해제했습니다."
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
  action: 'join' | 'status' | 'leave',
): Promise<RankedQueueResponse | { left: boolean }> {
  const response = await fetch(`/api/ranked/queue/${action}`, {
    method: action === 'status' ? 'GET' : 'POST',
    headers: action === 'status' ? undefined : { 'content-type': 'application/json' },
    body: action === 'join' ? JSON.stringify({ testMode: e2eMode }) : undefined,
  });
  const data = await response.json().catch(() => null) as (RankedQueueResponse & { error?: string }) | { left: boolean; error?: string } | null;
  const errorMessage = data && 'error' in data ? data.error : undefined;
  if (!response.ok || !data) throw new Error(errorMessage || '랭크 대기열에 연결하지 못했습니다.');
  return data;
}

async function joinRankedQueue(): Promise<void> {
  try {
    const queue = await rankedQueueRequest('join') as RankedQueueResponse;
    renderRankedQueue(queue);
  } catch (error) {
    homeScreen();
    toast(error instanceof Error ? error.message : '랭크 대기열에 연결하지 못했습니다.');
  }
}

async function refreshRankedQueue(): Promise<void> {
  try {
    const queue = await rankedQueueRequest('status') as RankedQueueResponse;
    if (currentView !== 'ranked-queue') return;
    renderRankedQueue(queue);
  } catch (error) {
    if (currentView !== 'ranked-queue') return;
    homeScreen();
    toast(error instanceof Error ? error.message : '랭크 대기열 연결이 끊어졌습니다.');
  }
}

function renderRankedQueue(queue: RankedQueueResponse): void {
  stopRankedQueuePolling();
  if (queue.status === 'matched' && queue.roomCode) {
    profile.recentRoomCode = queue.roomCode;
    saveProfile(profile);
    toast(queue.botCount ? `40초 대기 후 봇 ${queue.botCount}명이 보충되었습니다.` : '동일 등급대 생존자 4명이 매칭되었습니다.');
    connectToRoom(queue.roomCode, false);
    return;
  }
  if (queue.status !== 'waiting') {
    homeScreen();
    toast('랭크 대기열이 만료되었습니다. 다시 참여해주세요.');
    return;
  }
  const elapsed = formatTime(queue.elapsedSeconds);
  const slots = Array.from({ length: queue.requiredPlayers }, (_, index) => {
    const player = queue.players[index];
    return player
      ? `<li class="ranked-queue-player"><span class="queue-avatar">${escapeHtml(player.nickname.slice(0, 1))}</span><div><strong>${escapeHtml(player.nickname)}</strong><small>${player.rating} RP</small></div><b>READY</b></li>`
      : `<li class="ranked-queue-player vacant"><span class="queue-avatar">＋</span><div><strong>동일 등급 생존자 탐색 중</strong><small>현재 범위 ±${queue.ratingWindow} RP</small></div><b>SEARCH</b></li>`;
  }).join('');
  setContent(
    'ranked-queue',
    `<main class="ranked-queue-screen"><div class="ranked-queue-backdrop"></div><section class="ranked-queue-shell"><header><span class="eyebrow">RANKED MATCHMAKING</span><h1>${account?.ranked.seasonId ?? 'S1'} 새벽 랭크전</h1><p>비슷한 랭크의 생존자 4명을 찾고 있습니다.</p></header><section class="ranked-queue-clock"><span>QUEUE TIME</span><strong>${elapsed}</strong><small>${queue.playerCount}/${queue.requiredPlayers} 명 참가 · 40초 뒤 빈 자리는 봇으로 보충</small></section><ol class="ranked-queue-players">${slots}</ol><footer><button class="btn danger" data-ranked-queue-cancel>대기열 취소</button><small>매칭이 완료되면 별도 준비 없이 자동으로 시작됩니다.</small></footer></section></main>`,
  );
  app.querySelector<HTMLButtonElement>('[data-ranked-queue-cancel]')?.addEventListener('click', () => {
    stopRankedQueuePolling();
    void rankedQueueRequest('leave').catch(() => undefined).finally(() => homeScreen());
  });
  rankedQueuePollTimer = window.setTimeout(() => void refreshRankedQueue(), 1_000);
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
    const previous = snapshot;
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
      renderForSnapshot(initial, false);
      game?.updateSnapshot(initial, []);
      refreshSelectionPanel(previous);
    }
    updateTestApi();
  });
  roomNetwork.on("snapshot", ({ snapshot: next, events }) => {
    if (network !== roomNetwork) return;
    const previous = snapshot;
    snapshot = next;
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
    `<main class="lobby-screen ${state.playMode === "solo" ? "solo-lobby" : "multiplayer-lobby"} ${rankedLobby ? 'ranked-lobby' : ''}"><div class="lobby-backdrop"></div><section class="lobby-shell"><header class="lobby-header"><div><span class="eyebrow">${rankedLobby ? `${state.ranked?.seasonId} 랭크 매치` : state.playMode === "solo" ? "혼자하기" : "친구랑하기"} · ${stageThemeFor(state.stageId).label}</span><p>${rankedLobby ? '대기열 배정 인원이 모두 연결되면 준비 없이 자동으로 시작됩니다.' : state.playMode === "solo" ? "생존자 봇과 장비를 점검하세요." : "친구와 같은 방을 쓰거나 각자 다른 루트를 지킬 수 있습니다."}</p></div><div class="lobby-stage"><strong>${state.stageLabel}</strong></div></header>${roomCode}<section class="lobby-content"><div><div class="lobby-section-title"><strong>생존자 명단</strong><span>${state.players.length}/4 READY CHECK</span></div><div class="players" id="players" data-testid="players"></div></div><aside class="lobby-brief"><span>${rankedLobby ? 'RANKED CONTRACT' : 'NIGHT BRIEF'}</span><strong>${roomRule}</strong><p>등급 침대 보너스만큼 귀신도 강해집니다. 쌍둥이는 서로 다른 방과 문을 노릴 수 있습니다.</p><div><i style="width:${Math.min(100, 28 + state.stageIndex * 0.55)}%"></i></div><small>귀신 성장 HP +${Math.round(stage.levelHpGrowth * 100)}% · 공격 +${Math.round(stage.levelDamageGrowth * 100)}%</small></aside></section><section class="lobby-loadout" data-lobby-loadout></section><footer class="lobby-actions"><button class="btn danger" data-leave-room>방 나가기</button>${rankedLobby ? '<div class="ranked-lobby-autostart">랭크 대기열 완료 · 자동 시작 대기</div>' : '<button class="btn ghost" data-ready>준비</button><button class="btn ghost" data-bot>봇 추가</button><button class="btn primary" data-start data-testid="start-game">게임 시작</button>'}</footer></section></main>`,
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
        return `<article class="player-card ${profileDisplay.className}" data-player-id="${player.id}">${playerFaceHtml(player.appearance)}<div class="player-copy"><strong>${profileBadgeHtml(profileDisplay, "rank-badge-xs")} <span class="player-name">${escapeHtml(player.nickname)}${state.hostId === player.id ? " ★" : ""}</span></strong><span>${player.isBot ? "대기열 보충 봇" : player.connected ? state.ranked ? "랭크 매치 배정 참가자" : profileDisplay.labelText : "재접속 대기"}</span></div><div class="member-controls"><b class="ready-badge">${state.ranked ? "MATCHED" : player.ready || player.id === state.hostId ? "READY" : "WAIT"}</b>${hostAction}</div></article>`;
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
    .filter((entry): entry is { entry: typeof me.consumables[number]; definition: NonNullable<ReturnType<typeof shopConsumableById>> } => Boolean(entry.definition));
  const selected = new Set(me.consumableLoadout);
  loadout.innerHTML = `<header><div><span class="eyebrow">TACTICAL LOADOUT</span><strong>전술 보급 장착 <small>${selected.size}/3</small></strong></div><button class="btn ghost" data-open-supply-shop>상점</button></header>${owned.length ? `<div class="loadout-items">${owned.map(({ entry, definition }) => `<button class="loadout-item ${selected.has(definition.id) ? "selected" : ""}" data-loadout-id="${definition.id}" aria-pressed="${selected.has(definition.id)}"><i>${definition.icon}</i><span><strong>${escapeHtml(definition.label)}</strong><small>${entry.quantity}개 보유 · ${escapeHtml(definition.description)}</small></span><b>${selected.has(definition.id) ? "장착" : "선택"}</b></button>`).join("")}</div><p>장착한 보급품은 한 판에 각각 한 번만 사용할 수 있습니다.</p>` : `<div class="loadout-empty"><span>아직 구매한 전술 보급이 없습니다.</span><button class="btn primary" data-open-supply-shop>전술 보급 상점</button></div>`}`;
  loadout.querySelectorAll<HTMLButtonElement>("[data-open-supply-shop]").forEach((button) =>
    button.addEventListener("click", supplyShopScreen),
  );
  loadout.querySelectorAll<HTMLButtonElement>("[data-loadout-id]").forEach((button) =>
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
  const stageBadge = profileDisplay ? profileBadgeHtml(profileDisplay, "rank-badge-game") : "";
  const stageRankLabel = profileDisplay && me
    ? `${escapeHtml(profileDisplay.labelText)} · ${escapeHtml(me.nickname)}`
    : "생존자";
  setContent(
    "game",
    `<main id="game-shell"><div id="game-root"></div><div class="render-mode">TOP-DOWN 2.5D · ${stageThemeFor(state.stageId).label}</div>${me ? `<button class="player-focus" data-focus-player aria-label="내 캐릭터 위치로 카메라 이동">${playerFaceHtml(me.appearance)}<small>ME</small></button>` : ""}<div class="hud"><div class="stage-chip">${stageBadge}<div class="stage-copy"><span>${state.ranked ? `랭크전 · ${state.ranked.contractId}` : state.playMode === "solo" ? "혼자하기" : "친구랑하기"} · ${state.stageLabel}</span><strong>${stageRankLabel}</strong></div></div><div class="hud-group primary-stats"><div class="stat"><i>◆</i><span>골드</span><strong data-gold>0</strong></div><div class="stat"><i>⚡</i><span>전력</span><strong data-power>0</strong></div><div class="stat"><i>▣</i><span>문</span><strong data-door>—</strong></div></div><div class="hud-player-list hidden" data-hud-players aria-label="다른 생존자 위치"></div><div class="hud-group battle-stats"><div class="stat"><i>☾</i><span>귀신</span><strong data-ghost>Lv.1</strong></div><div class="stat"><i>🎁</i><span>뽑기</span><strong data-draw>0/${me ? drawLimitForAppearance(me.appearance) : 4}</strong></div><div class="stat"><i>◷</i><span>시간</span><strong data-time>00:00</strong></div></div><div class="network-pill" data-network data-testid="network">연결됨 · 0ms</div></div><div class="phase-banner" data-phase>준비 시간</div><div class="time-attack-clock hidden" data-time-attack></div><div class="camera-controls" aria-label="카메라 조작"><button data-camera="rotate-left" aria-label="카메라 왼쪽 회전">↶</button><button data-camera="zoom-out" aria-label="카메라 축소">−</button><output data-camera-zoom>1.0×</output><button data-camera="zoom-in" aria-label="카메라 확대">＋</button><button data-camera="rotate-right" aria-label="카메라 오른쪽 회전">↷</button></div><div class="controls"><div class="joystick" data-joystick><div class="joystick-knob"></div></div><div class="portrait-drag-hint"><i>↗</i><span>캐릭터를 누른 채<br>움직일 방향으로 드래그</span></div><div class="action-stack"><button class="round-btn secondary hidden" data-inventory aria-label="가방">${gameActionIcon("bag")}</button><button class="round-btn" data-interact data-testid="interact" aria-label="침대 점유">${gameActionIcon("bed")}</button></div></div><aside class="build-panel hidden" data-build-panel></aside><div class="connection-overlay hidden" data-connection><div class="connection-card"><div class="spinner"></div><strong>연결을 복구하는 중</strong><p class="subtitle" data-reconnect-copy>30초 안에 기존 생존자로 돌아갑니다.</p></div></div></main>`,
  );
  const renderMode = app.querySelector<HTMLElement>(".render-mode");
  if (renderMode)
    renderMode.textContent = `TOP-DOWN 2.5D · ${stageThemeFor(state.stageId).label}`;
  app.querySelector("[data-interact]")?.remove();
  app
    .querySelectorAll('[data-camera="rotate-left"], [data-camera="rotate-right"]')
    .forEach((button) => button.remove());
  setupJoystick();
  app
    .querySelector("[data-inventory]")
    ?.addEventListener("click", showInventory);
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
      network?.interact();
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
  updateHud();
}

function renderForSnapshot(state: GameSnapshot, force: boolean): void {
  if (state.status === "LOBBY") {
    if (force || currentView !== "lobby") lobbyScreen(state);
    else updateLobby(state);
  } else if (state.status === "EVENT_INTRO" || state.status === "COUNTDOWN" || state.status === "PLAYING" || state.status === 'OVERTIME') {
    if (force || currentView !== "game") gameScreen(state);
    else updateHud();
  } else if (state.status === "VICTORY" || state.status === "DEFEAT") {
    if (force || currentView !== "result") resultScreen(state);
  }
}

function updateHud(): void {
  if (!snapshot || currentView !== "game") return;
  const me = snapshot.players.find((player) => player.id === playerId);
  const room = snapshot.rooms.find((candidate) => candidate.id === me?.roomId);
  app
    .querySelector(".portrait-drag-hint")
    ?.classList.toggle("hidden", Boolean(me?.roomId) || !me?.alive);
  app
    .querySelector("[data-inventory]")
    ?.classList.toggle(
      "hidden",
      !me?.alive || (!me?.items.length && !me?.consumableLoadout.length),
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
    snapshot.difficulty.controlAdaptation ? `제어 ${Math.round(leadGhost.controlResolve)}%` : "",
  ].filter(Boolean).join(" · ");
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
  const isEventIntro = snapshot.status === 'EVENT_INTRO';
  if (phase) {
    phase.classList.toggle("countdown", isCountdown);
    phase.classList.toggle('time-attack-intro', isEventIntro);
    phase.textContent = isEventIntro
      ? 'TIME ATTACK\n당신에게 5분의 시간이 주어졌습니다.\n5분안에 귀신을 물리치고 탈출하세요.'
      : isCountdown
      ? `${Math.ceil(snapshot.countdown)}`
      : (skillWarning ??
          (retreating
            ? "⚠ 귀신이 후퇴합니다"
            : `${snapshot.stageLabel} · ${snapshot.matchEvent} · 문 타격으로 귀신이 성장합니다`));
    phase.setAttribute(
      "aria-label",
      isCountdown
        ? `게임 시작까지 ${Math.ceil(snapshot.countdown)}초`
        : phase.textContent,
    );
  }
  const timeAttack = app.querySelector<HTMLElement>('[data-time-attack]');
  if (timeAttack) {
    const remaining = snapshot.difficulty.timeAttackRemaining;
    const visible = snapshot.difficulty.modifier === 'time-attack' && (snapshot.status === 'PLAYING' || snapshot.status === 'OVERTIME');
    timeAttack.classList.toggle('hidden', !visible);
    if (visible && remaining !== null) {
      const seconds = Math.ceil(remaining);
      timeAttack.textContent = seconds >= 0 ? formatTime(seconds) : `+${formatTime(Math.abs(seconds))}`;
      timeAttack.classList.toggle('overtime', snapshot.status === 'OVERTIME');
    }
  }
  const net = app.querySelector<HTMLElement>("[data-network]");
  if (net) net.textContent = `연결됨 · ${Math.round(ping)}ms`;
}

function updateHudTeammates(): void {
  if (!snapshot) return;
  const list = app.querySelector<HTMLElement>("[data-hud-players]");
  if (!list) return;
  const teammates = snapshot.players.filter(
    (player) => player.id !== playerId && player.alive,
  );
  const identity = teammates
    .map(
      (player) =>
        `${player.id}:${player.nickname}:${player.appearance.character}:${player.roomId ?? "outside"}`,
    )
    .join("|");
  if (list.dataset.players === identity) return;
  list.dataset.players = identity;
  list.classList.toggle("hidden", teammates.length === 0);
  list.innerHTML = teammates
    .map(
      (player) =>
        `<button type="button" class="hud-teammate" data-focus-teammate="${escapeHtml(player.id)}" aria-label="${escapeHtml(player.nickname)} 위치로 카메라 이동">${playerFaceHtml(player.appearance)}<span>${escapeHtml(player.nickname)}</span></button>`,
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
  setContent(
    "result",
    `<main class="result-screen ${victory ? "victory" : "defeat"}"><div class="result-backdrop"></div><section class="result-card"><span class="result-kicker">${state.stageLabel} · ${victory ? "DAWN REPORT" : "NIGHT REPORT"}</span><div class="result-emblem">${victory ? "✦" : "☾"}</div><h1>${victory ? "새벽 생존" : "작전 실패"}</h1><p>${victory ? "마지막 귀신까지 몰아냈습니다." : "방어선을 정비하고 다시 도전하세요."}</p><div class="result-stats"><article><small>생존 시간</small><strong>${formatTime(state.elapsed)}</strong></article><article><small>최종 귀신</small><strong>Lv.${state.ghost.level}</strong></article><article><small>스테이지</small><strong>${state.stageLabel}</strong></article></div>${victory ? `<div class="result-reward"><span>CLEAR REWARD</span><strong>✦ +${reward} P</strong><small>커스텀 상점 포인트와 승리 XP가 계정에 저장됩니다.</small></div>` : '<div class="result-reward muted"><span>CHALLENGE RECORD</span><strong>도전 XP 저장</strong><small>획득한 진행 기록은 유지됩니다.</small></div>'}<div class="result-actions"><button class="btn primary" data-rematch data-testid="rematch">다시 도전</button><button class="btn ghost" data-leave>게임 메뉴</button></div></section></main>`,
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
    void getAccount()
      .then((next) => {
        account = next;
        homePlayMode = next.selectedPlayMode;
        homeScreen();
      })
      .catch(() => authScreen());
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
  tileSelectionBlockedUntil = Math.max(
    tileSelectionBlockedUntil,
    blockedUntil,
  );
  buildPanelInputBlockedUntil = Math.max(buildPanelInputBlockedUntil, blockedUntil);
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
  selectedTile = null;
  selectedTarget = event.detail;
  renderTargetPanel(event.detail);
}

function onBuildingDragStart(): void {
  selectedTile = null;
  selectedTarget = null;
  app.querySelector("[data-build-panel]")?.classList.add("hidden");
  toast("설비 이동 모드 · 빈 타일에 놓거나 내 설비 위에 놓아 위치를 교환하세요.");
}

function onBuildingMove(event: CustomEvent<BuildingMoveRequest>): void {
  if (!snapshot) return;
  const request = event.detail;
  const me = snapshot.players.find((player) => player.id === playerId);
  const building = snapshot.buildings.find((candidate) => candidate.id === request.buildingId);
  if (!me || !building || building.roomId !== me.roomId || building.ownerId !== me.id) {
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
  const gold = cost.gold > 0 || cost.power <= 0
    ? `<span class="resource-cost gold">◆ <b>${cost.gold}</b></span>`
    : "";
  const power = cost.power > 0
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

function wirePanelAction(
  button: HTMLButtonElement,
  action: () => void,
): void {
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
  const modeRank =
    snapshot.playMode === "solo" ? me.soloRank : me.multiplayerRank;
  const availableKinds: BuildingKind[] = [...BUILD_KINDS];
  const buildCard = (kind: BuildingKind): string => {
    const definition = BALANCE.buildings[kind];
    const cost = upgradeCost(kind, 1, modeRank);
    const powerOnly = cost.gold === 0 && cost.power > 0;
    return `<button class="build-card catalog-card ${powerOnly ? "power-only-build" : ""}" type="button" data-build="${kind}"><span class="catalog-art build-art"><img data-building-art="${kind}" alt="${escapeHtml(definition.label)} 인게임 탑다운 모습" /></span><span class="build-card-copy"><strong>${definition.label}</strong>${powerOnly ? `<em class="power-only-badge">⚡ 전력 전용</em>` : ""}<small>${definition.description}</small></span><span class="build-card-cost">${resourceCostMarkup(cost)}</span></button>`;
  };
  const goldCards = availableKinds
    // 랜덤 상자는 비용이 0이라 일반 비용 분류에서는 빠진다. 전력 설비가
    // 아니라 골드/아이템 설비이므로 골드 탭에 항상 남겨 둔다.
    .filter((kind) => upgradeCost(kind, 1, modeRank).gold > 0 || kind === "lucky-machine")
    .map(buildCard)
    .join("");
  const powerCards = availableKinds
    .filter((kind) => upgradeCost(kind, 1, modeRank).power > 0)
    .map(buildCard)
    .join("");
  const supplyCards = me.consumables
    .filter((owned) => owned.quantity > 0)
    .map((owned) => {
      const supply = shopConsumableById(owned.itemId);
      if (!supply) return "";
      return `<button class="build-card catalog-card supply-build-card" type="button" data-open-build-inventory><span class="catalog-art build-art"><img data-supply-art="${supply.id}" alt="${escapeHtml(supply.label)}" /></span><span class="build-card-copy"><strong>${escapeHtml(supply.label)} ×${owned.quantity}</strong><small>${escapeHtml(supply.description)}</small></span><span class="build-card-cost">보급함에서 사용</span></button>`;
    })
    .join("") || '<p class="empty-build-tab">구매한 전투 보급이 없습니다.</p>';
  panel.innerHTML = `${panelHeadingMarkup("INSTALL", "빈 타일에 설비 설치")}<div class="panel-wallet"><span>타일 ${tile.x + 1}, ${tile.y + 1}</span><strong>◆ <b data-owned-gold>${Math.floor(me.gold)}</b></strong><strong>⚡ <b data-owned-power>${Math.floor(me.power)}</b></strong></div><nav class="build-resource-tabs"><button class="active" data-build-tab="gold">골드</button><button data-build-tab="power">전력</button><button data-build-tab="supply">보급</button></nav><section class="build-tab-panel" data-build-tab-panel="gold"><div class="build-grid">${goldCards}</div></section><section class="build-tab-panel hidden" data-build-tab-panel="power"><div class="build-grid">${powerCards}</div></section><section class="build-tab-panel hidden" data-build-tab-panel="supply"><div class="build-grid">${supplyCards}</div></section>`;
  panel.classList.remove("hidden");
  hydrateCatalogArt(panel, {
    appearance: me.appearance,
    turretSkins: me.turretSkins,
  });
  panel.querySelectorAll<HTMLButtonElement>("[data-build-tab]").forEach((button) =>
    button.addEventListener("click", () => {
      const tab = button.dataset.buildTab;
      panel.querySelectorAll("[data-build-tab]").forEach((candidate) =>
        candidate.classList.toggle("active", candidate === button),
      );
      panel.querySelectorAll<HTMLElement>("[data-build-tab-panel]").forEach((section) =>
        section.classList.toggle("hidden", section.dataset.buildTabPanel !== tab),
      );
    }),
  );
  panel.querySelectorAll<HTMLButtonElement>("[data-open-build-inventory]").forEach((button) =>
    button.addEventListener("click", () => {
      closeBuildPanel();
      showInventory();
    }),
  );
  wireBuildPanelClose(panel);
  panel.querySelectorAll<HTMLButtonElement>("[data-build]").forEach((button) => {
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
  if (kind === "lucky-machine" && building) {
    const drawLimit = drawLimitForAppearance(me.appearance);
    const cost = me.drawCount < drawLimit ? DRAW_COSTS[me.drawCount] : undefined;
    const owned =
      me.items
        .map(
          (item) =>
            `${escapeHtml(item.label)}${item.count > 1 ? ` ×${item.count}` : ""}`,
        )
        .join(" · ") || "아직 획득한 아이템이 없습니다.";
    panel.innerHTML = `${panelHeadingMarkup("DRAW", `${buildingIconMarkup(kind)} ${definition.label}`)}<p class="panel-description">${definition.description}</p><div class="target-card"><div class="target-card-title"><span>이번 판 사용 횟수</span><strong>${me.drawCount} / ${drawLimit}회</strong></div><small>${owned}</small></div>${cost ? `<button class="upgrade-cta draw-cta" type="button" data-draw><span>${me.drawCount + 1}번째 랜덤 뽑기</span><strong>${resourceCostMarkup(cost)}</strong></button>` : `<button class="btn ghost panel-disabled" disabled>이번 판 ${drawLimit}회 완료</button>`}<small class="odds-note">신화·전설 아이템은 매우 낮은 확률이며, 꽝 장식품은 단 두 종류만 등장합니다.</small>${removalMarkup}`;
    panel.classList.remove("hidden");
    wireBuildPanelClose(panel);
    panel
      .querySelector("[data-draw]")
      ?.addEventListener("click", () => network?.drawItem(building.id));
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
    : requirement ?? "최고 레벨 달성";
  panel.innerHTML = `${panelHeadingMarkup("UPGRADE", `${buildingIconMarkup(kind)} ${definition.label}`)}<p class="panel-description">${definition.description}</p><div class="target-card"><div class="target-card-title"><span>현재 단계</span><strong>Lv.${currentLevel} / ${maxLevel}</strong></div><small>${effectLabel}</small></div>${cost ? `<button class="upgrade-cta${canAffordUpgrade ? "" : " resource-insufficient"}" type="button" ${canAffordUpgrade ? `data-upgrade="${selection.targetId}"` : "disabled aria-disabled=\"true\""}><span>Lv.${nextLevel} 업그레이드${canAffordUpgrade ? "" : " · 재화 부족"}</span><strong>${resourceCostMarkup(cost)}</strong></button>` : `<button class="btn ghost panel-disabled" disabled>${unavailableLabel}</button>`}${removalMarkup}`;
  panel.classList.remove("hidden");
  wireBuildPanelClose(panel);
  const upgradeButton = panel.querySelector<HTMLButtonElement>("[data-upgrade]");
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

function onPortraitMove(event: CustomEvent<Vec2>): void {
  inputVector = event.detail;
  sendMovement(inputVector.x === 0 && inputVector.y === 0);
}

function setupJoystick(): void {
  const base = app.querySelector<HTMLElement>("[data-joystick]");
  const knob = base?.querySelector<HTMLElement>(".joystick-knob");
  if (!base || !knob) return;
  let pointerId = -1;
  const update = (event: PointerEvent): void => {
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
  network?.move(inputVector.x, inputVector.y, ++inputSequence);
}

function sendMovement(force = false): void {
  game?.setLocalInput(inputVector);
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
      "consumable-use",
      "elite-join",
      "victory",
      "defeat",
    ].includes(event.kind),
  );
  if (interesting) audio.play(interesting.kind);
  const elite = events.find((event) => event.kind === "elite-join");
  if (elite?.label) showEliteEntrance(elite.label);
  const death = events.find((event) => event.kind === "death" && event.playerId);
  if (death?.playerId) showDeathNotice(death.playerId);
  const draw = events.find(
    (event) => event.kind === "item-draw" && event.playerId === playerId,
  );
  if (draw?.itemId) showItemReveal(draw.itemId);
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
  if (
    profile.vibration &&
    events.some(
      (event) => event.kind === "door-hit" || event.kind === "player-hit",
    )
  )
    navigator.vibrate?.(35);
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
  const randomCards = me?.items.length
    ? me.items
        .map((owned) => {
          const item = getRandomItem(owned.itemId);
          const art = owned.itemId === 'golden-ticket'
            ? '<img class="inventory-item-art" src="/assets/items/golden-ticket.png" alt="황금 티켓"/>'
            : '';
          return `<article class="item-card rarity-${owned.rarity}">${art}<strong>${escapeHtml(owned.label)}${owned.count > 1 ? ` ×${owned.count}` : ""}</strong><span>${escapeHtml(item?.description ?? "")}</span><small>${owned.rarity.toUpperCase()}</small></article>`;
        })
        .join("")
    : '<p class="subtitle">랜덤 상자를 설치하고 아이템을 뽑아보세요.</p>';
  const supplies = me?.consumableLoadout
    .map((itemId) => {
      const item = shopConsumableById(itemId);
      if (!item) return "";
      const quantity = me.consumables.find((owned) => owned.itemId === itemId)?.quantity ?? 0;
      const used = me.usedConsumables.includes(itemId);
      const targetHint =
        item.target === "tile"
          ? "먼저 복도 타일을 선택하세요"
          : item.target === "building"
            ? "먼저 설비를 선택하세요"
            : item.target === "door"
              ? "현재 방의 문에 사용"
              : item.target === "room"
                ? "현재 방에 사용"
                : "즉시 사용";
      return `<article class="item-card supply-item ${used ? "spent" : ""}"><i>${item.icon}</i><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.description)}</span><small>${targetHint} · ${used ? "이번 판 사용 완료" : `남은 재고 ${quantity}개`}</small><button ${used || quantity <= 0 ? "disabled" : ""} data-use-consumable="${item.id}">${used ? "사용 완료" : "사용"}</button></article>`;
    })
    .join("");
  modal.innerHTML = `<section class="panel inventory-panel"><span class="eyebrow">MATCH BAG · ${me?.drawCount ?? 0}/${me ? drawLimitForAppearance(me.appearance) : 4}</span><h2>이번 판 가방</h2>${supplies ? `<h3 class="inventory-subtitle">전술 보급</h3><div class="item-grid supply-item-grid">${supplies}</div>` : ""}<h3 class="inventory-subtitle">랜덤 획득품</h3><div class="item-grid">${randomCards}</div><button class="btn primary" style="width:100%" data-close>닫기</button></section>`;
  app.appendChild(modal);
  modal
    .querySelector("[data-close]")
    ?.addEventListener("click", () => modal.remove());
  modal.querySelectorAll<HTMLButtonElement>("[data-use-consumable]").forEach((button) =>
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
          toast("할인할 설비를 먼저 선택하세요.");
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

function showItemReveal(itemId: string): void {
  const item = getRandomItem(itemId);
  if (!item) return;
  const modal = document.createElement("div");
  modal.className = "modal-backdrop item-reveal";
  modal.innerHTML = `<section class="panel compact rarity-${item.rarity}" style="text-align:center"><div class="reveal-orb">🎁</div><span class="eyebrow">${item.rarity.toUpperCase()} DROP</span><h2>${escapeHtml(item.label)}</h2><p class="subtitle">${escapeHtml(item.description)}</p><button class="btn gold" style="width:100%" data-close>가방에 넣기</button></section>`;
  app.appendChild(modal);
  modal
    .querySelector("[data-close]")
    ?.addEventListener("click", () => modal.remove());
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
  // Logging out in the middle of a live match would abandon the active room
  // without giving the player the dedicated leave-game confirmation flow.
  // Keep account actions available everywhere else, but omit them while play
  // is actually underway.
  const isActiveMatch = currentView === "game" && snapshot?.status === "PLAYING";
  const leaveAction = network
    ? '<button class="btn danger settings-leave" data-leave-game data-testid="leave-game">게임 나가기</button>'
    : "";
  const logoutAction = account && !isActiveMatch
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
      const slider = modal.querySelector<HTMLInputElement>("[data-music-volume]");
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
  const player = snapshot?.players.find((candidate) => candidate.id === deadPlayerId);
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
      sendMovement();
    },
    interact: () => network?.interact(),
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
  };
}

document.addEventListener("pointerdown", () => audio.unlock(), { once: true });
document.addEventListener("visibilitychange", () => {
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
