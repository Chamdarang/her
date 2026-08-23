const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  safeStorage,
  shell,
  Tray
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

app.setPath("userData", path.join(app.getPath("appData"), "her-ai-friend"));
const APP_ID = "com.her.aifriend";
const APP_ICON = path.join(__dirname, "assets", "icon.ico");

const { appendEventDiagnostic, eventDiagnosticPath } = require("./src/event-diagnostics");
const {
  APP_DEFAULTS,
  PROFILE_DEFAULTS
} = require("./src/defaults");
const { mergeExplicitMemories, normalizeMemory } = require("./src/memory");
const {
  cleanMessageText,
  deleteMessageRecord,
  editMessageRecord
} = require("./src/main/message-history");
const {
  STATE_VERSION,
  createFriendRecord,
  createInitialState,
  modernStateFromLoaded,
  normalizeAppSettings,
  normalizeStoredUsage,
  stateFromLoaded
} = require("./src/main/state");
const { recordUsageInStore, tokenBudgetMessage } = require("./src/main/usage");
const { requestOpenAI } = require("./src/main/openai");
const {
  ambientVoiceConfigured,
  deferOverdueWorkAfterResume,
  initialNudgeDelayMs,
  paceMultiplier,
  quietHoursState,
  readDelayMs,
  replyBatchDelayMs,
  userReplyTiming
} = require("./src/main/scheduler");
const { ambientIntervalMs, proactiveOpportunity } = require("./src/proactive");
const { buildOpenAIRequestBody } = require("./src/prompt");
const {
  MAX_UNANSWERED_TURNS,
  livePromptState,
  nextLiveDelayMs
} = require("./src/live-conversation");
const { normalizeGeneratedReply } = require("./src/reply");
const {
  autonomousIntervalMs,
  chooseNextSpeaker,
  ensureRoomState,
  normalizeRoom
} = require("./src/rooms");
const {
  applyRelationshipEvent,
  clampScore,
  relationshipStage
} = require("./src/relationship");
const { atomicWriteJson, preserveCorruptFile } = require("./src/storage");
const { appendVoiceDiagnostic, diagnosticPath } = require("./src/voice-diagnostics");
const { concatWavBuffers } = require("./src/wav");
const {
  modelOptions,
  normalizeEndpoint,
  sanitizeJapaneseSpokenText,
  splitVoiceText,
  voiceDeliveryReady,
  voiceUrl,
  waitsForVoice
} = require("./src/voice");

let mainWindow;
let tray;
let state;
let volatileApiKey = "";
let scheduler;
let isQuitting = false;
let trayHintShown = false;
let userIsTyping = false;
let typingExpiryTimer;
let stateSaveTimer;
let lastTickAt = Date.now();
let resumeHoldUntil = 0;
let proactiveGenerationInFlight = false;
let liveConversationSession = null;
let liveConversationTimer = null;
let lastLiveConversationStop = null;

const replyTimers = new Map();
const replyPending = new Set();
const generationInFlight = new Set();
const requestControllers = new Map();
const conversationRevisions = new Map();
const voicePreparationInFlight = new Set();
const voicePreparationChains = new Map();
const roomTurnTimers = new Map();
const VOICE_SERVER_HEALTH_TIMEOUT_MS = 3000;
const VOICE_SERVER_HEALTH_TTL_MS = 30000;
const VOICE_SERVER_FAILURE_TTL_MS = 5000;
let voiceServerHealth = { endpoint: null, checkedAt: 0, ok: false, error: null };
let voiceServerHealthCheck = null;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.setAppUserModelId(APP_ID);
app.on("second-instance", () => showMainWindow());

function id() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createFriend(profile = {}, legacy = {}) {
  return createFriendRecord(profile, legacy, id);
}

function statePath() {
  return path.join(app.getPath("userData"), "state.json");
}

function keyPath() {
  return path.join(app.getPath("userData"), "api-key.bin");
}

function loadState() {
  try {
    const loaded = JSON.parse(fs.readFileSync(statePath(), "utf8"));
    return stateFromLoaded(loaded, id);
  } catch {
    preserveCorruptFile(statePath());
    return createInitialState(id);
  }
}

function saveState() {
  clearTimeout(stateSaveTimer);
  stateSaveTimer = null;
  atomicWriteJson(statePath(), state);
}

function scheduleStateSave() {
  clearTimeout(stateSaveTimer);
  stateSaveTimer = setTimeout(saveState, 180);
}

function friendById(friendId) {
  return state.friends.find((friend) => friend.id === friendId);
}

function roomById(roomId) {
  return state.rooms?.find((room) => room.id === roomId);
}

function activeRoom() {
  return roomById(state.activeRoomId) || state.rooms?.[0] || null;
}

function activeFriend() {
  const room = activeRoom();
  return friendById(room?.participantIds?.[0] || state.activeFriendId) || state.friends[0];
}

function conversationRoomFor(friend) {
  return friend?.conversationRoom || roomById(friend?.roomId) || state.rooms.find(
    (room) => room.type === "direct" && room.participantIds[0] === friend?.id
  );
}

function contextForRoom(room, friend) {
  if (room.type === "direct" && friend.roomId === room.id) return friend;
  const context = {
    id: `${room.id}:${friend.id}`,
    baseFriendId: friend.id,
    roomId: room.id,
    conversationRoom: room,
    groupParticipantNames: room.participantIds.map(friendById).filter(Boolean).map((item) => item.profile.name),
    baseFriend: friend,
    profile: friend.profile,
    relationship: friend.relationship
  };
  for (const field of ["memories", "relationshipEvents"]) {
    Object.defineProperty(context, field, {
      enumerable: false,
      get: () => friend[field],
      set: (value) => {
        friend[field] = value;
      }
    });
  }
  for (const field of [
    "messages",
    "pending",
    "nextNudgeAt",
    "lastNudgeAt",
    "pausedNudgeRemainingMs",
    "ambientBurstCount",
    "error",
    "proactiveLog",
    "unreadCount",
    "nudgeStatus"
  ]) {
    Object.defineProperty(context, field, {
      enumerable: false,
      get: () => room[field],
      set: (value) => {
        room[field] = value;
      }
    });
  }
  return context;
}

function contextIsActive(friend) {
  return conversationRoomFor(friend)?.id === state.activeRoomId;
}

function activeConversationContext() {
  const room = activeRoom();
  const friend = activeFriend();
  return room && friend ? contextForRoom(room, friend) : friend;
}

function loadApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    if (!safeStorage.isEncryptionAvailable()) return volatileApiKey;
    return safeStorage.decryptString(fs.readFileSync(keyPath()));
  } catch {
    return volatileApiKey;
  }
}

function saveApiKey(apiKey) {
  volatileApiKey = apiKey;
  if (!apiKey) {
    try {
      fs.unlinkSync(keyPath());
    } catch {}
    return;
  }
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(keyPath(), safeStorage.encryptString(apiKey));
  }
}

function friendSummary(friend) {
  return {
    id: friend.id,
    name: friend.profile.name,
    gender: friend.profile.gender,
    age: friend.profile.age,
    proactiveEnabled: friend.profile.proactiveEnabled,
    voiceEnabled: friend.profile.voiceEnabled,
    mood: friend.relationship.mood
  };
}

function roomSummary(room) {
  const last = [...room.messages].reverse().find((message) => !message.hiddenFromChat) || null;
  const participants = room.participantIds.map(friendById).filter(Boolean);
  return {
    id: room.id,
    type: room.type,
    name: room.type === "direct" ? participants[0]?.profile.name || room.name : room.name,
    participantIds: room.participantIds,
    participantNames: participants.map((friend) => friend.profile.name),
    lastMessage: last
      ? {
          ...last,
          senderName:
            last.role === "assistant"
              ? last.senderName || friendById(last.senderId)?.profile.name || participants[0]?.profile.name
              : null
        }
      : null,
    unreadCount: room.unreadCount,
    autonomousEnabled: room.autonomousEnabled
  };
}

function voiceSynthesisStatus(room) {
  if (!room) return null;
  const waiting = room.pending.filter((item) => {
    const speaker = friendById(item.senderId || room.participantIds[0]);
    return (
      speaker &&
      waitsForVoice(speaker.profile, item) &&
      !item.voiceReady &&
      !item.voiceError
    );
  });
  if (!waiting.length) return null;
  const firstSpeaker = friendById(waiting[0].senderId || room.participantIds[0]);
  return {
    active: true,
    friendName: firstSpeaker?.profile.name || null,
    pendingCount: waiting.length
  };
}

function publicState() {
  const friend = activeFriend();
  const room = activeRoom();
  const stage = relationshipStage(friend.relationship);
  const messages = (room?.messages || []).map((message) => ({
    ...message,
    senderName:
      message.role === "assistant"
        ? message.senderName || friendById(message.senderId)?.profile.name || friend.profile.name
        : null
  }));
  return {
    version: state.version,
    activeRoomId: room?.id || null,
    activeFriendId: friend.id,
    friends: state.friends.map(friendSummary),
    rooms: (state.rooms || []).map(roomSummary),
    room: room
      ? {
          id: room.id,
          type: room.type,
          name: room.type === "direct" ? friend.profile.name : room.name,
          participantIds: room.participantIds,
          participantNames: room.participantIds.map(friendById).filter(Boolean).map((item) => item.profile.name),
          autonomousEnabled: room.autonomousEnabled,
          autonomousFrequency: room.autonomousFrequency,
          autonomousMaxTurns: room.autonomousMaxTurns,
          autonomousTurnCount: room.autonomousTurnCount
        }
      : null,
    settings: {
      ...state.appSettings,
      ...friend.profile,
      hasApiKey: Boolean(loadApiKey())
    },
    relationship: { ...friend.relationship, stage },
    memories: friend.memories,
    messages,
    pending: room?.pending || [],
    voiceSynthesisStatus: voiceSynthesisStatus(room),
    liveConversation: liveConversationPublicState(),
    nextNudgeAt: room?.nextNudgeAt || null,
    lastNudgeAt: room?.lastNudgeAt || null,
    nudgeStatus: room?.nudgeStatus || null,
    error: room?.error || null,
    usage: state.usage
  };
}

function broadcast() {
  scheduleStateSave();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("state:changed", publicState());
  }
}

function voiceCachePath(friend, message) {
  const signature = JSON.stringify({
    text: message.spokenText,
    endpoint: state.appSettings.sbv2Endpoint,
    model: friend.profile.voiceModelId,
    speaker: friend.profile.voiceSpeakerId,
    style: friend.profile.voiceStyle,
    weight: friend.profile.voiceStyleWeight,
    length: friend.profile.voiceLength
  });
  const hash = crypto.createHash("sha256").update(signature).digest("hex").slice(0, 24);
  const voiceOwnerId = String(friend.baseFriendId || friend.id).replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(app.getPath("userData"), "voice-cache", voiceOwnerId, `${message.id}-${hash}.wav`);
}

function logVoice(event, friend, message, extra = {}) {
  appendVoiceDiagnostic(app.getPath("userData"), {
    event,
    friendId: friend.baseFriendId || friend.id,
    friendName: friend.profile.name,
    messageId: message.id || null,
    displayText: message.text || null,
    spokenText: message.spokenText || null,
    spokenLength: Array.from(String(message.spokenText || "")).length,
    modelId: friend.profile.voiceModelId,
    speakerId: friend.profile.voiceSpeakerId,
    style: friend.profile.voiceStyle,
    styleWeight: friend.profile.voiceStyleWeight,
    length: friend.profile.voiceLength,
    ...extra
  });
}

