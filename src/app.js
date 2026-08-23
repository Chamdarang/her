const $ = (selector) => document.querySelector(selector);

const refs = {
  messageList: $("#messageList"),
  emptyState: $("#emptyState"),
  typing: $("#typingIndicator"),
  input: $("#messageInput"),
  composer: $("#composer"),
  roomList: $("#roomList"),
  friendModal: $("#modalBackdrop"),
  friendForm: $("#settingsForm"),
  groupModal: $("#groupModalBackdrop"),
  groupForm: $("#groupSettingsForm"),
  appModal: $("#appModalBackdrop"),
  appForm: $("#appSettingsForm"),
  memoryModal: $("#memoryModalBackdrop"),
  memoryCreateForm: $("#memoryCreateForm"),
  memoryList: $("#memoryList")
};

let state;
let thinking = false;
let exampleIndex = 0;
let creatingFriend = false;
let creatingGroup = false;
let replyToId = null;
let editingMessageId = null;
let draftBeforeEdit = "";
let renderedFriendId = null;
let lastRenderedMessageId = null;
let lastMessageRenderKey = "";
let lastRoomRenderKey = "";
let searchQuery = "";
let composerFocusRetry;
let voiceModels = [];
let playingVoiceId = null;
let voicePlaybackGeneration = 0;
let previewVoiceActive = false;
let activeModalTrigger = null;
let toastTimer;
let sendingMessage = false;
let nudgeTestInFlight = false;
let clearConfirmationTimer;
let lastSeenLiveStopAt = null;
const loadingVoiceIds = new Set();
const chatScroller = new window.ChatScrollController(refs.messageList, $("#newMessageButton"));
const voicePlayer = new window.NormalizedVoicePlayer();
const autoVoiceQueue = new window.SequentialAudioQueue(async (messageId) => {
  await playVoice(messageId, true);
  await new Promise((resolve) => setTimeout(resolve, 220));
});
const autoVoiceBatchMeta = new Map();
const queuedAutoVoiceIds = new Set();
let currentVoiceStartedAt = 0;

function reportVoicePlayback(event, messageId, details = {}) {
  window.her.reportVoicePlayback({ event, messageId, ...details }).catch(() => {});
}

function clearAutoVoiceQueue() {
  autoVoiceQueue.clear();
  for (const messageId of autoVoiceBatchMeta.keys()) {
    if (messageId !== playingVoiceId) {
      autoVoiceBatchMeta.delete(messageId);
      queuedAutoVoiceIds.delete(messageId);
    }
  }
}

function enqueueAutoVoice(delivery) {
  const messageId = delivery?.messageId || delivery?.id;
  if (!messageId || delivery?.voiceError || queuedAutoVoiceIds.has(messageId)) return;
  const meta = {
    batchId: delivery.replyBatchId || delivery.batchId || `auto-${messageId}`,
    batchIndex: Number(delivery.replyBatchIndex || delivery.batchIndex || 1),
    batchTotal: Number(delivery.replyBatchTotal || delivery.batchTotal || 1),
    friendId: delivery.friendId || state?.activeFriendId || null,
    friendName: delivery.friendName || state?.settings?.name || null,
    ambient: Boolean(delivery.ambient)
  };
  queuedAutoVoiceIds.add(messageId);
  autoVoiceBatchMeta.set(messageId, meta);
  reportVoicePlayback("playback_queued", messageId, meta);
  autoVoiceQueue.enqueue(messageId);
}

const { CHARACTER_EXAMPLES } = window.HerSettingsData;
const chatView = window.HerChatView;
const {
  createSettingsUi,
  FRIEND_SETTING_KEYS,
  matchingPreset
} = window.HerSettingsUi;
const settingsUi = createSettingsUi({
  friendForm: refs.friendForm,
  groupForm: refs.groupForm,
  query: $
});
const {
  applyPreset,
  markSelectedPreset,
  readDiscreteValue,
  setDiscreteValue,
  updateGroupAutonomyControls,
  updateGroupParticipantCount,
  updateProactiveControls,
  updateSliderLabels,
  updateVoiceSettingSummary
} = settingsUi;

function initials(name) {
  return (name || "?").trim().slice(0, 1);
}

function formatTime(iso) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(iso));
}

function approximateTimeUntil(iso) {
  if (!iso) return "";
  const minutes = Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60000));
  if (minutes <= 1) return "곧";
  if (minutes < 60) return `약 ${minutes}분 후`;
  const hours = Math.max(1, Math.round(minutes / 60));
  return hours < 24 ? `약 ${hours}시간 후` : `약 ${Math.round(hours / 24)}일 후`;
}

function formatNudgeStatus(status, nextNudgeAt) {
  if (state.room?.type !== "group" && !state.settings.proactiveEnabled) return "";
  const next = approximateTimeUntil(status?.nextAt || nextNudgeAt);
  const labels = {
    generating: "선톡 만드는 중",
    preparing_voice: "선톡 음성 준비 중",
    waiting_delivery: next ? `선톡 전달 대기 · ${next}` : "선톡 전달 대기",
    quiet_hours: next ? `방해 금지로 보류 · ${next}` : "방해 금지로 보류",
    resume_deferred: next ? `PC 복귀 후 잠시 보류 · ${next}` : "PC 복귀 후 잠시 보류",
    failed: next ? `최근 선톡 실패 · 재시도 ${next}` : "최근 선톡 실패",
    blocked: next ? `토큰 한도로 보류 · ${next}` : "토큰 한도로 보류",
    delivered: status?.deliveredAt ? `최근 선톡 ${formatTime(status.deliveredAt)}` : "선톡 전달됨"
  };
  if (status?.state === "deferred") {
    if (status.reason === "unanswered") return next ? `답을 기다리는 중 · 다음 확인 ${next}` : "답을 기다리는 중";
    if (status.reason === "daily_limit") return "오늘 선톡 횟수를 채웠어";
    return next ? `다음 선톡 기회 ${next}` : "다음 선톡 기회를 기다리는 중";
  }
  return labels[status?.state] || (next ? `다음 선톡 예상 ${next}` : "");
}

function formatLiveConversationStatus(liveConversation) {
  if (!liveConversation?.active || liveConversation.roomId !== state.activeRoomId) return "";
  const labels = {
    starting: "통화형 대화 시작 중",
    generating: "통화형 대화 · 다음 말을 생각하는 중",
    preparing_voice: "통화형 대화 · 음성 준비 중",
    speaking: "통화형 대화 · 말하는 중",
    typing: "통화형 대화 · 입력을 기다리는 중",
    waiting_for_reply: "통화형 대화 · 답장 준비를 기다리는 중"
  };
  if (liveConversation.status === "waiting" && liveConversation.nextTurnAt) {
    return "통화형 대화 · 잠시 침묵을 기다리는 중";
  }
  return labels[liveConversation.status] || "통화형 대화 중";
}

function periodKeys(value = Date.now()) {
  const date = new Date(value);
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
  return { day, month: day.slice(0, 7) };
}

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(Number(value || 0));
}

function compactNumber(value) {
  const number = Number(value || 0);
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
  return String(number);
}

