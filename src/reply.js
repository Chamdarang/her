const MOODS = new Set([
  "신남",
  "평범함",
  "심심함",
  "피곤함",
  "살짝 예민함",
  "장난스러움",
  "걱정됨"
]);
const RELATIONSHIP_EVENTS = new Set([
  "ordinary",
  "personal_share",
  "appreciation",
  "shared_fun",
  "conflict",
  "repair"
]);

function boundedInteger(value, minimum, maximum, fallback) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") {
    return fallback;
  }
  const number = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function normalizeGeneratedReply(raw, currentMood = "평범함") {
  if (!raw || typeof raw !== "object") throw new Error("AI 응답 형식이 올바르지 않아.");
  const rawMessages = Array.isArray(raw.messages) ? raw.messages.slice(0, 3) : [];
  const pairedVoiceMessages = rawMessages.some(
    (message) => message && typeof message === "object"
  );
  const voicePairs = pairedVoiceMessages
    ? rawMessages
        .map((message) => ({
          displayText: String(message?.displayText || "").trim(),
          spokenText: String(message?.spokenText || "").trim()
        }))
        .filter((message) => message.displayText)
    : [];
  const messages = pairedVoiceMessages
    ? voicePairs.map((message) => message.displayText)
    : rawMessages.map((message) => String(message || "").trim()).filter(Boolean);
  if (!messages.length) throw new Error("AI 응답에 표시할 메시지가 없어.");
  const spokenMessages = pairedVoiceMessages
    ? voicePairs.map((message) => message.spokenText)
    : Array.isArray(raw.spokenMessages)
      ? raw.spokenMessages.map((message) => String(message || "").trim()).slice(0, messages.length)
      : undefined;
  return {
    ...raw,
    messages,
    firstDelaySeconds: boundedInteger(raw.firstDelaySeconds, 2, 90, 4),
    betweenDelaySeconds: boundedInteger(raw.betweenDelaySeconds, 1, 20, 3),
    nextNudgeHours: boundedInteger(raw.nextNudgeHours, 2, 48, 8),
    memories: Array.isArray(raw.memories) ? raw.memories.slice(0, 3) : [],
    mood: MOODS.has(raw.mood) ? raw.mood : MOODS.has(currentMood) ? currentMood : "평범함",
    expectsReply: typeof raw.expectsReply === "boolean" ? raw.expectsReply : true,
    relationshipEvent: RELATIONSHIP_EVENTS.has(raw.relationshipEvent)
      ? raw.relationshipEvent
      : "ordinary",
    ...(spokenMessages ? { spokenMessages } : {})
  };
}

module.exports = {
  boundedInteger,
  normalizeGeneratedReply
};
