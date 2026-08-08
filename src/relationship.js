const EVENT_DELTAS = {
  ordinary: { closeness: 0, trust: 0 },
  personal_share: { closeness: 1, trust: 1 },
  appreciation: { closeness: 1, trust: 1 },
  shared_fun: { closeness: 1, trust: 0 },
  conflict: { closeness: -1, trust: -1 },
  repair: { closeness: 0, trust: 1 }
};

const DAILY_CHANGE_LIMIT = 2;
const POSITIVE_EVENT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function localDateKey(value) {
  const date = new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function clampScore(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(100, Math.round(number)))
    : fallback;
}

function relationshipStage(relationship) {
  const score =
    (Number(relationship?.closeness || 0) + Number(relationship?.trust || 0)) / 2;
  if (score < 35) return { key: "distant", label: "아직 거리가 있는 사이" };
  if (score < 50) return { key: "getting_to_know", label: "서로 알아가는 사이" };
  if (score < 65) return { key: "warming_up", label: "조금 친해진 사이" };
  if (score < 80) return { key: "comfortable", label: "편하고 가까운 사이" };
  return { key: "very_close", label: "아주 가까운 사이" };
}

function cappedDailyDelta(proposed, history, key) {
  if (!proposed) return 0;
  const used = history.reduce((sum, item) => {
    const value = Number(item[key] || 0);
    if (Math.sign(value) !== Math.sign(proposed)) return sum;
    return sum + Math.abs(value);
  }, 0);
  const available = Math.max(0, DAILY_CHANGE_LIMIT - used);
  return Math.sign(proposed) * Math.min(Math.abs(proposed), available);
}

function applyRelationshipEvent(friend, requestedEvent, now = Date.now()) {
  const event = Object.hasOwn(EVENT_DELTAS, requestedEvent) ? requestedEvent : "ordinary";
  const proposed = EVENT_DELTAS[event];
  if (!friend.relationshipEvents) friend.relationshipEvents = [];

  const today = localDateKey(now);
  const todayHistory = friend.relationshipEvents.filter(
    (item) => localDateKey(item.createdAt) === today
  );
  const repeatedPositiveEvent =
    (proposed.closeness > 0 || proposed.trust > 0) &&
    [...friend.relationshipEvents]
      .reverse()
      .some(
        (item) =>
          item.event === event &&
          now - new Date(item.createdAt).getTime() < POSITIVE_EVENT_COOLDOWN_MS
      );

  const closenessChange = repeatedPositiveEvent
    ? 0
    : cappedDailyDelta(proposed.closeness, todayHistory, "closenessChange");
  const trustChange = repeatedPositiveEvent
    ? 0
    : cappedDailyDelta(proposed.trust, todayHistory, "trustChange");

  if (closenessChange || trustChange) {
    friend.relationship.closeness = clampScore(
      Number(friend.relationship.closeness || 0) + closenessChange
    );
    friend.relationship.trust = clampScore(
      Number(friend.relationship.trust || 0) + trustChange
    );
    friend.relationshipEvents.push({
      event,
      closenessChange,
      trustChange,
      createdAt: new Date(now).toISOString()
    });
    friend.relationshipEvents = friend.relationshipEvents.slice(-100);
  }

  return { event, closenessChange, trustChange };
}

module.exports = {
  DAILY_CHANGE_LIMIT,
  POSITIVE_EVENT_COOLDOWN_MS,
  applyRelationshipEvent,
  clampScore,
  relationshipStage
};
