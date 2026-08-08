function readDelayMs(profile, random = Math.random) {
  const ranges = {
    fast: [700, 1800],
    natural: [1600, 4800],
    slow: [4500, 12000]
  };
  const [minimum, maximum] = ranges[profile.replyPace] || ranges.natural;
  return minimum + Math.floor(random() * (maximum - minimum));
}

function userReplyTiming(messages, now = Date.now()) {
  const previous = messages[messages.length - 1];
  if (!previous || previous.role !== "assistant") return null;
  const minutes = Math.max(
    0,
    Math.round((now - new Date(previous.createdAt).getTime()) / 60000)
  );
  let label = "normal";
  if (minutes >= 720) label = "very_late";
  else if (minutes >= 180) label = "late";
  else if (minutes >= 30) label = "slightly_late";
  return { minutes, label, wasExpected: Boolean(previous.expectsReply) };
}

function paceMultiplier(profile) {
  if (profile.replyPace === "fast") return 0.35;
  if (profile.replyPace === "slow") return 2.2;
  return 1;
}

function replyBatchDelayMs(profile) {
  if (profile.replyPace === "fast") return 2500;
  if (profile.replyPace === "slow") return 8000;
  return 5000;
}

function ambientVoiceConfigured(profile) {
  return Boolean(
    profile.proactiveEnabled &&
    profile.voiceEnabled &&
    profile.voiceAutoPlay &&
    profile.ambientVoiceEnabled
  );
}

function initialNudgeDelayMs(ambientActive, random = Math.random) {
  if (ambientActive) return 30 * 1000 + random() * 60 * 1000;
  return 6 * 3600000;
}

function quietHoursState(settings, value = new Date()) {
  const now = new Date(value);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const parse = (time) => {
    const [hour, minute] = time.split(":").map(Number);
    return hour * 60 + minute;
  };
  const start = parse(settings.quietStart);
  const end = parse(settings.quietEnd);
  const active = start <= end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
  const endAt = new Date(now);
  endAt.setHours(Math.floor(end / 60), end % 60, 0, 0);
  if (endAt.getTime() <= now.getTime()) endAt.setDate(endAt.getDate() + 1);
  return { active, endAt: endAt.getTime() };
}

function deferOverdueWorkAfterResume(
  state,
  now,
  { random = Math.random, onFriendDeferred = () => {} } = {}
) {
  let changed = false;
  state.friends.forEach((friend, friendIndex) => {
    const baseDelay = 60 * 1000 + friendIndex * 45 * 1000 + random() * 30 * 1000;
    if (friend.nextNudgeAt && new Date(friend.nextNudgeAt).getTime() <= now) {
      friend.nextNudgeAt = new Date(now + baseDelay).toISOString();
      onFriendDeferred(friend, friend.nextNudgeAt);
      changed = true;
    }
    friend.pending.forEach((item, itemIndex) => {
      if (item.proactive && new Date(item.deliverAt).getTime() <= now) {
        item.deliverAt = new Date(now + baseDelay + itemIndex * 12 * 1000).toISOString();
        onFriendDeferred(friend, item.deliverAt);
        changed = true;
      }
    });
  });
  state.rooms.filter((room) => room.type === "group").forEach((room, roomIndex) => {
    const baseDelay = 60 * 1000 + roomIndex * 45 * 1000 + random() * 30 * 1000;
    room.pending.forEach((item, itemIndex) => {
      if (item.proactive && new Date(item.deliverAt).getTime() <= now) {
        item.deliverAt = new Date(now + baseDelay + itemIndex * 12 * 1000).toISOString();
        changed = true;
      }
    });
    if (room.nextAutonomousAt && new Date(room.nextAutonomousAt).getTime() <= now) {
      room.nextAutonomousAt = new Date(now + baseDelay).toISOString();
      changed = true;
    }
  });
  return changed;
}

module.exports = {
  ambientVoiceConfigured,
  deferOverdueWorkAfterResume,
  initialNudgeDelayMs,
  paceMultiplier,
  quietHoursState,
  readDelayMs,
  replyBatchDelayMs,
  userReplyTiming
};