async function fetchSbv2Models() {
  const endpoint = normalizeEndpoint(state.appSettings.sbv2Endpoint);
  const response = await fetch(`${endpoint}/models/info`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`SBV2 서버 응답 오류 (${response.status})`);
  return modelOptions(await response.json());
}

async function assertVoiceServerAvailable() {
  const endpoint = normalizeEndpoint(state.appSettings.sbv2Endpoint);
  const now = Date.now();
  if (voiceServerHealth.endpoint === endpoint) {
    const age = now - voiceServerHealth.checkedAt;
    if (voiceServerHealth.ok && age < VOICE_SERVER_HEALTH_TTL_MS) return;
    if (!voiceServerHealth.ok && voiceServerHealth.checkedAt && age < VOICE_SERVER_FAILURE_TTL_MS) {
      throw new Error(voiceServerHealth.error || "SBV2 음성 서버에 연결할 수 없어.");
    }
  }
  if (voiceServerHealthCheck) return voiceServerHealthCheck;
  voiceServerHealthCheck = (async () => {
    try {
      const response = await fetch(`${endpoint}/models/info`, {
        signal: AbortSignal.timeout(VOICE_SERVER_HEALTH_TIMEOUT_MS)
      });
      if (!response.ok) throw new Error(`서버 응답 오류 (${response.status})`);
      voiceServerHealth = { endpoint, checkedAt: Date.now(), ok: true, error: null };
    } catch (error) {
      const friendly = new Error("SBV2 음성 서버에 연결할 수 없어. 서버가 실행 중인지 확인해줘.");
      friendly.cause = error;
      voiceServerHealth = {
        endpoint,
        checkedAt: Date.now(),
        ok: false,
        error: friendly.message
      };
      throw friendly;
    } finally {
      voiceServerHealthCheck = null;
    }
  })();
  return voiceServerHealthCheck;
}

async function synthesizeMessage(messageId) {
  const room = state.rooms.find((candidate) =>
    candidate.messages.some((message) => message.id === messageId)
  );
  const message = room?.messages.find((candidate) => candidate.id === messageId);
  const baseFriend = friendById(message?.senderId || room?.participantIds?.[0]);
  const friend = room && baseFriend ? contextForRoom(room, baseFriend) : null;
  if (!message || message.role !== "assistant" || !message.spokenText) {
    throw new Error("이 메시지에는 음성용 문장이 없어.");
  }
  const audio = await ensureVoiceAudio(friend, message);
  return { mimeType: "audio/wav", base64: audio.toString("base64") };
}