function formatUsd(value) {
  const amount = Number(value || 0);
  return `$${amount < 0.01 ? amount.toFixed(4) : amount.toFixed(2)}`;
}

function friendlyError(error, fallback) {
  const message = String(error?.message || error || "");
  const detail = message.replace(/^Error invoking remote method '[^']+':\s*/i, "").trim();
  return detail || fallback;
}

function showToast(message, type = "") {
  const toast = $("#toast");
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast ${type}`.trim();
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 4200);
}

function resetClearConfirmation() {
  clearTimeout(clearConfirmationTimer);
  clearConfirmationTimer = null;
  const button = $("#clearButton");
  button.dataset.confirming = "false";
  button.textContent = "대화·기억 초기화";
}

function focusableElements(backdrop) {
  return [...backdrop.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((element) => element.offsetParent !== null);
}

function openModal(backdrop, preferredFocus) {
  activeModalTrigger = document.activeElement;
  backdrop.classList.remove("hidden");
  backdrop.setAttribute("aria-hidden", "false");
  setAppShellInert(true);
  requestAnimationFrame(() => {
    const target = preferredFocus || focusableElements(backdrop)[0];
    target?.focus({ preventScroll: true });
  });
}

function setAppShellInert(inert) {
  const appShell = $(".app-shell");
  appShell.inert = inert;
  if (inert) appShell.setAttribute("inert", "");
  else appShell.removeAttribute("inert");
}

function closeModal(backdrop, options = {}) {
  backdrop.classList.add("hidden");
  backdrop.setAttribute("aria-hidden", "true");
  setAppShellInert(false);
  const target = options.restoreFocusTo ||
    (activeModalTrigger?.isConnected ? activeModalTrigger : refs.input);
  activeModalTrigger = null;
  requestAnimationFrame(() => target?.focus({ preventScroll: true }));
}

function renderUsage() {
  const usage = state.usage || {};
  $("#usageDisplay").textContent = compactNumber(usage.totalTokens);
  $("#usageTotal").textContent = formatNumber(usage.totalTokens);
  $("#usageInput").textContent = formatNumber(usage.totalInputTokens);
  $("#usageOutput").textContent = formatNumber(usage.totalOutputTokens);
  $("#usageRequests").textContent = formatNumber(usage.requestCount);
  $("#usageCost").textContent = formatUsd(usage.estimatedCostUsd);
  $("#usageModeNote").textContent = state.settings.hasApiKey
    ? "토큰 한도와 예상 요금은 OpenAI 사용량에만 적용해."
    : "API 키가 없으면 OpenAI 사용량은 늘지 않아.";

  if (usage.last) {
    $("#usageLast").textContent =
      `최근 ${usage.last.model} · 입력 ${formatNumber(usage.last.inputTokens)} · ` +
      `출력 ${formatNumber(usage.last.outputTokens)} · 전체 ${formatNumber(usage.last.totalTokens)}` +
      (usage.last.estimatedCostUsd != null
        ? ` · 최근 요청 예상 ${formatUsd(usage.last.estimatedCostUsd)}`
        : "");
  } else {
    $("#usageLast").textContent = "아직 실제 API 요청 기록이 없어.";
  }

  const { day, month } = periodKeys();
  const monthTokens = usage.byMonth?.[month]?.totalTokens || 0;
  const proactiveToday = usage.byDay?.[day]?.proactiveTokens || 0;
  const friendTokens = usage.byFriend?.[state.activeFriendId]?.totalTokens || 0;
  $("#usagePeriod").textContent =
    `이번 달 ${formatNumber(monthTokens)} · 오늘 자동 대화 ${formatNumber(proactiveToday)} · ` +
    `${state.settings.name} ${formatNumber(friendTokens)}`;

  const details = [];
  if (usage.totalCachedTokens) {
    details.push(`누적 캐시 입력 ${formatNumber(usage.totalCachedTokens)}`);
  }
  if (usage.totalCacheWriteTokens) {
    details.push(`누적 캐시 쓰기 ${formatNumber(usage.totalCacheWriteTokens)}`);
  }
  if (usage.totalReasoningTokens) {
    details.push(`누적 추론 ${formatNumber(usage.totalReasoningTokens)}`);
  }
  $("#usageDetails").textContent = details.join(" · ");

}

function renderMessages() {
  const messages = (state.messages || []).filter((message) => !message.hiddenFromChat);
  const nextRenderKey = chatView.messageRenderKey({
    activeRoomId: state.activeRoomId,
    searchQuery,
    messages,
    loadingVoiceIds,
    playingVoiceId,
    historyEditingEnabled: Boolean(state.settings.messageHistoryEditingEnabled)
  });
  if (nextRenderKey === lastMessageRenderKey) return;
  lastMessageRenderKey = nextRenderKey;
  const list = refs.messageList;
  const nextLastId = messages[messages.length - 1]?.id || null;
  const friendChanged = renderedFriendId !== state.activeRoomId;
  const newMessageArrived = lastRenderedMessageId && nextLastId !== lastRenderedMessageId;
  const scrollSnapshot = chatScroller.beforeRender({ friendChanged, newMessageArrived });
  refs.emptyState.classList.toggle("hidden", messages.length > 0);
  list.classList.toggle("hidden", messages.length === 0);

  const rendered = chatView.renderMessagesHtml({
    messages,
    searchQuery,
    friendName: state.settings.name,
    loadingVoiceIds,
    playingVoiceId,
    historyEditingEnabled: Boolean(state.settings.messageHistoryEditingEnabled)
  });
  list.innerHTML = rendered.html;
  $("#searchCount").textContent = `${rendered.visibleMatches}개`;

  chatScroller.afterRender(scrollSnapshot);
  renderedFriendId = state.activeRoomId;
  lastRenderedMessageId = nextLastId;
}

function renderRooms() {
  const nextRenderKey = JSON.stringify({
    activeRoomId: state.activeRoomId,
    rooms: state.rooms
  });
  if (nextRenderKey === lastRoomRenderKey) return;
  lastRoomRenderKey = nextRenderKey;
  refs.roomList.innerHTML = chatView.renderRoomsHtml(state.rooms, state.activeRoomId);
}

function render() {
  if (!state) return;
  const { settings } = state;
  const name = state.room?.name || settings.name;
  const avatar = initials(name);
  $("#chatName").textContent = name;
  $("#emptyName").textContent = name;
  $("#emptyAvatar").textContent = avatar;
  $("#genderLabel").textContent = state.room?.type === "group"
    ? `${state.room.participantNames.length}명 단톡`
    : [settings.gender, Number(settings.age) > 0 ? `${settings.age}세` : null]
        .filter(Boolean)
        .join(" · ");
  $("#memoryButton").textContent = `기억 ${state.memories?.length || 0}`;
  $("#memoryButton").classList.toggle("hidden", state.room?.type === "group");
  $("#settingsButton").setAttribute(
    "aria-label",
    state.room?.type === "group" ? "단톡 설정" : "친구 설정"
  );
  $("#settingsButton").title = state.room?.type === "group" ? "단톡 설정" : "친구 설정";
  $("#settingsButton").textContent =
    state.room?.type === "group" ? "단톡 설정" : "친구 설정";

  $("#presenceText").textContent = state.pending?.length
    ? "답장하는 중"
    : state.room?.type === "group" && state.room.autonomousEnabled
      ? "친구들끼리 대화 중"
    : state.room?.type === "group"
      ? "대화 쉬는 중"
    : settings.ambientVoiceEnabled
      ? "자동 음성 말걸기 켜짐"
    : settings.proactiveEnabled
      ? "자기 할 일 하는 중"
      : "선톡 쉬는 중";
  $("#nudgeStatus").textContent = formatNudgeStatus(state.nudgeStatus, state.nextNudgeAt);
  const liveConversationActive =
    state.liveConversation?.active && state.liveConversation.roomId === state.activeRoomId;
  const liveConversationStatus = formatLiveConversationStatus(state.liveConversation);
  $("#liveConversationButton").classList.toggle("hidden", state.room?.type === "group");
  $("#liveConversationButton").classList.toggle("active", liveConversationActive);
  $("#liveConversationButton").textContent = liveConversationActive ? "통화 종료" : "통화 시작";
  $("#liveConversationButton").setAttribute("aria-pressed", String(Boolean(liveConversationActive)));
  $("#liveConversationStatus").textContent = liveConversationStatus;
  $("#liveConversationStatus").classList.toggle("hidden", !liveConversationStatus);
  const voiceStatus = state.voiceSynthesisStatus;
  $("#voiceSynthesisStatus").textContent = voiceStatus
    ? `${voiceStatus.friendName ? `${voiceStatus.friendName} · ` : ""}음성 합성 중… 답장은 준비되면 표시돼.`
    : "";
  $("#voiceSynthesisStatus").classList.toggle("hidden", !voiceStatus);
  const nudgeAllowed = state.room?.type === "group" || settings.proactiveEnabled;
  $("#testNudgeButton").disabled = !nudgeAllowed || nudgeTestInFlight;
  if (!nudgeTestInFlight) {
    $("#testNudgeButton").textContent =
      state.room?.type === "group" ? "대화 테스트" : "선톡 테스트";
  }
  $("#testNudgeButton").title = nudgeAllowed
    ? state.room?.type === "group"
      ? "기다리지 않고 단톡 대화 동작 확인"
      : "기다리지 않고 선톡 동작 확인"
    : "친구 설정에서 선톡을 먼저 켜야 해";
  refs.typing.classList.toggle("hidden", !thinking);
  const offline = !navigator.onLine;
  const error = state.error;
  $("#errorBanner").classList.toggle("hidden", !offline && !error);
  $("#errorMessage").textContent = offline
    ? "인터넷 연결이 끊겼어."
    : error?.message || "";
  $("#errorDetail").textContent = offline
    ? "연결되면 다시 시도할 수 있어."
    : error?.detail || "";
  $("#retryButton").classList.toggle("hidden", offline || !error?.retryable);
  renderRooms();
  renderUsage();
  renderMessages();
}

function fillForm(form, keys) {
  for (const key of keys) {
    const input = form.elements[key];
    if (!input) continue;
    const value = state.settings[key];
    if (input.type === "checkbox") input.checked = Boolean(value);
    else if (form === refs.friendForm && input.dataset.discreteSetting) {
      setDiscreteValue(key, value, true);
    }
    else input.value = value ?? "";
  }
}

function updateAmbientVoiceControls(fromUser = false) {
  const form = refs.friendForm.elements;
  const enabled = form.ambientVoiceEnabled.checked;
  $("#ambientVoiceOptions").classList.toggle("hidden", !enabled);
  form.ambientMaxConsecutive.readOnly = !form.ambientContinueUnanswered.checked;
  if (enabled && fromUser) {
    form.proactiveEnabled.checked = true;
    form.voiceEnabled.checked = true;
    form.voiceAutoPlay.checked = true;
  }
  updateProactiveControls();
  updateVoiceSettingSummary();
}

function updateVoiceSelectors() {
  const form = refs.friendForm.elements;
  const modelId = Number(form.voiceModelId.value || state?.settings?.voiceModelId || 0);
  const model = voiceModels.find((item) => item.id === modelId) || voiceModels[0];
  if (!model) return;
  form.voiceModelId.innerHTML = voiceModels
    .map((item) => `<option value="${item.id}" ${item.id === model.id ? "selected" : ""}>${escapeHtml(item.displayName || item.name)}</option>`)
    .join("");
  form.voiceSpeakerId.value = model.speakers[0]?.id ?? 0;
  const savedStyle = form.voiceStyle.value || state?.settings?.voiceStyle || "Neutral";
  form.voiceStyle.innerHTML = (model.styles.length ? model.styles : ["Neutral"])
    .map((style) => `<option value="${escapeHtml(style)}" ${style === savedStyle ? "selected" : ""}>${escapeHtml(model.styleLabels?.[style] || style)}</option>`)
    .join("");
}

async function loadVoiceModels() {
  const status = $("#voiceConnectionStatus");
  status.className = "";
  status.textContent = "로컬 서버에 연결하는 중…";
  try {
    voiceModels = await window.her.getVoiceModels();
    updateVoiceSelectors();
    status.className = "success";
    status.textContent = `${voiceModels.length}개 모델 연결됨`;
  } catch (error) {
    status.className = "error";
    status.textContent = error.message || "SBV2 서버에 연결하지 못했어.";
  }
}

async function previewSelectedVoice() {
  const button = $("#previewVoiceButton");
  const status = $("#voiceConnectionStatus");
  const form = refs.friendForm.elements;
  button.disabled = true;
  status.className = "";
  status.textContent = "미리듣기 음성을 만드는 중…";
  clearAutoVoiceQueue();
  stopVoiceAudio();
  const previewGeneration = voicePlaybackGeneration;
  previewVoiceActive = true;
  try {
    const result = await window.her.previewVoice({
      voiceModelId: Number(form.voiceModelId.value),
      voiceSpeakerId: Number(form.voiceSpeakerId.value),
      voiceStyle: form.voiceStyle.value,
      voiceStyleWeight: Number(form.voiceStyleWeight.value),
      voiceLength: Number(form.voiceLength.value)
    });
    if (previewGeneration !== voicePlaybackGeneration) return;
    status.className = "success";
    status.textContent = "미리듣기 재생 중 · 「こんにちは。今日は何してたの？」";
    await voicePlayer.play(result);
    if (previewGeneration !== voicePlaybackGeneration) return;
    status.textContent = "미리듣기 완료";
  } catch (error) {
    status.className = "error";
    status.textContent = friendlyError(error, "미리듣기에 실패했어.");
  } finally {
    previewVoiceActive = false;
    button.disabled = false;
  }
}

function openFriendSettings(createNew = false) {
  resetClearConfirmation();
  creatingFriend = createNew;
  if (creatingFriend) {
    applyPreset("casual_female");
    refs.friendForm.elements.name.value = "새 친구";
    refs.friendForm.elements.age.value = "";
    setDiscreteValue("closeness", 50);
    setDiscreteValue("trust", 50);
    refs.friendForm.elements.proactiveEnabled.checked = true;
    refs.friendForm.elements.voiceEnabled.checked = false;
    refs.friendForm.elements.voiceAutoPlay.checked = false;
    refs.friendForm.elements.voiceRevealAfterSynthesis.checked = false;
    refs.friendForm.elements.ambientVoiceEnabled.checked = false;
    refs.friendForm.elements.ambientVoiceFrequency.value = "normal";
    refs.friendForm.elements.ambientContinueUnanswered.checked = true;
    refs.friendForm.elements.ambientMaxConsecutive.value = 3;
    refs.friendForm.elements.ambientSaveTranscript.checked = true;
    markSelectedPreset(null);
  } else {
    fillForm(refs.friendForm, FRIEND_SETTING_KEYS);
    setDiscreteValue("closeness", state.relationship.closeness, true);
    setDiscreteValue("trust", state.relationship.trust, true);
    markSelectedPreset(matchingPreset(state.settings));
  }
  $("#settingsTitle").textContent = creatingFriend ? "새 친구 만들기" : "친구 설정";
  $("#friendSettingsDescription").textContent = creatingFriend
    ? "친구를 만들면 그 친구와의 1:1 대화방도 함께 생겨."
    : "친구의 성격과 이 친구와의 1:1 대화 설정을 바꿔.";
  refs.friendForm.querySelector('button[type="submit"]').textContent = creatingFriend
    ? "친구 추가"
    : "친구 저장";
  $("#deleteFriendButton").classList.toggle("hidden", creatingFriend || state.friends.length <= 1);
  $("#clearButton").classList.toggle("hidden", creatingFriend);
  updateSliderLabels();
  updateAmbientVoiceControls();
  openModal(refs.friendModal, refs.friendForm.elements.name);
  if (!creatingFriend && state.settings.voiceEnabled) loadVoiceModels();
}

function closeFriendSettings(options = {}) {
  if (previewVoiceActive) stopVoiceAudio();
  previewVoiceActive = false;
  closeModal(refs.friendModal, options);
}

function renderGroupParticipants(selectedIds = []) {
  const selected = new Set(selectedIds);
  $("#groupParticipantList").innerHTML = state.friends
    .map((friend) => `
      <label class="participant-option">
        <input type="checkbox" name="participantIds" value="${escapeHtml(friend.id)}" ${selected.has(friend.id) ? "checked" : ""} />
        <span class="avatar">${escapeHtml(initials(friend.name))}</span>
        <span><b>${escapeHtml(friend.name)}</b><small>${escapeHtml([
          friend.gender,
          Number(friend.age) > 0 ? `${friend.age}세` : null
        ].filter(Boolean).join(" · "))}</small></span>
      </label>
    `)
    .join("");
  updateGroupParticipantCount();
}

function openGroupSettings(createNew = false) {
  if (state.friends.length < 2) {
    showToast("단톡을 만들려면 친구가 두 명 이상 필요해.", "error");
    return;
  }
  creatingGroup = createNew;
  const room = createNew ? null : state.room;
  if (!createNew && room?.type !== "group") return;
  refs.groupForm.elements.name.value = room?.name || "";
  refs.groupForm.elements.autonomousEnabled.checked = Boolean(room?.autonomousEnabled);
  refs.groupForm.elements.autonomousFrequency.value = room?.autonomousFrequency || "normal";
  refs.groupForm.elements.autonomousMaxTurns.value = room?.autonomousMaxTurns || 6;
  renderGroupParticipants(
    room?.participantIds || state.friends.slice(0, 2).map((friend) => friend.id)
  );
  updateGroupAutonomyControls();
  $("#groupAutonomyDisclosure").open = Boolean(room?.autonomousEnabled);
  $("#deleteGroupButton").classList.toggle("hidden", createNew);
  $("#groupSettingsTitle").textContent = createNew ? "새 단톡" : "단톡 설정";
  $("#groupSettingsDescription").textContent = createNew
    ? "이미 만든 친구를 골라 하나의 새 대화방으로 묶어."
    : "참여 친구와 이 대화방의 설정을 바꿔.";
  openModal(refs.groupModal, refs.groupForm.elements.name);
}

function closeGroupSettings() {
  closeModal(refs.groupModal);
}

function openAppSettings() {
  fillForm(refs.appForm, [
    "userName",
    "userGender",
    "userAge",
    "userDescription",
    "model",
    "autonomousModel",
    "monthlyTokenLimit",
    "proactiveDailyTokenLimit",
    "maxOutputTokens",
    "sbv2Endpoint",
    "keepInTray",
    "launchAtLogin",
    "playVoiceInBackground",
    "showNotificationPreview",
    "messageHistoryEditingEnabled",
    "quietStart",
    "quietEnd"
  ]);
  refs.appForm.elements.apiKey.value = "";
  $("#apiKeyStatus").textContent = state.settings.hasApiKey
    ? "API 키 연결됨 · 비워두면 기존 키 유지"
    : "현재 데모 모드";
  $("#clearApiKeyButton").classList.toggle("hidden", !state.settings.hasApiKey);
  openModal(refs.appModal, refs.appForm.elements.userName);
}

function closeAppSettings() {
  closeModal(refs.appModal);
}

const MEMORY_CATEGORIES = {
  profile: {
    label: "기본 정보",
    description: "사는 곳, 직업, 가족처럼 오래 유지되는 사실"
  },
  preference: {
    label: "좋아함·싫어함",
    description: "좋아하거나 싫어하는 음식, 취미, 작품과 대화 방식"
  },
  ongoing: {
    label: "요즘 하는 일",
    description: "최근 진행 중인 계획, 공부, 프로젝트나 계속되는 고민"
  },
  shared_event: {
    label: "함께 나눈 기억",
    description: "이 친구와 대화하며 생긴 약속, 사건이나 둘만 아는 농담"
  }
};

function updateMemoryCategoryGuide() {
  const category = MEMORY_CATEGORIES[refs.memoryCreateForm.elements.category.value];
  $("#memoryCategoryLabel").textContent = category?.label || "기억 분류";
  $("#memoryCategoryHelp").textContent = category?.description || "목록을 정리하기 위한 표시";
}

function renderMemories() {
  const memories = [...(state.memories || [])].sort(
    (left, right) =>
      Number(right.pinned) - Number(left.pinned) ||
      new Date(right.updatedAt) - new Date(left.updatedAt)
  );
  if (!memories.length) {
    refs.memoryList.innerHTML = `<div class="memory-empty">아직 저장된 기억이 없어.</div>`;
    return;
  }
  refs.memoryList.innerHTML = memories
    .map(
      (memory) => `
        <div class="memory-item" data-memory-id="${escapeHtml(memory.id)}">
          <select data-memory-field="category">
            ${Object.entries(MEMORY_CATEGORIES)
              .map(
                ([value, category]) =>
                  `<option value="${value}" ${memory.category === value ? "selected" : ""}>${category.label}</option>`
              )
              .join("")}
          </select>
          <input data-memory-field="text" maxlength="240" value="${escapeHtml(memory.text)}" />
          <div class="memory-controls">
            <button class="${memory.pinned ? "pinned" : ""}" data-memory-action="pin" title="고정" aria-label="${memory.pinned ? "기억 고정 해제" : "기억 고정"}">★</button>
            <button data-memory-action="delete" title="삭제" aria-label="기억 삭제">×</button>
          </div>
        </div>
      `
    )
    .join("");
}

function openMemoryModal() {
  renderMemories();
  updateMemoryCategoryGuide();
  openModal(refs.memoryModal, focusableElements(refs.memoryModal)[0]);
}

function closeMemoryModal() {
  closeModal(refs.memoryModal);
}

function setReplyTarget(messageId) {
  const message = state.messages.find((candidate) => candidate.id === messageId);
  if (!message) return;
  if (editingMessageId !== null) {
    refs.input.value = draftBeforeEdit;
    refs.input.dispatchEvent(new Event("input"));
  }
  editingMessageId = null;
  draftBeforeEdit = "";
  replyToId = message.id;
  $("#replyPreviewName").textContent =
    message.role === "user"
      ? "내 메시지에 답장"
      : `${message.senderName || state.settings.name}에게 답장`;
  $("#replyPreviewText").textContent = message.text;
  $("#replyPreview").classList.remove("hidden");
  refs.input.focus();
}

function setEditTarget(messageId) {
  if (!state.settings.messageHistoryEditingEnabled) return;
  const message = state.messages.find((candidate) => candidate.id === messageId);
  if (!message) return;
  replyToId = null;
  if (editingMessageId === null) draftBeforeEdit = refs.input.value;
  editingMessageId = message.id;
  $("#replyPreviewName").textContent = "메시지 수정 중";
  $("#replyPreviewText").textContent = message.text;
  $("#replyPreview").classList.remove("hidden");
  refs.input.value = message.text;
  refs.input.dispatchEvent(new Event("input"));
  refs.input.focus();
}

function clearReplyTarget(restoreEditDraft = false) {
  if (restoreEditDraft && editingMessageId !== null) {
    refs.input.value = draftBeforeEdit;
    refs.input.dispatchEvent(new Event("input"));
  }
  replyToId = null;
  editingMessageId = null;
  draftBeforeEdit = "";
  $("#replyPreview").classList.add("hidden");
}

function composerCanFocus() {
  return (
    refs.friendModal.classList.contains("hidden") &&
    refs.groupModal.classList.contains("hidden") &&
    refs.appModal.classList.contains("hidden") &&
    refs.memoryModal.classList.contains("hidden") &&
    $("#searchBar").classList.contains("hidden")
  );
}

function focusComposer(retry = false) {
  clearTimeout(composerFocusRetry);
  if (!composerCanFocus()) return;
  refs.input.focus({ preventScroll: true });
  if (retry && document.activeElement !== refs.input) {
    composerFocusRetry = setTimeout(() => {
      if (composerCanFocus()) refs.input.focus({ preventScroll: true });
    }, 60);
  }
}

refs.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (sendingMessage) return;
  const text = refs.input.value.trim();
  if (!text) return;
  const sentReplyToId = replyToId;
  const editedMessageId = editingMessageId;
  sendingMessage = true;
  $("#sendButton").disabled = true;
  clearAutoVoiceQueue();
  const playingMessage = (state.messages || []).find((message) => message.id === playingVoiceId);
  if (playingMessage?.ambient || autoVoiceBatchMeta.get(playingVoiceId)?.ambient) stopVoiceAudio();
  refs.input.value = "";
  refs.input.style.height = "auto";
  try {
    await window.her.setTyping(false);
    state = editedMessageId
      ? await window.her.updateMessage(editedMessageId, text)
      : await window.her.sendMessage({ text, replyToId: sentReplyToId });
    clearReplyTarget();
    if (!editedMessageId) chatScroller.forceBottom();
    render();
  } catch (error) {
    if (!refs.input.value) refs.input.value = text;
    if (editedMessageId) setEditTarget(editedMessageId);
    else if (sentReplyToId) setReplyTarget(sentReplyToId);
    refs.input.dispatchEvent(new Event("input"));
    showToast(
      friendlyError(error, editedMessageId ? "메시지를 수정하지 못했어." : "메시지를 보내지 못했어."),
      "error"
    );
  } finally {
    sendingMessage = false;
    $("#sendButton").disabled = false;
    focusComposer(true);
  }
});

refs.input.addEventListener("keydown", (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    refs.composer.requestSubmit();
  }
});

$(".composer-wrap").addEventListener(
  "pointerdown",
  (event) => {
    if (!event.target.closest("button")) focusComposer(true);
  },
  true
);

document.addEventListener(
  "pointerdown",
  (event) => {
    if (!event.target.closest(".composer-wrap")) clearTimeout(composerFocusRetry);
  },
  true
);

refs.input.addEventListener("input", () => {
  refs.input.style.height = "auto";
  refs.input.style.height = `${Math.min(refs.input.scrollHeight, 110)}px`;
  if (refs.input.value.trim()) {
    const playingMessage = (state.messages || []).find((message) => message.id === playingVoiceId);
    if (playingMessage?.ambient || autoVoiceBatchMeta.get(playingVoiceId)?.ambient) {
      clearAutoVoiceQueue();
      stopVoiceAudio();
    }
  }
  window.her.setTyping(Boolean(refs.input.value.trim()));
});

refs.input.addEventListener("focus", () => {
  if (refs.input.value.trim()) window.her.setTyping(true);
});

refs.input.addEventListener("blur", () => {
  window.her.setTyping(false);
});

$("#settingsButton").addEventListener("click", () =>
  state.room?.type === "group" ? openGroupSettings(false) : openFriendSettings(false)
);
$("#liveConversationButton").addEventListener("click", async () => {
  const button = $("#liveConversationButton");
  if (button.disabled) return;
  button.disabled = true;
  try {
    state = await window.her.toggleLiveConversation();
    render();
  } catch (error) {
    showToast(friendlyError(error, "통화형 대화를 시작하지 못했어."), "error");
  } finally {
    button.disabled = false;
  }
});
$("#addFriendButton").addEventListener("click", () => openFriendSettings(true));
$("#addGroupButton").addEventListener("click", () => openGroupSettings(true));
$("#closeSettingsButton").addEventListener("click", closeFriendSettings);
refs.friendModal.addEventListener("click", (event) => {
  if (event.target === refs.friendModal) closeFriendSettings();
});
$("#closeGroupSettingsButton").addEventListener("click", closeGroupSettings);
refs.groupModal.addEventListener("click", (event) => {
  if (event.target === refs.groupModal) closeGroupSettings();
});

$("#appSettingsButton").addEventListener("click", openAppSettings);
$("#memoryButton").addEventListener("click", openMemoryModal);
$("#closeMemoryButton").addEventListener("click", closeMemoryModal);
refs.memoryModal.addEventListener("click", (event) => {
  if (event.target === refs.memoryModal) closeMemoryModal();
});
$("#closeAppSettingsButton").addEventListener("click", closeAppSettings);
refs.appModal.addEventListener("click", (event) => {
  if (event.target === refs.appModal) closeAppSettings();
});

document.addEventListener("keydown", (event) => {
  const openBackdrop = [refs.friendModal, refs.groupModal, refs.appModal, refs.memoryModal].find(
    (backdrop) => !backdrop.classList.contains("hidden")
  );
  if (!openBackdrop) return;
  if (event.key === "Escape") {
    event.preventDefault();
    if (openBackdrop === refs.friendModal) closeFriendSettings();
    else if (openBackdrop === refs.groupModal) closeGroupSettings();
    else if (openBackdrop === refs.appModal) closeAppSettings();
    else closeMemoryModal();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = focusableElements(openBackdrop);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

refs.friendForm.addEventListener("input", (event) => {
  if (event.target.dataset.discreteSetting) updateSliderLabels();
  if (event.isTrusted) markSelectedPreset(null);
});

document.querySelectorAll("[data-preset]").forEach((button) => {
  button.addEventListener("click", () => applyPreset(button.dataset.preset));
});

$("#characterExampleButton").addEventListener("click", () => {
  refs.friendForm.elements.character.value = CHARACTER_EXAMPLES[exampleIndex];
  exampleIndex = (exampleIndex + 1) % CHARACTER_EXAMPLES.length;
  markSelectedPreset(null);
});

refs.friendForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = refs.friendForm.querySelector('button[type="submit"]');
  if (submitButton.disabled) return;
  submitButton.disabled = true;
  const settings = Object.fromEntries(new FormData(refs.friendForm).entries());
  for (const key of [
    "closeness",
    "trust",
    "playfulness",
    "warmth",
    "bluntness",
    "initiative"
  ]) {
    settings[key] = refs.friendForm.elements[key].dataset.discreteSetting
      ? readDiscreteValue(key)
      : Number(settings[key] ?? refs.friendForm.elements[key].value);
  }
  for (const key of [
    "romanceAllowed",
    "proactiveEnabled",
    "voiceEnabled",
    "voiceAutoPlay",
    "voiceRevealAfterSynthesis",
    "ambientVoiceEnabled",
    "ambientContinueUnanswered",
    "ambientSaveTranscript"
  ]) {
    settings[key] = refs.friendForm.elements[key].checked;
  }
  for (const key of ["voiceModelId", "voiceSpeakerId", "voiceStyleWeight", "voiceLength", "ambientMaxConsecutive"]) {
    settings[key] = Number(settings[key]);
  }
  settings.age = Math.max(0, Math.min(120, Math.round(Number(settings.age || 0))));
  try {
    state = creatingFriend
      ? await window.her.createFriend(settings)
      : await window.her.saveSettings(settings);
    creatingFriend = false;
    closeFriendSettings();
    render();
  } catch (error) {
    showToast(friendlyError(error, "친구 설정을 저장하지 못했어."), "error");
  } finally {
    submitButton.disabled = false;
  }
});

refs.groupForm.addEventListener("change", (event) => {
  if (event.target.name === "autonomousEnabled") updateGroupAutonomyControls();
  if (event.target.name === "participantIds") {
    const selected = refs.groupForm.querySelectorAll('input[name="participantIds"]:checked');
    if (event.target.checked && selected.length > 6) {
      event.target.checked = false;
      showToast("단톡에는 친구를 최대 6명까지 넣을 수 있어.", "error");
    }
    updateGroupParticipantCount();
  }
});

refs.groupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = refs.groupForm.querySelector('button[type="submit"]');
  if (submitButton.disabled) return;
  const participantIds = Array.from(
    refs.groupForm.querySelectorAll('input[name="participantIds"]:checked')
  ).map((input) => input.value);
  if (participantIds.length < 2 || participantIds.length > 6) {
    showToast("친구를 2명에서 6명까지 선택해 줘.", "error");
    return;
  }
  const payload = {
    name: refs.groupForm.elements.name.value.trim(),
    participantIds,
    autonomousEnabled: refs.groupForm.elements.autonomousEnabled.checked,
    autonomousFrequency: refs.groupForm.elements.autonomousFrequency.value,
    autonomousMaxTurns: Number(refs.groupForm.elements.autonomousMaxTurns.value)
  };
  submitButton.disabled = true;
  try {
    state = creatingGroup
      ? await window.her.createRoom(payload)
      : await window.her.updateRoom(state.activeRoomId, payload);
    creatingGroup = false;
    closeGroupSettings();
    chatScroller.forceBottom();
    render();
  } catch (error) {
    showToast(friendlyError(error, "단톡 설정을 저장하지 못했어."), "error");
  } finally {
    submitButton.disabled = false;
  }
});

$("#loadVoiceModelsButton").addEventListener("click", loadVoiceModels);
$("#previewVoiceButton").addEventListener("click", previewSelectedVoice);
$("#openVoiceDiagnosticsButton").addEventListener("click", async () => {
  try {
    await window.her.openVoiceDiagnostics();
    $("#voiceConnectionStatus").textContent = "음성 진단 로그 위치를 열었어.";
  } catch (error) {
    showToast(friendlyError(error, "음성 로그 위치를 열지 못했어."), "error");
  }
});
$("#openEventDiagnosticsButton").addEventListener("click", async () => {
  try {
    await window.her.openEventDiagnostics();
    showToast("선톡·대화 로그 위치를 열었어.");
  } catch (error) {
    showToast(friendlyError(error, "선톡·대화 로그를 열지 못했어."), "error");
  }
});
refs.friendForm.elements.voiceModelId.addEventListener("change", () => {
  if (previewVoiceActive) stopVoiceAudio();
  previewVoiceActive = false;
  updateVoiceSelectors();
});
refs.friendForm.elements.ambientVoiceEnabled.addEventListener("change", () => {
  updateAmbientVoiceControls(true);
});
refs.friendForm.elements.ambientContinueUnanswered.addEventListener("change", () => {
  updateAmbientVoiceControls();
});
for (const name of ["proactiveEnabled", "voiceEnabled", "voiceAutoPlay"]) {
  refs.friendForm.elements[name].addEventListener("change", (event) => {
    if (!event.target.checked && refs.friendForm.elements.ambientVoiceEnabled.checked) {
      refs.friendForm.elements.ambientVoiceEnabled.checked = false;
      updateAmbientVoiceControls();
    }
    updateProactiveControls();
    updateVoiceSettingSummary();
  });
}

refs.roomList.addEventListener("click", async (event) => {
  const card = event.target.closest("[data-room-id]");
  if (!card || card.dataset.roomId === state.activeRoomId) return;
  await window.her.setTyping(false);
  refs.input.value = "";
  refs.input.style.height = "auto";
  clearReplyTarget();
  searchQuery = "";
  $("#searchInput").value = "";
  $("#searchBar").classList.add("hidden");
  chatScroller.forceBottom();
  state = await window.her.selectRoom(card.dataset.roomId);
  render();
  refs.input.focus();
});

refs.appForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = refs.appForm.querySelector('button[type="submit"]');
  if (submitButton.disabled) return;
  submitButton.disabled = true;
  const settings = Object.fromEntries(new FormData(refs.appForm).entries());
  for (const key of [
    "keepInTray",
    "launchAtLogin",
    "playVoiceInBackground",
    "showNotificationPreview",
    "messageHistoryEditingEnabled"
  ]) {
    settings[key] = refs.appForm.elements[key].checked;
  }
  for (const key of ["userAge", "monthlyTokenLimit", "proactiveDailyTokenLimit", "maxOutputTokens"]) {
    settings[key] = Number(settings[key]);
  }
  try {
    state = await window.her.saveSettings(settings);
    if (!state.settings.messageHistoryEditingEnabled && editingMessageId !== null) {
      clearReplyTarget(true);
    }
    closeAppSettings();
    render();
  } catch (error) {
    showToast(friendlyError(error, "앱 설정을 저장하지 못했어."), "error");
  } finally {
    submitButton.disabled = false;
  }
});

refs.messageList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, messageId, reaction } = button.dataset;
  if (action === "voice") {
    clearAutoVoiceQueue();
    await playVoice(messageId);
    return;
  }
  if (action === "reply") {
    setReplyTarget(messageId);
    return;
  }
  if (action === "edit") {
    clearAutoVoiceQueue();
    if (playingVoiceId === messageId) stopVoiceAudio();
    setEditTarget(messageId);
    return;
  }
  if (action === "react") {
    state = await window.her.reactToMessage(messageId, reaction);
    render();
    return;
  }
  if (action === "delete") {
    if (!confirm("이 메시지를 삭제할까?")) return;
    clearAutoVoiceQueue();
    if (playingVoiceId === messageId) stopVoiceAudio();
    try {
      state = await window.her.deleteMessage(messageId);
      if (editingMessageId === messageId || replyToId === messageId) clearReplyTarget();
      render();
    } catch (error) {
      showToast(friendlyError(error, "메시지를 삭제하지 못했어."), "error");
    }
  }
});

function stopVoiceAudio(reportStop = true) {
  const stoppedMessageId = playingVoiceId;
  const stoppedMeta = stoppedMessageId ? autoVoiceBatchMeta.get(stoppedMessageId) : null;
  if (reportStop && stoppedMessageId) {
    reportVoicePlayback("playback_stopped", stoppedMessageId, {
      ...stoppedMeta,
      durationMs: currentVoiceStartedAt ? Date.now() - currentVoiceStartedAt : 0
    });
  }
  voicePlaybackGeneration += 1;
  voicePlayer.stop();
  playingVoiceId = null;
  currentVoiceStartedAt = 0;
  lastMessageRenderKey = "";
  if (state) render();
}

async function playVoice(messageId, quiet = false) {
  if (playingVoiceId === messageId && voicePlayer.playing) {
    stopVoiceAudio();
    return;
  }
  stopVoiceAudio();
  const playbackGeneration = voicePlaybackGeneration;
  const playbackMeta = autoVoiceBatchMeta.get(messageId) || {
    batchId: `manual-${messageId}`,
    batchIndex: 1,
    batchTotal: 1
  };
  loadingVoiceIds.add(messageId);
  lastMessageRenderKey = "";
  renderMessages();
  try {
    const result = await window.her.synthesizeVoice(messageId);
    if (playbackGeneration !== voicePlaybackGeneration) return;
    playingVoiceId = messageId;
    currentVoiceStartedAt = Date.now();
    loadingVoiceIds.delete(messageId);
    lastMessageRenderKey = "";
    renderMessages();
    $("#presenceText").textContent =
      playbackMeta.batchTotal > 1
        ? `${playbackMeta.friendName ? `${playbackMeta.friendName} · ` : ""}음성 재생 중 ${playbackMeta.batchIndex}/${playbackMeta.batchTotal}`
        : `${playbackMeta.friendName ? `${playbackMeta.friendName} · ` : ""}음성 재생 중`;
    reportVoicePlayback("playback_started", messageId, playbackMeta);
    await voicePlayer.play(result);
    if (playbackGeneration === voicePlaybackGeneration && playingVoiceId === messageId) {
      reportVoicePlayback("playback_completed", messageId, {
        ...playbackMeta,
        durationMs: Date.now() - currentVoiceStartedAt
      });
      playingVoiceId = null;
      currentVoiceStartedAt = 0;
    }
  } catch (error) {
    reportVoicePlayback("playback_failed", messageId, {
      ...playbackMeta,
      durationMs: currentVoiceStartedAt ? Date.now() - currentVoiceStartedAt : 0,
      error: friendlyError(error, "음성을 재생하지 못했어.")
    });
    stopVoiceAudio(false);
    if (!quiet) showToast(friendlyError(error, "음성을 재생하지 못했어."), "error");
  } finally {
    loadingVoiceIds.delete(messageId);
    autoVoiceBatchMeta.delete(messageId);
    queuedAutoVoiceIds.delete(messageId);
    lastMessageRenderKey = "";
    render();
  }
}

refs.messageList.addEventListener("scroll", () => chatScroller.handleScroll());

$("#newMessageButton").addEventListener("click", () => chatScroller.scrollToBottom());

$("#cancelReplyButton").addEventListener("click", () => clearReplyTarget(true));

$("#searchButton").addEventListener("click", () => {
  $("#searchBar").classList.toggle("hidden");
  if (!$("#searchBar").classList.contains("hidden")) $("#searchInput").focus();
});
$("#closeSearchButton").addEventListener("click", () => {
  searchQuery = "";
  $("#searchInput").value = "";
  $("#searchBar").classList.add("hidden");
  renderMessages();
  focusComposer(true);
});
$("#searchInput").addEventListener("input", (event) => {
  searchQuery = event.target.value.trim().toLocaleLowerCase("ko-KR");
  renderMessages();
});

$("#retryButton").addEventListener("click", async () => {
  const button = $("#retryButton");
  if (button.disabled) return;
  button.disabled = true;
  try {
    state = await window.her.retryMessage();
    render();
  } catch (error) {
    showToast(friendlyError(error, "다시 시도하지 못했어."), "error");
  } finally {
    button.disabled = false;
  }
});

refs.memoryList.addEventListener("change", async (event) => {
  const item = event.target.closest("[data-memory-id]");
  const field = event.target.dataset.memoryField;
  if (!item || !field) return;
  try {
    state = await window.her.updateMemory(item.dataset.memoryId, {
      [field]: event.target.value
    });
  } catch (error) {
    showToast(friendlyError(error, "기억을 수정하지 못했어."), "error");
  }
  renderMemories();
  render();
});

refs.memoryCreateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = refs.memoryCreateForm;
  const text = form.elements.text.value.trim();
  if (!text) {
    form.elements.text.focus();
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    state = await window.her.createMemory({
      category: form.elements.category.value,
      text,
      pinned: form.elements.pinned.checked
    });
    form.elements.text.value = "";
    renderMemories();
    render();
  } catch (error) {
    showToast(friendlyError(error, "기억을 추가하지 못했어."), "error");
  } finally {
    button.disabled = false;
  }
});

refs.memoryCreateForm.elements.category.addEventListener("change", updateMemoryCategoryGuide);

refs.memoryList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-memory-action]");
  const item = event.target.closest("[data-memory-id]");
  if (!button || !item) return;
  const memory = state.memories.find((candidate) => candidate.id === item.dataset.memoryId);
  if (!memory) return;
  try {
    if (button.dataset.memoryAction === "pin") {
      state = await window.her.updateMemory(memory.id, { pinned: !memory.pinned });
    } else if (button.dataset.memoryAction === "delete") {
      if (!confirm("이 기억을 지울까?")) return;
      state = await window.her.deleteMemory(memory.id);
    }
  } catch (error) {
    showToast(friendlyError(error, "기억을 변경하지 못했어."), "error");
  }
  renderMemories();
  render();
});

$("#exportBackupButton").addEventListener("click", async () => {
  try {
    const result = await window.her.exportBackup();
    if (!result.canceled) showToast("백업을 저장했어.");
  } catch (error) {
    showToast(friendlyError(error, "백업을 저장하지 못했어."), "error");
  }
});

$("#importBackupButton").addEventListener("click", async () => {
  if (!confirm("현재 데이터가 백업 파일 내용으로 바뀌어. 계속할까?")) return;
  try {
    state = await window.her.importBackup();
    closeAppSettings();
    chatScroller.forceBottom();
    render();
  } catch (error) {
    showToast(friendlyError(error, "백업을 불러오지 못했어."), "error");
  }
});

$("#clearApiKeyButton").addEventListener("click", async () => {
  if (!state.settings.hasApiKey) return;
  if (!confirm("저장된 OpenAI API 키를 삭제하고 데모 모드로 전환할까?")) return;
  state = await window.her.clearApiKey();
  openAppSettings();
  render();
});

$("#resetUsageButton").addEventListener("click", async () => {
  if (!state.usage?.requestCount) return;
  if (!confirm("앱에 저장된 OpenAI 누적 토큰 사용량을 초기화할까? OpenAI 계정의 실제 사용 내역은 지워지지 않아.")) return;
  state = await window.her.resetUsage();
  render();
  openAppSettings();
});

$("#testNudgeButton").addEventListener("click", async () => {
  const button = $("#testNudgeButton");
  if (button.disabled) return;
  nudgeTestInFlight = true;
  button.disabled = true;
  button.textContent = "선톡 만드는 중…";
  showToast("선톡 생성을 시작했어.");
  try {
    const result = await window.her.triggerNudge();
    state = result.state;
    render();
    showToast(result.message, ["failed", "blocked"].includes(result.status) ? "error" : "");
  } catch (error) {
    showToast(friendlyError(error, "선톡 테스트에 실패했어."), "error");
  } finally {
    nudgeTestInFlight = false;
    button.textContent = "선톡 테스트";
    render();
  }
});

$("#clearButton").addEventListener("click", async () => {
  const button = $("#clearButton");
  if (button.dataset.confirming !== "true") {
    button.dataset.confirming = "true";
    button.textContent = "한 번 더 누르면 초기화";
    clearConfirmationTimer = setTimeout(resetClearConfirmation, 4000);
    showToast("대화와 기억을 지우려면 초기화 버튼을 한 번 더 눌러줘.");
    return;
  }
  button.disabled = true;
  clearTimeout(clearConfirmationTimer);
  try {
    clearAutoVoiceQueue();
    stopVoiceAudio();
    state = await window.her.clearConversation();
    clearReplyTarget();
    chatScroller.forceBottom();
    closeFriendSettings({ restoreFocusTo: refs.input });
    render();
  } catch (error) {
    showToast(friendlyError(error, "대화를 초기화하지 못했어."), "error");
  } finally {
    button.disabled = false;
    resetClearConfirmation();
  }
});

$("#deleteFriendButton").addEventListener("click", async () => {
  if (state.friends.length <= 1) return;
  if (!confirm(`${state.settings.name}과의 대화와 기억을 모두 삭제할까? 되돌릴 수 없어.`)) return;
  clearAutoVoiceQueue();
  stopVoiceAudio();
  state = await window.her.deleteFriend(state.activeFriendId);
  creatingFriend = false;
  closeFriendSettings();
  render();
});

$("#deleteGroupButton").addEventListener("click", async () => {
  if (state.room?.type !== "group") return;
  if (!confirm(`'${state.room.name}' 단톡을 삭제할까? 대화 내용도 함께 지워지고 되돌릴 수 없어.`)) return;
  clearAutoVoiceQueue();
  stopVoiceAudio();
  state = await window.her.deleteRoom(state.activeRoomId);
  creatingGroup = false;
  closeGroupSettings();
  chatScroller.forceBottom();
  render();
});

$("#minimizeButton").addEventListener("click", () => window.her.minimize());
$("#closeButton").addEventListener("click", () => window.her.close());

window.her.onState((nextState) => {
  const previousIds = new Set((state?.messages || []).map((message) => message.id));
  const sameFriend = state?.activeRoomId === nextState.activeRoomId;
  const autoPlayEnabled =
    nextState.room?.type !== "group" &&
    nextState.settings.voiceEnabled &&
    nextState.settings.voiceAutoPlay;
  const autoVoices = autoPlayEnabled && sameFriend
    ? (nextState.messages || []).filter(
        (message) =>
          message.role === "assistant" &&
          message.spokenText &&
          !message.voiceError &&
          !previousIds.has(message.id)
      )
    : [];
  state = nextState;
  render();
  if (
    nextState.liveConversation?.stoppedAt &&
    nextState.liveConversation.stoppedAt !== lastSeenLiveStopAt
  ) {
    lastSeenLiveStopAt = nextState.liveConversation.stoppedAt;
    const stopMessages = {
      no_response: "답이 한동안 없어 통화형 대화를 멈췄어.",
      window_inactive: "창이 비활성화되어 통화형 대화를 멈췄어.",
      window_hidden: "창이 숨겨져 통화형 대화를 멈췄어.",
      generation_failed: "답장을 만들지 못해 통화형 대화를 멈췄어.",
      playback_failed: "음성을 재생하지 못해 통화형 대화를 멈췄어.",
      token_budget: "설정한 월간 토큰 한도에 도달해 통화형 대화를 멈췄어.",
      voice_server_unavailable: "음성 서버에 연결할 수 없어 텍스트만 표시하고 통화를 멈췄어."
    };
    if (stopMessages[nextState.liveConversation.reason]) {
      showToast(stopMessages[nextState.liveConversation.reason], "error");
    }
  }
  for (const message of autoVoices) {
    enqueueAutoVoice({
      ...message,
      messageId: message.id,
      friendId: message.senderId || nextState.activeFriendId,
      friendName: message.senderName || nextState.settings.name
    });
  }
  if (!refs.memoryModal.classList.contains("hidden")) renderMemories();
});

window.her.onAutoVoice((delivery) => {
  enqueueAutoVoice(delivery);
});

window.her.onStopAutoVoice(() => {
  clearAutoVoiceQueue();
  if (autoVoiceBatchMeta.has(playingVoiceId)) stopVoiceAudio();
});

window.her.onThinking((value) => {
  thinking = value;
  render();
});

window.addEventListener("online", render);
window.addEventListener("offline", render);

window.addEventListener("DOMContentLoaded", async () => {
  state = await window.her.getState();
  render();
  focusComposer(true);
});
