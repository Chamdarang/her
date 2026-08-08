const DAY_MS = 24 * 60 * 60 * 1000;

function localDateKey(value) {
  const date = new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function maxDailyNudges(initiative) {
  if (initiative >= 85) return 3;
  if (initiative >= 55) return 2;
  return 1;
}

function nextOpportunityMs(initiative, random = Math.random) {
  const minimumHours = initiative >= 75 ? 1.5 : initiative >= 45 ? 2.5 : 4;
  const spreadHours = initiative >= 75 ? 2.5 : 4;
  return (minimumHours + random() * spreadHours) * 60 * 60 * 1000;
}

function ambientIntervalMs(frequency, random = Math.random, resting = false) {
  if (resting) return (15 + random() * 15) * 60 * 1000;
  const ranges = {
    quiet: [8, 15],
    normal: [3, 8],
    chatty: [1.5, 4]
  };
  const [minimum, maximum] = ranges[frequency] || ranges.normal;
  return (minimum + random() * (maximum - minimum)) * 60 * 1000;
}

function ambientConsecutiveLimit(profile = {}) {
  if (!profile.ambientContinueUnanswered) return 1;
  return Math.max(1, Math.min(5, Math.round(Number(profile.ambientMaxConsecutive || 3))));
}

function latestProactiveIsUnanswered(messages) {
  const lastProactiveIndex = messages
    .map((message) => message.role === "assistant" && message.proactive)
    .lastIndexOf(true);
  if (lastProactiveIndex < 0) return false;
  return !messages.slice(lastProactiveIndex + 1).some((message) => message.role === "user");
}

function proactiveOpportunity(friend, now = Date.now(), random = Math.random) {
  if (friend.profile.ambientVoiceEnabled) {
    const limit = ambientConsecutiveLimit(friend.profile);
    if (Number(friend.ambientBurstCount || 0) >= limit) {
      return {
        send: false,
        reason: "ambient_rest",
        retryAfterMs: ambientIntervalMs(friend.profile.ambientVoiceFrequency, random, true),
        resetAmbientBurst: true
      };
    }
    return { send: true, reason: "ambient", retryAfterMs: 0 };
  }
  const today = localDateKey(now);
  const sentToday = (friend.proactiveLog || []).filter(
    (item) => localDateKey(item.createdAt) === today
  ).length;
  const limit = maxDailyNudges(Number(friend.profile.initiative || 0));

  if (sentToday >= limit) {
    return { send: false, reason: "daily_limit", retryAfterMs: DAY_MS / 2 };
  }
  if (latestProactiveIsUnanswered(friend.messages || [])) {
    return { send: false, reason: "unanswered", retryAfterMs: 8 * 60 * 60 * 1000 };
  }

  const hasContext = (friend.messages || []).length > 0 || (friend.memories || []).length > 0;
  const initiative = Number(friend.profile.initiative || 0);
  const chance = Math.min(0.82, 0.18 + initiative * 0.006) * (hasContext ? 1 : 0.55);
  if (random() > chance) {
    return {
      send: false,
      reason: "natural_skip",
      retryAfterMs: nextOpportunityMs(initiative, random)
    };
  }
  return { send: true, reason: "opportunity", retryAfterMs: 0 };
}

module.exports = {
  ambientConsecutiveLimit,
  ambientIntervalMs,
  latestProactiveIsUnanswered,
  maxDailyNudges,
  nextOpportunityMs,
  proactiveOpportunity
};