async function previewVoice(incoming = {}) {
  const current = activeFriend().profile;
  const profile = {
    ...current,
    voiceModelId: Math.max(0, Math.round(Number(incoming.voiceModelId || 0))),
    voiceSpeakerId: Math.max(0, Math.round(Number(incoming.voiceSpeakerId || 0))),
    voiceStyle: String(incoming.voiceStyle || "Neutral").slice(0, 100),
    voiceStyleWeight: Number(incoming.voiceStyleWeight || 1),
    voiceLength: Number(incoming.voiceLength || 1),
    voiceLanguage: "ja"
  };
  const response = await fetch(
    voiceUrl(
      state.appSettings.sbv2Endpoint,
      profile,
      "こんにちは。今日は何してたの？"
    ),
    { method: "POST", signal: AbortSignal.timeout(120000) }
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error(`SBV2 미리듣기 실패 (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  return { mimeType: "audio/wav", base64: audio.toString("base64") };
}

async function ensureVoiceAudio(friend, message) {
  if (friend.profile.voiceLanguage !== "ko") {
    message.spokenText = sanitizeJapaneseSpokenText(message.spokenText);
  }
  const cachePath = voiceCachePath(friend, message);
  let audio;
  try {
    audio = await fs.promises.readFile(cachePath);
    logVoice("cache_hit", friend, message, { cachePath, bytes: audio.length });
  } catch {
    const chunks = splitVoiceText(message.spokenText, 90);
    logVoice("synthesis_started", friend, message, { cachePath, chunks });
    try {
      await assertVoiceServerAvailable();
      const segments = [];
      for (const text of chunks) {
        const response = await fetch(
          voiceUrl(state.appSettings.sbv2Endpoint, friend.profile, text),
          { method: "POST", signal: AbortSignal.timeout(120000) }
        );
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 500);
          const error = new Error(
            `SBV2 음성 생성 실패 (${response.status})${detail ? `: ${detail}` : ""}`
          );
          error.status = response.status;
          throw error;
        }
        segments.push(Buffer.from(await response.arrayBuffer()));
      }
      audio = concatWavBuffers(segments);
      await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.promises.writeFile(cachePath, audio);
      logVoice("synthesis_completed", friend, message, {
        cachePath,
        chunkCount: chunks.length,
        bytes: audio.length
      });
    } catch (error) {
      logVoice("synthesis_failed", friend, message, {
        cachePath,
        chunks,
        status: error.status || null,
        error: String(error.message || error).slice(0, 1000)
      });
      throw error;
    }
  }
  return audio;
}

async function preparePendingVoice(friend, item) {
  const preparationId = `${friend.id}:${item.id}`;
  if (voicePreparationInFlight.has(preparationId) || item.voiceReady || item.voiceError) return;
  voicePreparationInFlight.add(preparationId);
  try {
    await ensureVoiceAudio(friend, {
      id: item.id,
      text: item.text,
      spokenText: item.spokenText
    });
    item.voiceReady = true;
  } catch (error) {
    item.voiceError = String(error.message || error).slice(0, 240);
  } finally {
    voicePreparationInFlight.delete(preparationId);
    broadcast();
  }
}

function schedulePendingVoice(friend, item) {
  if (!waitsForVoice(friend.profile, item)) return;
  const previous = voicePreparationChains.get(friend.id) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => preparePendingVoice(friend, item))
    .finally(() => {
      if (voicePreparationChains.get(friend.id) === next) {
        voicePreparationChains.delete(friend.id);
      }
    });
  voicePreparationChains.set(friend.id, next);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow.show();
  mainWindow.restore();
  mainWindow.focus();
}

function createTrayIcon() {
  const iconPath = path.join(__dirname, "assets", "icon.png");
  const image = nativeImage.createFromPath(iconPath);
  if (!image.isEmpty()) return image.resize({ width: 16, height: 16 });
  const fallbackSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <circle cx="16" cy="16" r="15" fill="#fc6d52"/>
      <text x="16" y="22" text-anchor="middle" fill="white"
        font-family="Georgia,serif" font-size="20" font-style="italic" font-weight="700">H</text>
    </svg>`;
  return nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(fallbackSvg).toString("base64")}`)
    .resize({ width: 16, height: 16 });
}

function selectRoom(roomId, showWindow = false) {
  const room = roomById(roomId);
  if (!room) return publicState();
  if (liveConversationSession && liveConversationSession.roomId !== room.id) {
    stopLiveConversation("room_changed");
  }
  const previousFriendId = activeFriend()?.id;
  userIsTyping = false;
  clearTimeout(typingExpiryTimer);
  state.activeRoomId = room.id;
  state.activeFriendId = room.participantIds[0] || state.activeFriendId;
  room.unreadCount = 0;
  const friend = activeFriend();
  const roomIsGenerating = [...generationInFlight].some(
    (key) => key === room.id || key.startsWith(`${room.id}:`)
  );
  setThinking(room.type === "direct" ? generationInFlight.has(friend.id) : roomIsGenerating);
  if (replyPending.has(previousFriendId)) scheduleReplyGeneration(previousFriendId);
  if (room.type === "direct") {
    const latest = room.messages[room.messages.length - 1];
    if (latest?.role === "user" && !room.pending.length && !generationInFlight.has(friend.id)) {
      replyPending.add(friend.id);
      scheduleReplyGeneration(friend.id);
    }
  }
  updateTrayMenu();
  broadcast();
  if (showWindow) showMainWindow();
  return publicState();
}

function selectFriend(friendId, showWindow = false) {
  const room = state.rooms.find(
    (candidate) => candidate.type === "direct" && candidate.participantIds[0] === friendId
  );
  return room ? selectRoom(room.id, showWindow) : publicState();
}

function ensureTray() {
  if (tray && !tray.isDestroyed()) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip(`HER · 친구 ${state.friends.length}명`);
  updateTrayMenu();
  tray.on("double-click", showMainWindow);
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const friendItems = state.rooms.map((room) => ({
    label: `${room.unreadCount ? `(${room.unreadCount}) ` : ""}${roomSummary(room).name}`,
    click: () => selectRoom(room.id, true)
  }));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "HER 열기", click: showMainWindow },
      { type: "separator" },
      ...friendItems,
      { type: "separator" },
      {
        label: "자동 음성 음소거",
        type: "checkbox",
        checked: Boolean(state.appSettings.voiceMuted),
        click: (item) => {
          state.appSettings.voiceMuted = Boolean(item.checked);
          if (item.checked) stopAutomaticVoice();
          broadcast();
          updateTrayMenu();
        }
      },
      { type: "separator" },
      {
        label: "HER 종료",
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
  tray.setToolTip(`HER · 친구 ${state.friends.length}명`);
}

function syncLoginItemSettings(enabled) {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const args = ["--hidden"];
  const executablePath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  if (!enabled) {
    const knownNames = new Set([APP_ID, app.getName(), "HER", "her-ai-friend"]);
    const launchItems = app.getLoginItemSettings({ path: executablePath }).launchItems || [];
    for (const item of launchItems) {
      const sameExecutable = path.resolve(item.path || "") === path.resolve(executablePath);
      if (!sameExecutable && !knownNames.has(item.name)) continue;
      app.setLoginItemSettings({
        openAtLogin: false,
        enabled: false,
        name: item.name,
        path: item.path || executablePath,
        args: item.args || []
      });
    }
  }
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    enabled: Boolean(enabled),
    name: APP_ID,
    path: executablePath,
    args
  });
}

function loginItemIsEnabled() {
  if (process.platform !== "win32" || !app.isPackaged) {
    return Boolean(state?.appSettings?.launchAtLogin);
  }
  const executablePath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const loginItem = app.getLoginItemSettings({
    path: executablePath,
    args: ["--hidden"]
  });
  return Boolean(loginItem.openAtLogin && loginItem.executableWillLaunchAtLogin);
}

function setThinking(value) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("thinking:changed", value);
  }
}

function addMessage(friend, role, text, proactive = false, metadata = {}) {
  const room = conversationRoomFor(friend);
  if (!room) return null;
  const message = {
    id: id(),
    role,
    text: String(text).trim(),
    createdAt: new Date().toISOString(),
    proactive,
    reactions: {},
    ...(role === "assistant"
      ? {
          senderId: friend.baseFriendId || friend.id,
          senderName: friend.profile.name
        }
      : {}),
    ...metadata
  };
  if (role === "user") {
    message.replyTiming = userReplyTiming(friend.messages);
    message.readAt = null;
    message.readDueAt = new Date(Date.now() + readDelayMs(friend.profile)).toISOString();
  } else if (
    !message.hiddenFromChat &&
    (
      room.id !== state.activeRoomId ||
      !mainWindow ||
      mainWindow.isDestroyed() ||
      !mainWindow.isFocused()
    )
  ) {
    room.unreadCount += 1;
  }
  room.messages.push(message);
  room.messages = room.messages.slice(-300);
  return message;
}

function recordUsage(usage, model, friendId, mode) {
  if (recordUsageInStore(state.usage, usage, { model, friendId, mode })) broadcast();
}

function logConversationEvent(event, friend, details = {}) {
  return appendEventDiagnostic(app.getPath("userData"), {
    event,
    friendId: friend?.baseFriendId || friend?.id || null,
    roomId: conversationRoomFor(friend)?.id || null,
    friendName: friend?.profile?.name || null,
    ...details
  });
}

function setNudgeStatus(friend, stateName, details = {}) {
  friend.nudgeStatus = {
    state: stateName,
    updatedAt: new Date().toISOString(),
    ...details
  };
}

function stopAutomaticVoice() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("voice:auto-stop");
  }
}

function liveConversationPublicState() {
  if (!liveConversationSession) {
    return lastLiveConversationStop || { active: false };
  }
  return {
    active: true,
    roomId: liveConversationSession.roomId,
    friendId: liveConversationSession.friendId,
    status: liveConversationSession.status,
    nextTurnAt: liveConversationSession.nextTurnAt,
    unansweredTurns: liveConversationSession.unansweredTurns,
    startedAt: liveConversationSession.startedAt
  };
}

function stopLiveConversation(reason = "manual", options = {}) {
  if (!liveConversationSession) return liveConversationPublicState();
  const stopped = liveConversationSession;
  clearTimeout(liveConversationTimer);
  liveConversationTimer = null;
  liveConversationSession = null;
  lastLiveConversationStop = {
    active: false,
    roomId: stopped.roomId,
    reason,
    stoppedAt: new Date().toISOString()
  };
  const friend = friendById(stopped.friendId);
  if (friend) {
    if (stopped.status === "generating") abortGeneration(friend.id);
    if (!options.preservePending) {
      friend.pending = friend.pending.filter((item) => item.source !== "live_conversation");
    }
    delete friend.liveConversationRequest;
  }
  stopAutomaticVoice();
  logConversationEvent("live_conversation_stopped", friend, {
    reason,
    unansweredTurns: stopped.unansweredTurns
  });
  broadcast();
  return liveConversationPublicState();
}

function scheduleLiveConversationTurn(delayMs, reason = "silence") {
  if (!liveConversationSession) return;
  clearTimeout(liveConversationTimer);
  const delay = Math.max(500, Number(delayMs) || 1000);
  liveConversationSession.status = "waiting";
  liveConversationSession.reason = reason;
  liveConversationSession.nextTurnAt = new Date(Date.now() + delay).toISOString();
  liveConversationTimer = setTimeout(runLiveConversationTurn, delay);
  broadcast();
}

async function runLiveConversationTurn() {
  const session = liveConversationSession;
  if (!session) return;
  liveConversationTimer = null;
  const room = roomById(session.roomId);
  const friend = friendById(session.friendId);
  if (!room || room.type !== "direct" || !friend) {
    stopLiveConversation("room_unavailable");
    return;
  }
  if (
    !friend.profile.voiceEnabled ||
    !friend.profile.voiceAutoPlay ||
    state.appSettings.voiceMuted
  ) {
    stopLiveConversation("voice_disabled");
    return;
  }
  if (
    !state.appSettings.playVoiceInBackground &&
    (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isFocused())
  ) {
    stopLiveConversation("window_inactive");
    return;
  }
  if (userIsTyping || generationInFlight.has(friend.id) || friend.pending.length) {
    scheduleLiveConversationTurn(1500, userIsTyping ? "typing" : "busy");
    return;
  }
  const latestUser = [...room.messages].reverse().find((message) => message.role === "user");
  if (room.messages.at(-1)?.role === "user" && !replyPending.has(friend.id)) {
    replyPending.add(friend.id);
    scheduleReplyGeneration(friend.id, 100);
  }
  if (replyPending.has(friend.id) || room.messages.at(-1)?.role === "user") {
    scheduleLiveConversationTurn(1500, "waiting_for_reply");
    return;
  }
  const userResponded = latestUser?.id && latestUser.id !== session.lastObservedUserMessageId;
  if (userResponded) {
    session.lastObservedUserMessageId = latestUser.id;
    session.unansweredTurns = 0;
  } else if (session.hasSpoken) {
    session.unansweredTurns += 1;
  }
  if (session.unansweredTurns >= MAX_UNANSWERED_TURNS) {
    stopLiveConversation("no_response");
    return;
  }
  friend.liveConversationRequest = livePromptState({
    lastSpokenAt: session.lastSpokenAt || session.startedAt,
    unansweredTurns: session.unansweredTurns,
    reason: session.reason
  });
  session.status = "generating";
  session.nextTurnAt = null;
  broadcast();
  const accepted = await generateReply(
    "proactive",
    true,
    null,
    friend.id,
    "live_conversation"
  );
  delete friend.liveConversationRequest;
  if (liveConversationSession !== session) return;
  const queued = friend.pending.some((item) => item.source === "live_conversation");
  if (!accepted || !queued) {
    session.failures += 1;
    if (session.failures >= 2) stopLiveConversation("generation_failed");
    else scheduleLiveConversationTurn(5000, "retry");
    return;
  }
  session.failures = 0;
  session.status = "preparing_voice";
  broadcast();
}

function startLiveConversation() {
  const room = activeRoom();
  const friend = activeFriend();
  if (!room || room.type !== "direct") throw new Error("통화형 대화는 1:1 대화방에서만 쓸 수 있어.");
  if (!friend.profile.voiceEnabled || !friend.profile.voiceAutoPlay) {
    throw new Error("친구 설정에서 음성 사용과 답장 자동 재생을 먼저 켜줘.");
  }
  if (state.appSettings.voiceMuted) throw new Error("트레이의 음성 음소거를 먼저 풀어줘.");
  if (!state.appSettings.playVoiceInBackground && !mainWindow?.isFocused()) {
    throw new Error("창을 활성화한 상태에서 통화를 시작해줘.");
  }
  if (liveConversationSession) stopLiveConversation("restarted");
  const latestUser = [...room.messages].reverse().find((message) => message.role === "user");
  liveConversationSession = {
    roomId: room.id,
    friendId: friend.id,
    startedAt: new Date().toISOString(),
    status: "starting",
    nextTurnAt: null,
    unansweredTurns: 0,
    lastObservedUserMessageId: latestUser?.id || null,
    lastSpokenAt: null,
    hasSpoken: false,
    failures: 0
  };
  lastLiveConversationStop = null;
  logConversationEvent("live_conversation_started", friend);
  scheduleLiveConversationTurn(600, "start");
  return liveConversationPublicState();
}

function tokenBudgetBlock(mode) {
  return tokenBudgetMessage(state.usage, state.appSettings, mode);
}

function openAIRequestBody(mode, friend, model) {
  return buildOpenAIRequestBody({
    mode,
    friend,
    model,
    userProfile: state.appSettings,
    maxOutputTokens: state.appSettings.maxOutputTokens
  });
}

async function callOpenAI(mode, friend, signal, modelOverride = null) {
  const apiKey = loadApiKey();
  if (!apiKey) return { reply: demoReply(mode, friend), usage: null };

  const model = modelOverride || state.appSettings.model || "gpt-5.6-sol";
  return requestOpenAI({
    apiKey,
    body: openAIRequestBody(mode, friend, model),
    signal,
    waitForRetry,
    onInvalidResponse(error, attempt) {
      logConversationEvent("generation_response_invalid", friend, {
        mode,
        attempt,
        error: String(error.message || error).slice(0, 240)
      });
    }
  });
}

function waitForRetry(signal) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, 1200);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

function demoReply(mode, friend) {
  const lastUser = [...friend.messages].reverse().find((message) => message.role === "user");
  const proactive = [
    ["야", "갑자기 전에 하던 얘기 생각났음"],
    ["뭐하냐", "나 지금 집중 안 돼서 딴짓 중"],
    ["아 맞다", "너 저번에 말한 그건 어떻게 됐냐"]
  ];
  const reactive = [
    ["아 그건 좀 웃긴데ㅋㅋ", "근데 진짜 그렇게 했다고?"],
    ["뭔 소리야ㅋㅋ", "일단 계속 말해봐"],
    ["봤음", "잠깐 딴거 하다가 이제 답함"],
    [`${lastUser?.text?.length > 18 ? "잠깐만 읽는 중" : "엥"}`, "그건 좀 예상 못했네"]
  ];
  const lateReactive = [
    ["오 이제 왔네", "그래서 아까 하던 얘기 계속해봐"],
    ["사람 궁금하게 해놓고 이제 옴?ㅋㅋ", "그래서 어떻게 됐는데"],
    ["나 뭐 물어봤는지 까먹을 뻔", "아무튼 말해봐"]
  ];
  const timing = lastUser?.replyTiming;
  const noticeLateReply =
    timing?.wasExpected &&
    (["late", "very_late"].includes(timing.label) ||
      (timing.label === "slightly_late" && Math.random() < 0.25));
  const choices =
    mode === "proactive" ? proactive : noticeLateReply ? lateReactive : reactive;
  const selectedIndex = Math.floor(Math.random() * choices.length);
  const messages = choices[selectedIndex];
  const spokenSets = mode === "proactive"
    ? [["ねえ", "急に前に話してたこと思い出した"], ["何してるの", "今集中できなくてちょっとさぼってる"], ["あ、そうだ", "この前言ってたあれ、どうなった？"]]
    : noticeLateReply
      ? [["あ、やっと来た", "それで、さっきの話の続き聞かせて"], ["気になるところで今来るの？", "それでどうなったの"], ["何を聞いたか忘れるところだった", "とにかく話して"]]
      : [["それはちょっと面白いんだけど", "でも本当にそうしたの？"], ["何それ", "とりあえず続けて"], ["見たよ", "ちょっと他のことしてて今返してる"], ["えっ", "それはちょっと予想してなかった"]];
  const reply = {
    messages,
    firstDelaySeconds: mode === "proactive" ? 1 : 3 + Math.floor(Math.random() * 5),
    betweenDelaySeconds: 2 + Math.floor(Math.random() * 3),
    memories: [],
    mood: "장난스러움",
    expectsReply: mode !== "proactive" || Math.random() > 0.35,
    relationshipEvent: "ordinary",
    nextNudgeHours: 8
  };
  if (friend.profile.voiceEnabled && friend.profile.voiceLanguage !== "ko") {
    reply.spokenMessages = spokenSets[selectedIndex] || spokenSets[0];
  }
  return reply;
}

function revisionFor(friendId) {
  return conversationRevisions.get(friendId) || 0;
}

function bumpRevision(friendId) {
  conversationRevisions.set(friendId, revisionFor(friendId) + 1);
}

function scheduleReplyGeneration(friendId, delay) {
  const friend = friendById(friendId);
  if (!friend || !replyPending.has(friendId) || generationInFlight.has(friendId)) return;
  clearTimeout(replyTimers.get(friendId));
  if (friendId === state.activeFriendId && userIsTyping) return;
  const timeout = setTimeout(async () => {
    if (friendId === state.activeFriendId && userIsTyping) return;
    replyPending.delete(friendId);
    const expectedRevision = revisionFor(friendId);
    const accepted = await generateReply("reactive", false, expectedRevision, friendId, "reply");
    if (!accepted || revisionFor(friendId) !== expectedRevision) {
      const latest = friend.messages[friend.messages.length - 1];
      if (latest?.role === "user") {
        replyPending.add(friendId);
        scheduleReplyGeneration(friendId);
      }
    }
  }, delay ?? replyBatchDelayMs(friend.profile));
  replyTimers.set(friendId, timeout);
}

function updateUserTyping(isTyping) {
  const friendId = state.activeFriendId;
  const room = activeRoom();
  userIsTyping = Boolean(isTyping);
  clearTimeout(typingExpiryTimer);
  if (userIsTyping) {
    if (liveConversationSession?.roomId === room?.id) {
      clearTimeout(liveConversationTimer);
      liveConversationTimer = null;
      liveConversationSession.status = "typing";
      liveConversationSession.nextTurnAt = null;
      broadcast();
    }
    clearTimeout(replyTimers.get(friendId));
    typingExpiryTimer = setTimeout(() => {
      userIsTyping = false;
      if (room?.type === "group") {
        const latest = room.messages.at(-1);
        if (latest?.role === "user" && !room.pending.length) {
          scheduleRoomTurn(room, 2000, "group_reply");
        }
      } else {
        scheduleReplyGeneration(friendId, 2000);
      }
    }, 6000);
    return;
  }
  if (room?.type === "group") {
    const latest = room.messages.at(-1);
    if (latest?.role === "user" && !room.pending.length) {
      scheduleRoomTurn(room, 500, "group_reply");
    }
  } else {
    scheduleReplyGeneration(friendId);
    if (
      liveConversationSession?.roomId === room?.id &&
      room?.messages.at(-1)?.role !== "user"
    ) {
      scheduleLiveConversationTurn(2000, "typing_finished");
    }
  }
}

function pauseOrResumeNudge(friend, wasEnabled) {
  const isEnabled = friend.profile.proactiveEnabled;
  if (wasEnabled && !isEnabled) {
    const remaining = friend.nextNudgeAt
      ? new Date(friend.nextNudgeAt).getTime() - Date.now()
      : 6 * 3600000;
    friend.pausedNudgeRemainingMs = Math.max(10 * 60000, remaining);
    friend.nextNudgeAt = null;
    setNudgeStatus(friend, "paused");
  } else if (!wasEnabled && isEnabled) {
    const remaining = friend.pausedNudgeRemainingMs || 6 * 3600000;
    friend.nextNudgeAt = new Date(Date.now() + remaining).toISOString();
    friend.pausedNudgeRemainingMs = 0;
    setNudgeStatus(friend, "scheduled", { nextAt: friend.nextNudgeAt });
  }
}

function ambientVoiceActive(friend) {
  return conversationRoomFor(friend)?.type !== "group" && ambientVoiceConfigured(friend.profile);
}

function applyReplyMetadata(reply, friend, options = {}) {
  const validSourceIds = new Set(
    friend.messages.filter((message) => message.role === "user").map((message) => message.id)
  );
  friend.memories = mergeExplicitMemories(
    friend.memories,
    reply.memories,
    validSourceIds,
    id
  );
  friend.relationship.mood = reply.mood;
  applyRelationshipEvent(friend, reply.relationshipEvent);
  const room = conversationRoomFor(friend);
  if (room?.type === "group") return;
  if (options.liveConversation) return;
  const initiativeFactor = 1.55 - (friend.profile.initiative / 100) * 0.85;
  const adjustedHours = Math.max(2, reply.nextNudgeHours * initiativeFactor);
  if (friend.profile.proactiveEnabled) {
    const nextDelay = ambientVoiceActive(friend)
      ? ambientIntervalMs(friend.profile.ambientVoiceFrequency)
      : adjustedHours * 3600000;
    friend.nextNudgeAt = new Date(Date.now() + nextDelay).toISOString();
    friend.pausedNudgeRemainingMs = 0;
  } else {
    friend.nextNudgeAt = null;
    friend.pausedNudgeRemainingMs = adjustedHours * 3600000;
  }
}

function queueReply(reply, proactive, immediate, friend, options = {}) {
  const multiplier = paceMultiplier(friend.profile);
  const ambient = proactive && (options.ambient ?? ambientVoiceActive(friend));
  const replyBatchId = id();
  let deliverAt = Date.now() + (immediate ? 300 : reply.firstDelaySeconds * 1000 * multiplier);
  reply.messages.forEach((text, index) => {
    const isLast = index === reply.messages.length - 1;
    const pendingItem = {
      id: id(),
      replyBatchId,
      replyBatchIndex: index + 1,
      replyBatchTotal: reply.messages.length,
      text,
      spokenText: friend.profile.voiceEnabled
        ? friend.profile.voiceLanguage === "ko"
          ? text
          : sanitizeJapaneseSpokenText(reply.spokenMessages?.[index]) || null
        : null,
      proactive,
      source: options.source || "unknown",
      senderId: friend.baseFriendId || friend.id,
      senderName: friend.profile.name,
      ambient,
      hiddenFromChat: ambient && !friend.profile.ambientSaveTranscript,
      expectsReply: isLast && Boolean(reply.expectsReply),
      replyMetadata: isLast
          ? {
            memories: reply.memories || [],
            mood: reply.mood,
            relationshipEvent: proactive ? "ordinary" : reply.relationshipEvent,
            nextNudgeHours: reply.nextNudgeHours
          }
        : null,
      deliverAt: new Date(deliverAt).toISOString()
    };
    friend.pending.push(pendingItem);
    schedulePendingVoice(friend, pendingItem);
    deliverAt += reply.betweenDelaySeconds * 1000 * multiplier;
  });
  logConversationEvent("reply_queued", friend, {
    mode: proactive ? (ambient ? "ambient" : "proactive") : "reactive",
    source: options.source || "unknown",
    bubbleCount: reply.messages.length,
    pendingIds: friend.pending.slice(-reply.messages.length).map((item) => item.id),
    hiddenFromChat: ambient && !friend.profile.ambientSaveTranscript,
    firstDeliveryAt: friend.pending.at(-reply.messages.length)?.deliverAt || null,
    lastDeliveryAt: friend.pending.at(-1)?.deliverAt || null
  });
  if (proactive && options.source !== "live_conversation") {
    setNudgeStatus(friend, ambient ? "preparing_voice" : "waiting_delivery", {
      nextAt: friend.pending.at(-reply.messages.length)?.deliverAt || null
    });
  }
  broadcast();
  return replyBatchId;
}

function abortGeneration(friendId) {
  requestControllers.get(friendId)?.abort();
}

function abortRoomGenerations(roomId) {
  for (const [key, controller] of requestControllers.entries()) {
    if (key === roomId || key.startsWith(`${roomId}:`)) controller.abort();
  }
}

function prepareMessageHistoryMutation(room, friend) {
  if (room.type === "group") abortRoomGenerations(room.id);
  else abortGeneration(friend.id);
  bumpRevision(room.type === "group" ? room.id : friend.id);
  friend.pending = friend.pending.filter((item) => item.proactive);
  replyPending.delete(friend.id);
}

function cachedVoicePathForMessage(room, message) {
  if (!message.spokenText) return null;
  const voiceOwner = message.senderId ? friendById(message.senderId) : activeFriend();
  return voiceOwner ? voiceCachePath(contextForRoom(room, voiceOwner), message) : null;
}

function removeCachedVoice(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {}
}

async function generateReply(
  mode,
  immediate = false,
  expectedRevision = null,
  friendId,
  source = "scheduled",
  providedContext = null
) {
  const friend = providedContext || friendById(friendId || state.activeFriendId);
  if (!friend || generationInFlight.has(friend.id)) return false;
  if (mode === "proactive" && proactiveGenerationInFlight) return false;
  const autonomousRequest = source === "autonomous";
  const liveConversationRequest = source === "live_conversation";
  if (autonomousRequest) friend.autonomousRequest = true;
  const ambientRequest =
    mode === "proactive" && !autonomousRequest && !liveConversationRequest && ambientVoiceActive(friend);
  const requestModel = autonomousRequest || liveConversationRequest
    ? state.appSettings.autonomousModel || "gpt-5.6-luna"
    : state.appSettings.model || "gpt-5.6-sol";
  let usageRecorded = false;
  const startedAt = Date.now();
  const usageMode = liveConversationRequest ? "live" : mode;
  const budgetMessage = tokenBudgetBlock(usageMode);
  if (budgetMessage) {
    logConversationEvent("generation_blocked", friend, {
      mode: ambientRequest ? "ambient" : mode,
      source,
      reason: "token_budget",
      message: budgetMessage
    });
    if (liveConversationRequest) {
      stopLiveConversation("token_budget");
    } else if (mode === "proactive") {
      friend.nextNudgeAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
      setNudgeStatus(friend, "blocked", { message: budgetMessage, nextAt: friend.nextNudgeAt });
    } else {
      friend.error = {
        message: budgetMessage,
        detail: "앱·API 설정에서 한도를 늘리거나 사용량을 초기화할 수 있어.",
        retryable: true,
        mode,
        createdAt: new Date().toISOString()
      };
    }
    broadcast();
    return true;
  }
  const controller = new AbortController();
  if (mode === "proactive") {
    proactiveGenerationInFlight = true;
    if (!liveConversationRequest) setNudgeStatus(friend, "generating");
  }
  generationInFlight.add(friend.id);
  requestControllers.set(friend.id, controller);
  if (contextIsActive(friend)) setThinking(true);
  logConversationEvent("generation_started", friend, {
    mode: ambientRequest ? "ambient" : mode,
    source,
    immediate,
    recentMessageCount: friend.messages.length,
    pendingCount: friend.pending.length
  });
  try {
    const result = await callOpenAI(mode, friend, controller.signal, requestModel);
    recordUsage(result.usage, requestModel, friend.baseFriendId || friend.id, usageMode);
    usageRecorded = Boolean(result.usage);
    const reply = normalizeGeneratedReply(result.reply, friend.relationship.mood);
    if (
      mode === "reactive" &&
      expectedRevision !== null &&
      expectedRevision !== revisionFor(friend.id)
    ) {
      return false;
    }
    if (ambientRequest && !ambientVoiceActive(friend)) {
      friend.nextNudgeAt = new Date().toISOString();
      logConversationEvent("generation_discarded", friend, {
        mode: "ambient",
        source,
        reason: "ambient_disabled_during_generation",
        durationMs: Date.now() - startedAt
      });
      return false;
    }
    friend.error = null;
    const replyBatchId = queueReply(reply, mode === "proactive", immediate, friend, {
      ambient: ambientRequest,
      source
    });
    if (liveConversationRequest && liveConversationSession) {
      liveConversationSession.awaitingBatchId = replyBatchId;
    }
    logConversationEvent("generation_completed", friend, {
      mode: ambientRequest ? "ambient" : mode,
      source,
      durationMs: Date.now() - startedAt,
      bubbleCount: reply.messages.length,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null
    });
    return true;
  } catch (error) {
    if (!usageRecorded && error.usage) {
      recordUsage(error.usage, requestModel, friend.baseFriendId || friend.id, usageMode);
      usageRecorded = true;
    }
    if (error.name === "AbortError") {
      logConversationEvent("generation_aborted", friend, {
        mode: ambientRequest ? "ambient" : mode,
        source,
        durationMs: Date.now() - startedAt
      });
      return false;
    }
    if (
      mode === "reactive" &&
      expectedRevision !== null &&
      expectedRevision !== revisionFor(friend.id)
    ) {
      return false;
    }
    friend.error = {
      message:
        error.status === 401
          ? "API 키를 확인해줘."
          : error.status === 429
            ? "요청이 잠시 많아. 조금 뒤에 다시 시도해줘."
            : "AI 연결에 문제가 생겼어.",
      detail: String(error.message || error).slice(0, 320),
      retryable: error.status !== 401,
      mode,
      createdAt: new Date().toISOString()
    };
    if (mode === "proactive" && !liveConversationRequest) {
      const retryDelay = ambientVoiceActive(friend) ? 5 * 60 * 1000 : 8 * 3600000;
      friend.nextNudgeAt = new Date(Date.now() + retryDelay).toISOString();
      setNudgeStatus(friend, "failed", {
        message: friend.error.message,
        nextAt: friend.nextNudgeAt
      });
    }
    logConversationEvent("generation_failed", friend, {
      mode: ambientRequest ? "ambient" : mode,
      source,
      durationMs: Date.now() - startedAt,
      status: error.status || null,
      error: String(error.message || error).slice(0, 320)
    });
    broadcast();
    return true;
  } finally {
    if (autonomousRequest) delete friend.autonomousRequest;
    if (mode === "proactive") proactiveGenerationInFlight = false;
    generationInFlight.delete(friend.id);
    if (requestControllers.get(friend.id) === controller) {
      requestControllers.delete(friend.id);
    }
    if (contextIsActive(friend)) setThinking(false);
    const latest = friend.messages[friend.messages.length - 1];
    if (replyPending.has(friend.id) && latest?.role === "user") {
      scheduleReplyGeneration(friend.id);
    }
  }
}

function scheduleRoomTurn(room, delay = 2000, source = "group_reply") {
  if (room.type !== "group") return;
  clearTimeout(roomTurnTimers.get(room.id));
  const timeout = setTimeout(async () => {
    roomTurnTimers.delete(room.id);
    if (!roomById(room.id) || room.pending.length) return;
    if (userIsTyping) {
      scheduleRoomTurn(room, 2000, source);
      return;
    }
    const speaker = chooseNextSpeaker(room, state.friends);
    if (!speaker) return;
    const context = contextForRoom(room, speaker);
    if (source === "autonomous") context.autonomousRequest = true;
    if (source === "group_reply") {
      for (const message of room.messages) {
        if (message.role === "user" && !message.readAt) {
          message.readAt = new Date().toISOString();
          delete message.readDueAt;
        }
      }
      broadcast();
    }
    const mode = source === "autonomous" ? "proactive" : "reactive";
    const accepted = await generateReply(
      mode,
      source === "group_reply",
      null,
      context.id,
      source,
      context
    );
    if (source === "autonomous" && room.autonomousEnabled && (!accepted || !room.pending.length)) {
      room.nextAutonomousAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      broadcast();
    }
  }, delay);
  roomTurnTimers.set(room.id, timeout);
}

function scheduleNextAutonomousTurn(room, resting = false) {
  if (room.type !== "group" || !room.autonomousEnabled) {
    room.nextAutonomousAt = null;
    return;
  }
  room.nextAutonomousAt = new Date(
    Date.now() + autonomousIntervalMs(room.autonomousFrequency, Math.random, resting)
  ).toISOString();
}

function deliverGroupPending(room, now, quiet, notifications) {
  let changed = false;
  let due = room.pending.filter((item) => new Date(item.deliverAt).getTime() <= now);
  if (quiet.active) {
    const deferred = due.filter(
      (item) => item.proactive && !["test", "live_conversation"].includes(item.source)
    );
    deferred.forEach((item, itemIndex) => {
      item.deliverAt = new Date(quiet.endAt + 60 * 1000 + itemIndex * 12 * 1000).toISOString();
    });
    if (deferred.length) {
      setNudgeStatus(contextForRoom(room, friendById(deferred[0].senderId)), "quiet_hours", {
        nextAt: deferred[0].deliverAt
      });
      due = due.filter((item) => !deferred.includes(item));
      changed = true;
    }
  }
  for (const item of due) {
    const speaker = friendById(item.senderId) || friendById(room.participantIds[0]);
    if (!speaker) continue;
    const context = contextForRoom(room, speaker);
    if (waitsForVoice(context.profile, item) && !voiceDeliveryReady(context.profile, item)) {
      schedulePendingVoice(context, item);
    }
  }
  const deliverable = due.filter((item) => {
    const speaker = friendById(item.senderId) || friendById(room.participantIds[0]);
    return speaker && voiceDeliveryReady(speaker.profile, item) && !(item.ambient && userIsTyping);
  });
  for (const item of deliverable) {
    const speaker = friendById(item.senderId) || friendById(room.participantIds[0]);
    const context = contextForRoom(room, speaker);
    addMessage(context, "assistant", item.text, item.proactive, {
      id: item.id,
      senderId: speaker.id,
      senderName: speaker.profile.name,
      expectsReply: Boolean(item.expectsReply),
      spokenText: item.spokenText || null,
      replyBatchId: item.replyBatchId || null,
      replyBatchIndex: Number(item.replyBatchIndex || 1),
      replyBatchTotal: Number(item.replyBatchTotal || 1),
      ambient: Boolean(item.ambient),
      voiceError: item.voiceError || null,
      source: item.source || "unknown",
      hiddenFromChat: Boolean(item.hiddenFromChat)
    });
    if (
      item.spokenText &&
      !item.voiceError &&
      speaker.profile.voiceEnabled &&
      speaker.profile.voiceAutoPlay &&
      !state.appSettings.voiceMuted &&
      mainWindow &&
      !mainWindow.isDestroyed() &&
      (state.appSettings.playVoiceInBackground || mainWindow.isFocused())
    ) {
      mainWindow.webContents.send("voice:auto-deliver", {
        friendId: speaker.id,
        friendName: speaker.profile.name,
        messageId: item.id,
        replyBatchId: item.replyBatchId || null,
        replyBatchIndex: Number(item.replyBatchIndex || 1),
        replyBatchTotal: Number(item.replyBatchTotal || 1),
        ambient: Boolean(item.ambient)
      });
    }
    if (item.replyMetadata) {
      applyReplyMetadata(item.replyMetadata, context, {
        ambient: false,
        liveConversation: item.source === "live_conversation"
      });
    }
  }
  room.pending = room.pending.filter((item) => !deliverable.includes(item));
  if (deliverable.length) {
    const visible = deliverable.filter((item) => !item.hiddenFromChat);
    if (visible.length) notifications.push({ room, friend: friendById(visible.at(-1).senderId), text: visible.at(-1).text });
    const autonomousDelivered = deliverable.some(
      (item) => item.source === "autonomous" && item.replyMetadata
    );
    if (autonomousDelivered) {
      room.autonomousTurnCount += 1;
      const resting = room.autonomousTurnCount >= room.autonomousMaxTurns;
      if (resting) {
        room.autonomousTurnCount = 0;
        scheduleNextAutonomousTurn(room, true);
      } else {
        room.nextAutonomousAt = new Date(Date.now() + 3500 + Math.random() * 7500).toISOString();
      }
    }
    if (
      deliverable.some((item) => item.source === "group_reply" && item.replyMetadata) &&
      room.groupRepliesRemaining > 0
    ) {
      room.groupRepliesRemaining -= 1;
      scheduleRoomTurn(room, 2500 + Math.random() * 3000, "group_reply");
    }
    changed = true;
  }
  return changed;
}

function inQuietHours(value) {
  return quietHoursState(state.appSettings, value).active;
}

function spreadOverdueWorkAfterResume(now) {
  if (now - lastTickAt <= 30 * 1000) {
    lastTickAt = now;
    return false;
  }
  resumeHoldUntil = now + 60 * 1000;
  const changed = deferOverdueWorkAfterResume(state, now, {
    onFriendDeferred(friend, nextAt) {
      setNudgeStatus(friend, "resume_deferred", { nextAt });
    }
  });
  lastTickAt = now;
  return changed;
}

function tick() {
  const now = Date.now();
  let changed = spreadOverdueWorkAfterResume(now);
  const notifications = [];
  const quiet = quietHoursState(state.appSettings, new Date(now));

  for (const [friendIndex, friend] of state.friends.entries()) {
    for (const message of friend.messages) {
      if (
        message.role === "user" &&
        !message.readAt &&
        message.readDueAt &&
        new Date(message.readDueAt).getTime() <= now
      ) {
        message.readAt = new Date().toISOString();
        delete message.readDueAt;
        changed = true;
      }
    }

    let due = friend.pending.filter((item) => new Date(item.deliverAt).getTime() <= now);
    if (quiet.active) {
      const deferred = due.filter(
        (item) => item.proactive && !["test", "live_conversation"].includes(item.source)
      );
      deferred.forEach((item, itemIndex) => {
        item.deliverAt = new Date(
          quiet.endAt + 60 * 1000 + friendIndex * 45 * 1000 + itemIndex * 12 * 1000
        ).toISOString();
      });
      if (deferred.length) {
        setNudgeStatus(friend, "quiet_hours", { nextAt: deferred[0].deliverAt });
        logConversationEvent("proactive_deferred", friend, {
          reason: "quiet_hours",
          messageIds: deferred.map((item) => item.id),
          nextAt: deferred[0].deliverAt
        });
        changed = true;
        due = due.filter((item) => !item.proactive);
      }
    }
    if (due.length) {
      for (const item of due) {
        if (waitsForVoice(friend.profile, item) && !voiceDeliveryReady(friend.profile, item)) {
          schedulePendingVoice(friend, item);
        }
      }
      const deliverable = due.filter(
        (item) =>
          voiceDeliveryReady(friend.profile, item) &&
          !(item.ambient && userIsTyping)
      );
      for (const item of deliverable) {
        addMessage(friend, "assistant", item.text, item.proactive, {
          id: item.id,
          expectsReply: Boolean(item.expectsReply),
          spokenText: item.spokenText || null,
          replyBatchId: item.replyBatchId || null,
          replyBatchIndex: Number(item.replyBatchIndex || 1),
          replyBatchTotal: Number(item.replyBatchTotal || 1),
          ambient: Boolean(item.ambient),
          voiceError: item.voiceError || null,
          source: item.source || "unknown",
          hiddenFromChat: Boolean(item.hiddenFromChat)
        });
        if (
          item.spokenText &&
          !item.voiceError &&
          friend.profile.voiceEnabled &&
          friend.profile.voiceAutoPlay &&
          !state.appSettings.voiceMuted &&
          mainWindow &&
          !mainWindow.isDestroyed() &&
          (state.appSettings.playVoiceInBackground || mainWindow.isFocused())
        ) {
          mainWindow.webContents.send("voice:auto-deliver", {
            friendId: friend.id,
            friendName: friend.profile.name,
            messageId: item.id,
            replyBatchId: item.replyBatchId || null,
            replyBatchIndex: Number(item.replyBatchIndex || 1),
            replyBatchTotal: Number(item.replyBatchTotal || 1),
            ambient: Boolean(item.ambient)
          });
        }
        if (item.replyMetadata) {
          applyReplyMetadata(item.replyMetadata, friend, {
            ambient: Boolean(item.ambient),
            liveConversation: item.source === "live_conversation"
          });
          if (item.ambient) friend.ambientBurstCount += 1;
          if (item.proactive && item.source !== "live_conversation") {
            friend.proactiveLog.push({
              messageId: friend.messages[friend.messages.length - 1].id,
              createdAt: new Date().toISOString()
            });
            friend.proactiveLog = friend.proactiveLog.slice(-60);
          }
        }
        if (item.source === "live_conversation" && item.voiceError) {
          stopLiveConversation("voice_server_unavailable", { preservePending: true });
        }
      }
      friend.pending = friend.pending.filter(
        (item) => !deliverable.some((dueItem) => dueItem.id === item.id)
      );
      if (deliverable.length) {
        const visible = deliverable.filter((item) => !item.hiddenFromChat);
        if (visible.length) notifications.push({ friend, text: visible[visible.length - 1].text });
        logConversationEvent("reply_delivered", friend, {
          mode: deliverable.some((item) => item.ambient)
            ? "ambient"
            : deliverable.some((item) => item.proactive)
              ? "proactive"
              : "reactive",
          messageIds: deliverable.map((item) => item.id),
          textLengths: deliverable.map((item) => item.text.length),
          hiddenCount: deliverable.filter((item) => item.hiddenFromChat).length,
          voiceReadyCount: deliverable.filter((item) => item.voiceReady).length,
          voiceErrorCount: deliverable.filter((item) => item.voiceError).length,
          activeFriendId: state.activeFriendId,
          windowVisible: Boolean(mainWindow?.isVisible()),
          windowFocused: Boolean(mainWindow?.isFocused())
        });
        if (deliverable.some((item) => item.proactive)) {
          setNudgeStatus(friend, "delivered", {
            deliveredAt: new Date().toISOString(),
            nextAt: friend.nextNudgeAt || null
          });
        }
        if (deliverable.some((item) => item.source === "autonomous" && item.replyMetadata)) {
          const room = conversationRoomFor(friend);
          room.autonomousTurnCount += 1;
          const resting = room.autonomousTurnCount >= room.autonomousMaxTurns;
          if (resting) room.autonomousTurnCount = 0;
          scheduleNextAutonomousTurn(room, resting);
        }
        changed = true;
      }
    }

    const recent = friend.messages[friend.messages.length - 1];
    const hoursSinceMessage = recent
      ? (now - new Date(recent.createdAt).getTime()) / 3600000
      : 999;
    if (
      quiet.active &&
      friend.profile.proactiveEnabled &&
      friend.nextNudgeAt &&
      new Date(friend.nextNudgeAt).getTime() <= now
    ) {
      friend.nextNudgeAt = new Date(
        quiet.endAt + 60 * 1000 + friendIndex * 45 * 1000
      ).toISOString();
      setNudgeStatus(friend, "quiet_hours", { nextAt: friend.nextNudgeAt });
      changed = true;
    }
    const nudgeDue =
      friend.profile.proactiveEnabled &&
      friend.nextNudgeAt &&
      new Date(friend.nextNudgeAt).getTime() <= now;
    if (
      nudgeDue &&
      now >= resumeHoldUntil &&
      !inQuietHours() &&
      !friend.pending.length &&
      !replyPending.has(friend.id) &&
      !generationInFlight.has(friend.id) &&
      !proactiveGenerationInFlight &&
      !(userIsTyping && (friend.id === state.activeFriendId || ambientVoiceActive(friend))) &&
      (ambientVoiceActive(friend) || hoursSinceMessage >= 2)
    ) {
      const opportunity = proactiveOpportunity(friend, now);
      if (!opportunity.send) {
        logConversationEvent("proactive_skipped", friend, {
          mode: ambientVoiceActive(friend) ? "ambient" : "proactive",
          source: "scheduled",
          reason: opportunity.reason,
          retryAfterMs: opportunity.retryAfterMs
        });
        if (opportunity.resetAmbientBurst) friend.ambientBurstCount = 0;
        friend.nextNudgeAt = new Date(now + opportunity.retryAfterMs).toISOString();
        setNudgeStatus(friend, "deferred", {
          reason: opportunity.reason,
          nextAt: friend.nextNudgeAt
        });
        changed = true;
        continue;
      }
      friend.nextNudgeAt = null;
      friend.lastNudgeAt = new Date().toISOString();
      generateReply("proactive", false, null, friend.id, "scheduled");
      changed = true;
    }
  }

  for (const room of state.rooms) {
    if (room.type === "group" && deliverGroupPending(room, now, quiet, notifications)) {
      changed = true;
    }
    const autonomousDue =
      room.type === "group" &&
      room.autonomousEnabled &&
      room.nextAutonomousAt &&
      new Date(room.nextAutonomousAt).getTime() <= now;
    if (
      autonomousDue &&
      now >= resumeHoldUntil &&
      !quiet.active &&
      !room.pending.length &&
      !roomTurnTimers.has(room.id) &&
      !proactiveGenerationInFlight &&
      !userIsTyping
    ) {
      room.nextAutonomousAt = null;
      scheduleRoomTurn(room, 100, "autonomous");
      changed = true;
    }
  }

  if (changed) {
    updateTrayMenu();
    broadcast();
  }
  if (
    notifications.length &&
    (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isFocused()) &&
    Notification.isSupported()
  ) {
    for (const item of notifications) {
      const notification = new Notification({
        title: item.friend?.profile.name || roomSummary(item.room).name,
        body: state.appSettings.showNotificationPreview
          ? item.text
          : "새 메시지가 도착했어.",
        icon: APP_ICON
      });
      notification.on("click", () =>
        item.room ? selectRoom(item.room.id, true) : selectFriend(item.friend.id, true)
      );
      notification.show();
    }
  }
}

function createWindow() {
  const startHidden = process.argv.includes("--hidden");
  const windowIcon = nativeImage.createFromPath(APP_ICON);
  mainWindow = new BrowserWindow({
    width: 1060,
    height: 760,
    minWidth: 820,
    minHeight: 620,
    frame: false,
    show: false,
    backgroundColor: "#f3f0ea",
    title: "HER",
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  const applyWindowBranding = () => {
    mainWindow.setIcon(windowIcon);
    if (process.platform === "win32") {
      mainWindow.setAppDetails({
        appId: APP_ID,
        appIconPath: process.execPath,
        appIconIndex: 0
      });
    }
  };
  applyWindowBranding();
  mainWindow.once("ready-to-show", () => {
    applyWindowBranding();
    if (!startHidden) mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
  mainWindow.on("focus", () => {
    const room = activeRoom();
    if (room?.unreadCount) {
      room.unreadCount = 0;
      updateTrayMenu();
      broadcast();
    }
  });
  mainWindow.on("blur", () => {
    if (!state.appSettings.playVoiceInBackground) {
      stopAutomaticVoice();
      stopLiveConversation("window_inactive");
    }
  });
  mainWindow.on("close", (event) => {
    if (isQuitting || state.appSettings.keepInTray === false) return;
    event.preventDefault();
    if (!state.appSettings.playVoiceInBackground) {
      stopAutomaticVoice();
      stopLiveConversation("window_hidden");
    }
    mainWindow.hide();
    if (!trayHintShown && Notification.isSupported()) {
      trayHintShown = true;
      new Notification({
        title: "HER는 계속 실행 중",
        body: "친구들의 선톡을 받을 수 있도록 트레이에 남아 있어.",
        icon: APP_ICON
      }).show();
    }
  });
}

app.whenReady().then(() => {
  state = ensureRoomState(loadState(), id);
  state.version = STATE_VERSION;
  for (const friend of state.friends) {
    if (friend.profile.proactiveEnabled && !friend.nextNudgeAt) {
      friend.nextNudgeAt = new Date(Date.now() + initialNudgeDelayMs(ambientVoiceActive(friend))).toISOString();
    } else if (!friend.profile.proactiveEnabled && !friend.pausedNudgeRemainingMs) {
      friend.pausedNudgeRemainingMs = 6 * 3600000;
    }
  }
  for (const room of state.rooms) {
    if (room.type === "group" && room.autonomousEnabled && !room.nextAutonomousAt) {
      scheduleNextAutonomousTurn(room);
    }
  }
  saveState();
  createWindow();
  ensureTray();
  syncLoginItemSettings(state.appSettings.launchAtLogin);
  state.appSettings.launchAtLogin = loginItemIsEnabled();
  saveState();
  scheduler = setInterval(tick, 1000);

  for (const friend of state.friends) {
    const latest = friend.messages[friend.messages.length - 1];
    if (latest?.role === "user" && !friend.pending.length) {
      replyPending.add(friend.id);
      scheduleReplyGeneration(friend.id);
    }
  }
  for (const room of state.rooms) {
    const latest = room.messages.at(-1);
    if (
      room.type === "group" &&
      latest?.role === "user" &&
      !room.pending.length
    ) {
      scheduleRoomTurn(room, 2000, "group_reply");
    }
  }

  ipcMain.handle("state:get", () => publicState());
  ipcMain.handle("api-key:clear", () => {
    saveApiKey("");
    broadcast();
    return publicState();
  });
  ipcMain.handle("usage:reset", () => {
    state.usage = normalizeStoredUsage();
    broadcast();
    return publicState();
  });
  ipcMain.handle("typing:set", (_event, isTyping) => {
    updateUserTyping(isTyping);
    return true;
  });
  ipcMain.handle("voice:models", () => fetchSbv2Models());
  ipcMain.handle("voice:synthesize", (_event, messageId) => synthesizeMessage(messageId));
  ipcMain.handle("voice:playback:event", (_event, details = {}) => {
    const allowedEvents = new Set([
      "playback_queued",
      "playback_started",
      "playback_completed",
      "playback_stopped",
      "playback_failed"
    ]);
    if (!allowedEvents.has(details.event)) return false;
    const room = state.rooms.find((candidate) =>
      candidate.messages.some((message) => message.id === details.messageId)
    );
    const message = room?.messages.find((candidate) => candidate.id === details.messageId);
    const friend = friendById(message?.senderId || room?.participantIds?.[0]);
    appendVoiceDiagnostic(app.getPath("userData"), {
      event: details.event,
      friendId: friend?.id || null,
      roomId: room?.id || null,
      friendName: friend?.profile?.name || null,
      messageId: details.messageId || null,
      displayText: message?.text || null,
      spokenText: message?.spokenText || null,
      batchId: String(details.batchId || "").slice(0, 80) || null,
      batchIndex: Math.max(0, Number(details.batchIndex || 0)),
      batchTotal: Math.max(0, Number(details.batchTotal || 0)),
      durationMs: Math.max(0, Number(details.durationMs || 0)),
      error: details.error ? String(details.error).slice(0, 240) : null
    });
    const session = liveConversationSession;
    const isLiveRoom =
      session &&
      room?.id === session.roomId &&
      new Date(message?.createdAt || 0).getTime() >= new Date(session.startedAt).getTime();
    const isAutomaticBatch = details.batchId && !String(details.batchId).startsWith("manual-");
    const isLastInBatch = Number(details.batchIndex || 1) >= Number(details.batchTotal || 1);
    if (isLiveRoom && isAutomaticBatch) {
      if (details.event === "playback_started") {
        session.status = "speaking";
        session.nextTurnAt = null;
        broadcast();
      } else if (details.event === "playback_completed" && isLastInBatch) {
        session.status = "waiting";
        session.hasSpoken = true;
        session.lastSpokenAt = new Date().toISOString();
        session.awaitingBatchId = null;
        const latestUser = [...room.messages].reverse().find((item) => item.role === "user");
        if (latestUser?.id !== session.lastObservedUserMessageId) {
          session.lastObservedUserMessageId = latestUser?.id || null;
          session.unansweredTurns = 0;
        }
        scheduleLiveConversationTurn(
          nextLiveDelayMs({
            expectsReply: Boolean(message?.expectsReply),
            unansweredTurns: session.unansweredTurns
          }),
          "silence"
        );
      } else if (details.event === "playback_failed" && isLastInBatch) {
        session.failures += 1;
        if (session.failures >= 2) stopLiveConversation("playback_failed");
        else scheduleLiveConversationTurn(5000, "playback_retry");
      }
    }
    return true;
  });
  ipcMain.handle("live-conversation:toggle", () => {
    if (liveConversationSession?.roomId === activeRoom()?.id) {
      stopLiveConversation("manual");
    } else {
      startLiveConversation();
    }
    return publicState();
  });
  ipcMain.handle("voice:preview", (_event, profile) => previewVoice(profile));
  ipcMain.handle("voice:diagnostics:open", () => {
    const target = appendVoiceDiagnostic(app.getPath("userData"), { event: "log_opened" });
    shell.showItemInFolder(target || diagnosticPath(app.getPath("userData")));
    return target;
  });
  ipcMain.handle("settings:save", (_event, incoming) => {
    if (typeof incoming.apiKey === "string" && incoming.apiKey.trim()) {
      saveApiKey(incoming.apiKey.trim());
    }
    const friend = activeFriend();
    const wasProactiveEnabled = friend.profile.proactiveEnabled;
    const wasAmbientEnabled = ambientVoiceActive(friend);
    const previousAmbientFrequency = friend.profile.ambientVoiceFrequency;
    for (const key of Object.keys(PROFILE_DEFAULTS)) {
      if (Object.hasOwn(incoming, key)) friend.profile[key] = incoming[key];
    }
    friend.profile.gender = ["여성", "남성", "설정하지 않음"].includes(friend.profile.gender)
      ? friend.profile.gender
      : "설정하지 않음";
    friend.profile.age = Math.max(
      0,
      Math.min(120, Math.round(Number(friend.profile.age || 0)))
    );
    friend.relationship.closeness = clampScore(
      incoming.closeness,
      friend.relationship.closeness
    );
    friend.relationship.trust = clampScore(
      incoming.trust,
      friend.relationship.trust
    );
    for (const key of Object.keys(APP_DEFAULTS)) {
      if (Object.hasOwn(incoming, key)) state.appSettings[key] = incoming[key];
    }
    state.appSettings = normalizeAppSettings(state.appSettings);
    state.appSettings.monthlyTokenLimit = Math.max(
      0,
      Number(state.appSettings.monthlyTokenLimit || 0)
    );
    state.appSettings.proactiveDailyTokenLimit = Math.max(
      0,
      Number(state.appSettings.proactiveDailyTokenLimit || 0)
    );
    state.appSettings.maxOutputTokens = Math.max(
      300,
      Math.min(2000, Number(state.appSettings.maxOutputTokens || 700))
    );
    for (const key of ["voiceModelId", "voiceSpeakerId"]) {
      friend.profile[key] = Math.max(0, Math.round(Number(friend.profile[key] || 0)));
    }
    friend.profile.voiceStyleWeight = Math.max(
      0,
      Math.min(20, Number(friend.profile.voiceStyleWeight || 1))
    );
    friend.profile.voiceLength = Math.max(
      0.5,
      Math.min(2, Number(friend.profile.voiceLength || 1))
    );
    if (!["quiet", "normal", "chatty"].includes(friend.profile.ambientVoiceFrequency)) {
      friend.profile.ambientVoiceFrequency = "normal";
    }
    friend.profile.ambientMaxConsecutive = Math.max(
      1,
      Math.min(5, Math.round(Number(friend.profile.ambientMaxConsecutive || 3)))
    );
    if (friend.profile.ambientVoiceEnabled) {
      friend.profile.proactiveEnabled = true;
      friend.profile.voiceEnabled = true;
      friend.profile.voiceAutoPlay = true;
    }
    if (
      liveConversationSession?.friendId === friend.id &&
      (!friend.profile.voiceEnabled || !friend.profile.voiceAutoPlay || state.appSettings.voiceMuted)
    ) {
      stopLiveConversation("voice_disabled");
    }
    pauseOrResumeNudge(friend, wasProactiveEnabled);
    const ambientEnabled = ambientVoiceActive(friend);
    if (ambientEnabled && (!wasAmbientEnabled || previousAmbientFrequency !== friend.profile.ambientVoiceFrequency)) {
      friend.ambientBurstCount = 0;
      friend.nextNudgeAt = new Date(Date.now() + initialNudgeDelayMs(ambientVoiceActive(friend))).toISOString();
    } else if (wasAmbientEnabled && !ambientEnabled) {
      friend.ambientBurstCount = 0;
      if (friend.profile.proactiveEnabled) {
        friend.nextNudgeAt = new Date(Date.now() + 6 * 3600000).toISOString();
      } else {
        friend.pausedNudgeRemainingMs = 6 * 3600000;
      }
    } else if (friend.profile.proactiveEnabled && !friend.nextNudgeAt) {
      friend.nextNudgeAt = new Date(Date.now() + initialNudgeDelayMs(ambientVoiceActive(friend))).toISOString();
    }
    syncLoginItemSettings(state.appSettings.launchAtLogin);
    state.appSettings.launchAtLogin = loginItemIsEnabled();
    updateTrayMenu();
    broadcast();
    return publicState();
  });
  ipcMain.handle("friend:create", (_event, profile) => {
    const friend = createFriend(profile);
    state.friends.push(friend);
    state.activeFriendId = friend.id;
    ensureRoomState(state, id);
    const directRoom = state.rooms.find(
      (room) => room.type === "direct" && room.participantIds[0] === friend.id
    );
    state.activeRoomId = directRoom.id;
    if (friend.profile.proactiveEnabled) {
      friend.nextNudgeAt = new Date(Date.now() + initialNudgeDelayMs(ambientVoiceActive(friend))).toISOString();
    } else {
      friend.pausedNudgeRemainingMs = 6 * 3600000;
    }
    updateTrayMenu();
    broadcast();
    return publicState();
  });
  ipcMain.handle("friend:select", (_event, friendId) => selectFriend(friendId));
  ipcMain.handle("room:select", (_event, roomId) => selectRoom(roomId));
  ipcMain.handle("room:create", (_event, incoming = {}) => {
    const participantIds = [...new Set(incoming.participantIds || [])]
      .filter((friendId) => friendById(friendId))
      .slice(0, 6);
    if (participantIds.length < 2) throw new Error("단톡에는 친구가 두 명 이상 필요해.");
    const room = normalizeRoom(
      {
        id: id(),
        type: "group",
        name: String(incoming.name || "새 단톡").trim() || "새 단톡",
        participantIds,
        autonomousEnabled: Boolean(incoming.autonomousEnabled),
        autonomousFrequency: incoming.autonomousFrequency,
        autonomousMaxTurns: incoming.autonomousMaxTurns
      },
      id
    );
    if (room.autonomousEnabled) {
      room.nextAutonomousAt = new Date(
        Date.now() + autonomousIntervalMs(room.autonomousFrequency)
      ).toISOString();
    }
    state.rooms.push(room);
    state.activeRoomId = room.id;
    state.activeFriendId = room.participantIds[0];
    updateTrayMenu();
    broadcast();
    return publicState();
  });
  ipcMain.handle("room:update", (_event, roomId, incoming = {}) => {
    const room = roomById(roomId);
    if (!room) return publicState();
    if (room.type !== "group") return publicState();
    const participantIds = [...new Set(incoming.participantIds || room.participantIds)]
      .filter((friendId) => friendById(friendId))
      .slice(0, 6);
    if (participantIds.length >= 2) room.participantIds = participantIds;
    room.pending = room.pending.filter((item) => room.participantIds.includes(item.senderId));
    if (typeof incoming.name === "string") {
      room.name = incoming.name.trim().slice(0, 40) || room.name;
    }
    const wasAutonomous = room.autonomousEnabled;
    const previousAutonomousFrequency = room.autonomousFrequency;
    if (Object.hasOwn(incoming, "autonomousEnabled")) {
      room.autonomousEnabled = Boolean(incoming.autonomousEnabled);
    }
    if (["quiet", "normal", "chatty"].includes(incoming.autonomousFrequency)) {
      room.autonomousFrequency = incoming.autonomousFrequency;
    }
    if (Object.hasOwn(incoming, "autonomousMaxTurns")) {
      room.autonomousMaxTurns = Math.max(
        1,
        Math.min(20, Math.round(Number(incoming.autonomousMaxTurns || room.autonomousMaxTurns || 6)))
      );
    }
    if (
      room.autonomousEnabled &&
      (!wasAutonomous ||
        previousAutonomousFrequency !== room.autonomousFrequency ||
        !room.nextAutonomousAt)
    ) {
      room.autonomousTurnCount = 0;
      room.nextAutonomousAt = new Date(
        Date.now() + autonomousIntervalMs(room.autonomousFrequency)
      ).toISOString();
    } else if (!room.autonomousEnabled) {
      clearTimeout(roomTurnTimers.get(room.id));
      roomTurnTimers.delete(room.id);
      abortRoomGenerations(room.id);
      room.pending = room.pending.filter((item) => item.source !== "autonomous");
      room.nextAutonomousAt = null;
      room.autonomousTurnCount = 0;
    }
    updateTrayMenu();
    broadcast();
    return publicState();
  });
  ipcMain.handle("room:delete", (_event, roomId) => {
    const room = roomById(roomId);
    if (!room || room.type !== "group") return publicState();
    clearTimeout(roomTurnTimers.get(roomId));
    roomTurnTimers.delete(roomId);
    abortRoomGenerations(roomId);
    state.rooms = state.rooms.filter((candidate) => candidate.id !== roomId);
    if (state.activeRoomId === roomId) state.activeRoomId = state.rooms[0]?.id || null;
    updateTrayMenu();
    broadcast();
    return publicState();
  });
  ipcMain.handle("friend:delete", (_event, friendId) => {
    if (state.friends.length <= 1) return publicState();
    const index = state.friends.findIndex((friend) => friend.id === friendId);
    if (index < 0) return publicState();
    if (liveConversationSession?.friendId === friendId) stopLiveConversation("friend_deleted");
    clearTimeout(replyTimers.get(friendId));
    abortGeneration(friendId);
    replyTimers.delete(friendId);
    replyPending.delete(friendId);
    conversationRevisions.delete(friendId);
    for (const [roomId, timeout] of roomTurnTimers.entries()) {
      clearTimeout(timeout);
      roomTurnTimers.delete(roomId);
    }
    state.friends.splice(index, 1);
    state.rooms = state.rooms
      .map((room) => ({
        ...room,
        participantIds: room.participantIds.filter((participantId) => participantId !== friendId)
      }))
      .filter((room) => room.type === "direct" ? room.participantIds.length === 1 : room.participantIds.length >= 2);
    ensureRoomState(state, id);
    if (!roomById(state.activeRoomId)) state.activeRoomId = state.rooms[0]?.id || null;
    state.activeFriendId = activeRoom()?.participantIds?.[0] || state.friends[0].id;
    updateTrayMenu();
    broadcast();
    return publicState();
  });
  ipcMain.handle("message:send", (_event, payload) => {
    const input = typeof payload === "string" ? { text: payload } : payload || {};
    const clean = String(input.text || "").trim().slice(0, 2000);
    if (!clean) return publicState();
    const room = activeRoom();
    const friend = activeConversationContext();
    friend.ambientBurstCount = 0;
    if (room.type === "group") abortRoomGenerations(room.id);
    else abortGeneration(friend.id);
    bumpRevision(room.type === "group" ? room.id : friend.id);
    friend.pending = friend.pending.filter((item) => item.proactive && !item.ambient);
    const replyToId = friend.messages.some((message) => message.id === input.replyToId)
      ? input.replyToId
      : null;
    const userMessage = addMessage(friend, "user", clean, false, { replyToId });
    if (liveConversationSession?.roomId === room.id) {
      clearTimeout(liveConversationTimer);
      liveConversationTimer = null;
      liveConversationSession.status = "waiting_for_reply";
      liveConversationSession.nextTurnAt = null;
      liveConversationSession.unansweredTurns = 0;
      liveConversationSession.lastObservedUserMessageId = userMessage?.id || null;
    }
    room.autonomousTurnCount = 0;
    broadcast();
    if (room.type === "group") {
      room.groupRepliesRemaining = Math.min(room.participantIds.length - 1, 1);
      scheduleRoomTurn(room, replyBatchDelayMs(friend.profile), "group_reply");
    } else {
      replyPending.add(friend.id);
      scheduleReplyGeneration(friend.id);
    }
    return publicState();
  });
  ipcMain.handle("message:react", (_event, messageId, reaction) => {
    const friend = activeConversationContext();
    const message = activeRoom().messages.find((candidate) => candidate.id === messageId);
    if (!message || !["heart", "laugh", "like"].includes(reaction)) return publicState();
    message.reactions ||= {};
    message.reactions[reaction] = !message.reactions[reaction];
    broadcast();
    return publicState();
  });
  ipcMain.handle("message:update", (_event, messageId, text) => {
    if (!state.appSettings.messageHistoryEditingEnabled) {
      throw new Error("앱 설정에서 대화 기록 수정·삭제를 먼저 허용해줘.");
    }
    const room = activeRoom();
    const friend = activeConversationContext();
    const message = room.messages.find((candidate) => candidate.id === messageId);
    if (!message) return publicState();
    const clean = cleanMessageText(text);
    if (!clean) throw new Error("수정할 메시지 내용을 입력해줘.");
    const oldVoicePath = cachedVoicePathForMessage(room, message);
    prepareMessageHistoryMutation(room, friend);
    editMessageRecord(room, friend, messageId, clean);
    removeCachedVoice(oldVoicePath);
    broadcast();
    return publicState();
  });
  ipcMain.handle("message:delete", (_event, messageId) => {
    if (!state.appSettings.messageHistoryEditingEnabled) {
      throw new Error("앱 설정에서 대화 기록 수정·삭제를 먼저 허용해줘.");
    }
    const room = activeRoom();
    const friend = activeConversationContext();
    const message = room.messages.find((candidate) => candidate.id === messageId);
    if (!message) return publicState();
    const oldVoicePath = cachedVoicePathForMessage(room, message);
    prepareMessageHistoryMutation(room, friend);
    deleteMessageRecord(room, friend, messageId);
    removeCachedVoice(oldVoicePath);
    broadcast();
    return publicState();
  });
  ipcMain.handle("message:retry", () => {
    const room = activeRoom();
    const friend = activeConversationContext();
    const mode = friend.error?.mode || "reactive";
    friend.error = null;
    if (room.type === "group") {
      scheduleRoomTurn(room, 100, mode === "proactive" ? "autonomous" : "group_reply");
    } else if (mode === "proactive") {
      generateReply("proactive", true, null, friend.id, "retry");
    } else {
      const latest = friend.messages[friend.messages.length - 1];
      if (latest?.role === "user") {
        replyPending.add(friend.id);
        scheduleReplyGeneration(friend.id, 100);
      }
    }
    broadcast();
    return publicState();
  });
  ipcMain.handle("memory:create", (_event, incoming = {}) => {
    const friend = activeFriend();
    const memory = normalizeMemory(
      {
        category: incoming.category,
        text: incoming.text,
        pinned: Boolean(incoming.pinned),
        sourceMessageId: null
      },
      id
    );
    if (!memory) throw new Error("추가할 기억 내용을 입력해줘.");
    friend.memories = [...friend.memories, memory].slice(-80);
    broadcast();
    return publicState();
  });
  ipcMain.handle("memory:update", (_event, memoryId, changes) => {
    const friend = activeFriend();
    const index = friend.memories.findIndex((memory) => memory.id === memoryId);
    if (index < 0) return publicState();
    const updated = normalizeMemory(
      {
        ...friend.memories[index],
        ...(Object.hasOwn(changes || {}, "text") ? { text: changes.text } : {}),
        ...(Object.hasOwn(changes || {}, "text") ? { sourceMessageId: null } : {}),
        ...(Object.hasOwn(changes || {}, "category") ? { category: changes.category } : {}),
        ...(Object.hasOwn(changes || {}, "pinned")
          ? { pinned: Boolean(changes.pinned) }
          : {}),
        id: memoryId,
        updatedAt: new Date().toISOString()
      },
      id
    );
    if (!updated) throw new Error("기억 내용은 비워둘 수 없어.");
    friend.memories[index] = updated;
    broadcast();
    return publicState();
  });
  ipcMain.handle("memory:delete", (_event, memoryId) => {
    const friend = activeFriend();
    friend.memories = friend.memories.filter((memory) => memory.id !== memoryId);
    broadcast();
    return publicState();
  });
  ipcMain.handle("nudge:trigger", async () => {
    const room = activeRoom();
    const speaker = room.type === "group" ? chooseNextSpeaker(room, state.friends) : activeFriend();
    const friend = contextForRoom(room, speaker);
    logConversationEvent("nudge_test_requested", friend, {
      mode: ambientVoiceActive(friend) ? "ambient" : "proactive",
      pendingCount: friend.pending.length,
      generationInFlight: generationInFlight.has(friend.id)
    });
    let reason = null;
    if (room.type === "direct" && !friend.profile.proactiveEnabled) reason = "선톡이 꺼져 있어.";
    else if (friend.pending.length) reason = "이미 전달을 기다리는 메시지가 있어.";
    else if (generationInFlight.has(friend.id)) reason = "이미 답장을 만들고 있어.";
    else if (proactiveGenerationInFlight) reason = "다른 친구의 선톡을 먼저 만들고 있어.";
    else reason = tokenBudgetBlock("proactive");
    if (reason) {
      logConversationEvent("nudge_test_blocked", friend, { reason });
      return { state: publicState(), status: "blocked", message: reason };
    }
    const accepted = await generateReply("proactive", true, null, friend.id, "test", friend);
    const failed = friend.error?.mode === "proactive";
    const status = failed ? "failed" : accepted && friend.pending.length ? "queued" : "not_queued";
    const message = failed
      ? friend.error.message
      : status === "queued"
        ? room.type === "group"
          ? "단톡 메시지를 만들었어. 잠시 후 전달할게."
          : ambientVoiceActive(friend)
          ? "상시 음성 발화를 만들었어. 음성 준비 후 재생할게."
          : "선톡을 만들었어. 잠시 후 전달할게."
        : "이번에는 보낼 메시지를 만들지 못했어.";
    logConversationEvent("nudge_test_finished", friend, {
      status,
      pendingCount: friend.pending.length
    });
    return { state: publicState(), status, message };
  });
  ipcMain.handle("events:diagnostics:open", () => {
    const target = appendEventDiagnostic(app.getPath("userData"), { event: "log_opened" });
    shell.showItemInFolder(target || eventDiagnosticPath(app.getPath("userData")));
    return target;
  });
  ipcMain.handle("conversation:clear", () => {
    const room = activeRoom();
    if (liveConversationSession?.roomId === room.id) stopLiveConversation("conversation_cleared");
    const friend = activeConversationContext();
    if (room.type === "group") abortRoomGenerations(room.id);
    else abortGeneration(friend.id);
    bumpRevision(room.type === "group" ? room.id : friend.id);
    replyPending.delete(friend.id);
    clearTimeout(replyTimers.get(friend.id));
    clearTimeout(typingExpiryTimer);
    userIsTyping = false;
    friend.messages = [];
    if (room.type === "direct") friend.memories = [];
    friend.pending = [];
    friend.error = null;
    friend.ambientBurstCount = 0;
    friend.nudgeStatus = null;
    if (room.type === "direct") friend.relationship.mood = "평범함";
    room.groupRepliesRemaining = 0;
    room.autonomousTurnCount = 0;
    if (room.autonomousEnabled) scheduleNextAutonomousTurn(room);
    if (room.type === "direct") {
      friend.nextNudgeAt = friend.profile.proactiveEnabled
        ? new Date(Date.now() + initialNudgeDelayMs(ambientVoiceActive(friend))).toISOString()
        : null;
      friend.pausedNudgeRemainingMs = friend.profile.proactiveEnabled ? 0 : 6 * 3600000;
    }
    broadcast();
    return publicState();
  });
  ipcMain.handle("backup:export", async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "HER 백업 내보내기",
      defaultPath: `HER-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON 백업", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    atomicWriteJson(result.filePath, state);
    return { canceled: false, filePath: result.filePath };
  });
  ipcMain.handle("backup:import", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "HER 백업 불러오기",
      properties: ["openFile"],
      filters: [{ name: "JSON 백업", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePaths[0]) return publicState();
    stopLiveConversation("backup_imported");
    const loaded = JSON.parse(fs.readFileSync(result.filePaths[0], "utf8"));
    const importedState = modernStateFromLoaded(loaded, id);
    for (const controller of requestControllers.values()) controller.abort();
    for (const timeout of replyTimers.values()) clearTimeout(timeout);
    for (const timeout of roomTurnTimers.values()) clearTimeout(timeout);
    replyTimers.clear();
    roomTurnTimers.clear();
    replyPending.clear();
    conversationRevisions.clear();
    state = ensureRoomState(importedState, id);
    state.version = STATE_VERSION;
    saveState();
    updateTrayMenu();
    broadcast();
    return publicState();
  });
  ipcMain.handle("window:minimize", () => mainWindow.minimize());
  ipcMain.handle("window:close", () => mainWindow.close());
});

app.on("before-quit", () => {
  isQuitting = true;
  clearTimeout(liveConversationTimer);
  if (state) saveState();
});

app.on("activate", showMainWindow);

app.on("window-all-closed", () => {
  if (state?.appSettings.keepInTray !== false) return;
  clearInterval(scheduler);
  if (process.platform !== "darwin") {
    isQuitting = true;
    app.quit();
  }
});
