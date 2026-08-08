const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ambientVoiceConfigured,
  deferOverdueWorkAfterResume,
  initialNudgeDelayMs,
  paceMultiplier,
  quietHoursState,
  readDelayMs,
  replyBatchDelayMs,
  userReplyTiming
} = require("../src/main/scheduler");

test("reply pace controls read, generation, and bubble delays", () => {
  assert.equal(readDelayMs({ replyPace: "fast" }, () => 0), 700);
  assert.equal(readDelayMs({ replyPace: "slow" }, () => 0.9999), 11999);
  assert.equal(paceMultiplier({ replyPace: "fast" }), 0.35);
  assert.equal(paceMultiplier({ replyPace: "slow" }), 2.2);
  assert.equal(replyBatchDelayMs({ replyPace: "natural" }), 5000);
});

test("late user replies are classified from the previous assistant message", () => {
  const now = Date.parse("2026-08-03T12:00:00.000Z");
  const messages = [{
    role: "assistant",
    createdAt: "2026-08-03T08:00:00.000Z",
    expectsReply: true
  }];
  assert.deepEqual(userReplyTiming(messages, now), {
    minutes: 240,
    label: "late",
    wasExpected: true
  });
  assert.equal(userReplyTiming([{ role: "user", createdAt: new Date(now).toISOString() }], now), null);
});

test("ambient voice scheduling requires every automatic voice option", () => {
  const enabled = {
    proactiveEnabled: true,
    voiceEnabled: true,
    voiceAutoPlay: true,
    ambientVoiceEnabled: true
  };
  assert.equal(ambientVoiceConfigured(enabled), true);
  assert.equal(ambientVoiceConfigured({ ...enabled, voiceAutoPlay: false }), false);
  assert.equal(initialNudgeDelayMs(true, () => 0), 30_000);
  assert.equal(initialNudgeDelayMs(false), 6 * 3_600_000);
});

test("quiet hours work across midnight and return the next end time", () => {
  const settings = { quietStart: "23:00", quietEnd: "08:00" };
  const during = new Date(2026, 7, 3, 1, 0, 0);
  const outside = new Date(2026, 7, 3, 12, 0, 0);
  assert.equal(quietHoursState(settings, during).active, true);
  assert.equal(quietHoursState(settings, outside).active, false);
  assert.ok(quietHoursState(settings, during).endAt > during.getTime());
});

test("overdue work is spread after resume without dropping pending items", () => {
  const now = Date.parse("2026-08-03T12:00:00.000Z");
  const state = {
    friends: [{
      nextNudgeAt: new Date(now - 1000).toISOString(),
      pending: [{ proactive: true, deliverAt: new Date(now - 1000).toISOString() }]
    }],
    rooms: [{
      type: "group",
      pending: [{ proactive: true, deliverAt: new Date(now - 1000).toISOString() }],
      nextAutonomousAt: new Date(now - 1000).toISOString()
    }]
  };
  const deferred = [];
  assert.equal(deferOverdueWorkAfterResume(state, now, {
    random: () => 0,
    onFriendDeferred: (_friend, nextAt) => deferred.push(nextAt)
  }), true);
  assert.ok(Date.parse(state.friends[0].nextNudgeAt) > now);
  assert.ok(Date.parse(state.friends[0].pending[0].deliverAt) > now);
  assert.ok(Date.parse(state.rooms[0].pending[0].deliverAt) > now);
  assert.ok(Date.parse(state.rooms[0].nextAutonomousAt) > now);
  assert.equal(deferred.length, 2);
});
