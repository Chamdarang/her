const {
  APP_DEFAULTS,
  PROFILE_DEFAULTS,
  RELATIONSHIP_DEFAULTS,
  USAGE_DEFAULTS
} = require("../defaults");
const { migrateMemories } = require("../memory");
const { clampScore } = require("../relationship");

const STATE_VERSION = 7;

function normalizeStoredUsage(usage = {}) {
  return {
    ...USAGE_DEFAULTS,
    ...usage,
    byDay: { ...(usage.byDay || {}) },
    byMonth: { ...(usage.byMonth || {}) },
    byFriend: { ...(usage.byFriend || {}) }
  };
}

function normalizeAppSettings(raw = {}) {
  const normalized = { ...APP_DEFAULTS, ...raw };
  normalized.messageHistoryEditingEnabled = raw.messageHistoryEditingEnabled === true;
  normalized.userName = String(raw.userName || "").trim().slice(0, 50);
  normalized.userGender = ["여성", "남성", "설정하지 않음"].includes(raw.userGender)
    ? raw.userGender
    : "설정하지 않음";
  normalized.userAge = Math.max(0, Math.min(120, Math.round(Number(raw.userAge || 0))));
  normalized.userDescription = String(raw.userDescription || "").trim().slice(0, 600);
  delete normalized.llmProvider;
  delete normalized.ollamaEndpoint;
  delete normalized.ollamaModel;
  delete normalized.ollamaAutonomousModel;
  if (
    !Object.hasOwn(raw, "playVoiceInBackground") &&
    Object.hasOwn(raw, "autoVoiceOnlyWhenFocused")
  ) {
    normalized.playVoiceInBackground = !Boolean(raw.autoVoiceOnlyWhenFocused);
  }
  delete normalized.autoVoiceOnlyWhenFocused;
  return normalized;
}

function migrateMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-300).map((message) => {
    const migrated = { ...message, reactions: { ...(message.reactions || {}) } };
    if (message.role !== "user" || Object.hasOwn(message, "readAt")) return migrated;
    return { ...migrated, readAt: message.createdAt };
  });
}

function createFriendRecord(profile = {}, legacy = {}, createId) {
  const cleanProfile = { ...profile };
  delete cleanProfile.userName;
  delete cleanProfile.autonomousEnabled;
  delete cleanProfile.autonomousFrequency;
  delete cleanProfile.autonomousMaxTurns;
  const relationship = {
    ...RELATIONSHIP_DEFAULTS,
    ...(legacy.relationship || {}),
    ...(Object.hasOwn(cleanProfile, "closeness")
      ? { closeness: clampScore(cleanProfile.closeness, RELATIONSHIP_DEFAULTS.closeness) }
      : {}),
    ...(Object.hasOwn(cleanProfile, "trust")
      ? { trust: clampScore(cleanProfile.trust, RELATIONSHIP_DEFAULTS.trust) }
      : {})
  };
  delete cleanProfile.closeness;
  delete cleanProfile.trust;
  delete cleanProfile.relationship;
  delete relationship.currentActivity;
  delete relationship.activityExpiresAt;
  const normalizedProfile = { ...PROFILE_DEFAULTS, ...cleanProfile };
  normalizedProfile.gender = ["여성", "남성", "설정하지 않음"].includes(normalizedProfile.gender)
    ? normalizedProfile.gender
    : "설정하지 않음";
  normalizedProfile.age = Math.max(
    0,
    Math.min(120, Math.round(Number(normalizedProfile.age || 0)))
  );
  if (!["quiet", "normal", "chatty"].includes(normalizedProfile.ambientVoiceFrequency)) {
    normalizedProfile.ambientVoiceFrequency = "normal";
  }
  normalizedProfile.ambientMaxConsecutive = Math.max(
    1,
    Math.min(5, Math.round(Number(normalizedProfile.ambientMaxConsecutive || 3)))
  );
  if (normalizedProfile.ambientVoiceEnabled) {
    normalizedProfile.proactiveEnabled = true;
    normalizedProfile.voiceEnabled = true;
    normalizedProfile.voiceAutoPlay = true;
  }
  return {
    id: legacy.id || createId(),
    profile: normalizedProfile,
    relationship,
    relationshipEvents: Array.isArray(legacy.relationshipEvents)
      ? legacy.relationshipEvents
      : [],
    memories: migrateMemories(legacy.memories, createId),
    messages: migrateMessages(legacy.messages),
    pending: Array.isArray(legacy.pending) ? legacy.pending : [],
    proactiveLog: Array.isArray(legacy.proactiveLog) ? legacy.proactiveLog : [],
    ambientBurstCount: Number(legacy.ambientBurstCount || 0),
    error: legacy.error || null,
    nextNudgeAt: legacy.nextNudgeAt || null,
    pausedNudgeRemainingMs: Number(legacy.pausedNudgeRemainingMs || 0),
    lastNudgeAt: legacy.lastNudgeAt || null,
    unreadCount: Number(legacy.unreadCount || 0),
    nudgeStatus:
      legacy.nudgeStatus && legacy.nudgeStatus.state !== "generating"
        ? legacy.nudgeStatus
        : null,
    createdAt: legacy.createdAt || new Date().toISOString()
  };
}

