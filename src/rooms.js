const ROOM_DEFAULTS = {
  type: "direct",
  name: "",
  participantIds: [],
  messages: [],
  pending: [],
  nextNudgeAt: null,
  lastNudgeAt: null,
  pausedNudgeRemainingMs: 0,
  ambientBurstCount: 0,
  error: null,
  proactiveLog: [],
  unreadCount: 0,
  nudgeStatus: null,
  autonomousEnabled: false,
  autonomousFrequency: "normal",
  autonomousMaxTurns: 6,
  autonomousTurnCount: 0,
  nextAutonomousAt: null,
  groupRepliesRemaining: 0
};

const CONVERSATION_FIELDS = [
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
];

function normalizeRoom(raw = {}, idFactory = () => String(Date.now())) {
  const type = raw.type === "group" ? "group" : "direct";
  const groupRoom = type === "group";
  const participantIds = [...new Set((raw.participantIds || []).filter(Boolean))].slice(0, 6);
  const messages = Array.isArray(raw.messages) ? raw.messages.slice(-300) : [];
  if (type === "direct" && participantIds[0]) {
    for (const message of messages) {
      if (message.role === "assistant" && !message.senderId) message.senderId = participantIds[0];
    }
  }
  return {
    ...ROOM_DEFAULTS,
    ...raw,
    id: raw.id || idFactory(),
    type,
    name: String(raw.name || "").trim().slice(0, 40),
    participantIds,
    messages,
    pending: Array.isArray(raw.pending)
      ? raw.pending.filter((item) => groupRoom || item.source !== "autonomous")
      : [],
    proactiveLog: Array.isArray(raw.proactiveLog) ? raw.proactiveLog.slice(-60) : [],
    unreadCount: Math.max(0, Number(raw.unreadCount || 0)),
    autonomousEnabled: groupRoom && Boolean(raw.autonomousEnabled),
    autonomousFrequency: ["quiet", "normal", "chatty"].includes(raw.autonomousFrequency)
      ? raw.autonomousFrequency
      : "normal",
    autonomousMaxTurns: Math.max(1, Math.min(20, Math.round(Number(raw.autonomousMaxTurns || 6)))),
    autonomousTurnCount: groupRoom ? Math.max(0, Number(raw.autonomousTurnCount || 0)) : 0,
    nextAutonomousAt: groupRoom ? raw.nextAutonomousAt || null : null
  };
}

function roomFromLegacyFriend(friend, idFactory) {
  return normalizeRoom(
    {
      id: `room-${friend.id}`,
      type: "direct",
      name: friend.profile?.name || "친구",
      participantIds: [friend.id],
      ...Object.fromEntries(CONVERSATION_FIELDS.map((key) => [key, friend[key]]))
    },
    idFactory
  );
}

function ensureRoomState(state, idFactory) {
  const friendIds = new Set((state.friends || []).map((friend) => friend.id));
  let rooms = Array.isArray(state.rooms)
    ? state.rooms.map((room) => normalizeRoom(room, idFactory))
    : [];

  for (const friend of state.friends || []) {
    const direct = rooms.find(
      (room) => room.type === "direct" && room.participantIds[0] === friend.id
    );
    if (!direct) rooms.push(roomFromLegacyFriend(friend, idFactory));
  }

  rooms = rooms
    .map((room) => ({
      ...room,
      participantIds: room.participantIds.filter((friendId) => friendIds.has(friendId))
    }))
    .filter((room) => room.type === "direct" ? room.participantIds.length === 1 : room.participantIds.length >= 2)
    .slice(0, 100);

  for (const friend of state.friends || []) {
    for (const field of CONVERSATION_FIELDS) delete friend[field];
  }

  state.rooms = rooms;
  if (!rooms.some((room) => room.id === state.activeRoomId)) {
    const legacyActive = rooms.find(
      (room) => room.type === "direct" && room.participantIds[0] === state.activeFriendId
    );
    state.activeRoomId = legacyActive?.id || rooms[0]?.id || null;
  }
  attachDirectRoomAliases(state);
  return state;
}

function attachDirectRoomAliases(state) {
  for (const friend of state.friends || []) {
    const room = state.rooms.find(
      (candidate) => candidate.type === "direct" && candidate.participantIds[0] === friend.id
    );
    if (!room) continue;
    for (const field of CONVERSATION_FIELDS) {
      Object.defineProperty(friend, field, {
        configurable: true,
        enumerable: false,
        get: () => room[field],
        set: (value) => {
          room[field] = value;
        }
      });
    }
    Object.defineProperty(friend, "roomId", {
      configurable: true,
      enumerable: false,
      value: room.id
    });
  }
}

function autonomousIntervalMs(frequency, random = Math.random, resting = false) {
  if (resting) return (10 + random() * 20) * 60 * 1000;
  const ranges = {
    quiet: [8, 15],
    normal: [3, 8],
    chatty: [1.5, 4]
  };
  const [minimum, maximum] = ranges[frequency] || ranges.normal;
  return (minimum + random() * (maximum - minimum)) * 60 * 1000;
}

function chooseNextSpeaker(room, friends, random = Math.random) {
  const participants = room.participantIds
    .map((friendId) => friends.find((friend) => friend.id === friendId))
    .filter(Boolean);
  if (!participants.length) return null;
  const lastSenderId = [...room.messages]
    .reverse()
    .find((message) => message.role === "assistant")?.senderId;
  const alternatives = participants.filter((friend) => friend.id !== lastSenderId);
  const pool = alternatives.length ? alternatives : participants;
  const total = pool.reduce((sum, friend) => sum + Math.max(1, Number(friend.profile?.initiative || 50)), 0);
  let cursor = random() * total;
  for (const friend of pool) {
    cursor -= Math.max(1, Number(friend.profile?.initiative || 50));
    if (cursor <= 0) return friend;
  }
  return pool.at(-1);
}

module.exports = {
  CONVERSATION_FIELDS,
  ROOM_DEFAULTS,
  attachDirectRoomAliases,
  autonomousIntervalMs,
  chooseNextSpeaker,
  ensureRoomState,
  normalizeRoom,
  roomFromLegacyFriend
};
