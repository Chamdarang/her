const MAX_UNANSWERED_TURNS = 3;

function nextLiveDelayMs({ expectsReply = false, unansweredTurns = 0 } = {}) {
  const unanswered = Math.max(0, Number(unansweredTurns) || 0);
  if (unanswered >= 2) return 30_000;
  if (unanswered === 1) return 18_000;
  return expectsReply ? 12_000 : 7_000;
}

function livePromptState({ lastSpokenAt, unansweredTurns = 0, reason = "silence" } = {}, now = Date.now()) {
  const spokenAt = new Date(lastSpokenAt || now).getTime();
  const silenceSeconds = Number.isFinite(spokenAt)
    ? Math.max(0, Math.round((now - spokenAt) / 1000))
    : 0;
  return {
    reason,
    silenceSeconds,
    unansweredTurns: Math.max(0, Number(unansweredTurns) || 0)
  };
}

module.exports = {
  MAX_UNANSWERED_TURNS,
  livePromptState,
  nextLiveDelayMs
};