function modernStateFromLoaded(loaded, createId) {
  if (!Array.isArray(loaded.friends) || !loaded.friends.length) {
    throw new Error("백업에 친구 데이터가 없습니다.");
  }
  const legacyUserName = loaded.friends
    .map((friend) => String(friend?.profile?.userName || "").trim())
    .find(Boolean);
  const friends = loaded.friends.slice(0, 50).map((friend) =>
    createFriendRecord(friend.profile, {
      ...friend,
      relationship: friend.relationship,
      relationshipEvents: friend.relationshipEvents
    }, createId)
  );
  return {
    version: STATE_VERSION,
    appSettings: normalizeAppSettings({
      ...(loaded.appSettings || {}),
      ...(!loaded.appSettings?.userName && legacyUserName ? { userName: legacyUserName } : {})
    }),
    friends,
    rooms: loaded.rooms,
    activeRoomId: loaded.activeRoomId,
    activeFriendId: friends.some((friend) => friend.id === loaded.activeFriendId)
      ? loaded.activeFriendId
      : friends[0].id,
    usage: normalizeStoredUsage(loaded.usage)
  };
}

function stateFromLoaded(loaded, createId) {
  if (Array.isArray(loaded.friends) && loaded.friends.length) {
    return modernStateFromLoaded(loaded, createId);
  }
  const legacySettings = loaded.settings || {};
  const profile = {};
  for (const key of Object.keys(PROFILE_DEFAULTS)) {
    if (Object.hasOwn(legacySettings, key)) profile[key] = legacySettings[key];
  }
  if (!legacySettings.gender && legacySettings.relationship === "여사친") {
    profile.gender = "여성";
  }
  const appSettings = {};
  for (const key of Object.keys(APP_DEFAULTS)) {
    if (Object.hasOwn(legacySettings, key)) appSettings[key] = legacySettings[key];
  }
  const friend = createFriendRecord(profile, {
    relationship: loaded.relationship,
    relationshipEvents: loaded.relationshipEvents,
    memories: loaded.memories,
    messages: loaded.messages,
    pending: loaded.pending,
    nextNudgeAt: loaded.nextNudgeAt,
    lastNudgeAt: loaded.lastNudgeAt
  }, createId);
  return {
    version: STATE_VERSION,
    appSettings: normalizeAppSettings({ ...legacySettings, ...appSettings }),
    friends: [friend],
    activeFriendId: friend.id,
    usage: normalizeStoredUsage(loaded.usage)
  };
}

function createInitialState(createId) {
  const friend = createFriendRecord({}, {}, createId);
  return {
    version: STATE_VERSION,
    appSettings: { ...APP_DEFAULTS },
    friends: [friend],
    activeFriendId: friend.id,
    usage: normalizeStoredUsage()
  };
}

module.exports = {
  STATE_VERSION,
  createFriendRecord,
  createInitialState,
  modernStateFromLoaded,
  normalizeAppSettings,
  normalizeStoredUsage,
  stateFromLoaded
};
