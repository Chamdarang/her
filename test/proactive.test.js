const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ambientConsecutiveLimit,
  ambientIntervalMs,
  latestProactiveIsUnanswered,
  maxDailyNudges,
  proactiveOpportunity
} = require("../src/proactive");

function friend(overrides = {}) {
  return {
    profile: { initiative: 60 },
    messages: [{ role: "user", text: "안녕" }],
    memories: [],
    proactiveLog: [],
    ...overrides
  };
}

test("initiative controls a small daily proactive cap", () => {
  assert.equal(maxDailyNudges(20), 1);
  assert.equal(maxDailyNudges(60), 2);
  assert.equal(maxDailyNudges(90), 3);
});

test("an unanswered proactive message blocks another one", () => {
  const messages = [{ role: "assistant", proactive: true, text: "뭐해" }];
  assert.equal(latestProactiveIsUnanswered(messages), true);
  const result = proactiveOpportunity(friend({ messages }), Date.UTC(2026, 6, 28), () => 0);
  assert.equal(result.send, false);
  assert.equal(result.reason, "unanswered");
});

test("an opportunity can naturally be skipped", () => {
  const result = proactiveOpportunity(friend(), Date.UTC(2026, 6, 28), () => 0.99);
  assert.equal(result.send, false);
  assert.equal(result.reason, "natural_skip");
});

test("daily cap blocks extra proactive messages", () => {
  const now = new Date(2026, 6, 28, 12).getTime();
  const createdAt = new Date(now).toISOString();
  const result = proactiveOpportunity(
    friend({
      proactiveLog: [{ createdAt }, { createdAt }]
    }),
    now,
    () => 0
  );
  assert.equal(result.send, false);
  assert.equal(result.reason, "daily_limit");
});

test("ambient voice uses minute-scale intervals", () => {
  assert.equal(ambientIntervalMs("quiet", () => 0), 8 * 60 * 1000);
  assert.equal(ambientIntervalMs("normal", () => 0), 3 * 60 * 1000);
  assert.equal(ambientIntervalMs("chatty", () => 0), 1.5 * 60 * 1000);
  assert.equal(ambientIntervalMs("normal", () => 0, true), 15 * 60 * 1000);
});

test("ambient voice pauses after its configured unanswered burst", () => {
  const profile = {
    initiative: 60,
    ambientVoiceEnabled: true,
    ambientVoiceFrequency: "normal",
    ambientContinueUnanswered: true,
    ambientMaxConsecutive: 3
  };
  assert.equal(ambientConsecutiveLimit(profile), 3);
  assert.equal(proactiveOpportunity(friend({ profile, ambientBurstCount: 2 }), Date.now(), () => 0).send, true);
  const rest = proactiveOpportunity(friend({ profile, ambientBurstCount: 3 }), Date.now(), () => 0);
  assert.equal(rest.send, false);
  assert.equal(rest.reason, "ambient_rest");
  assert.equal(rest.resetAmbientBurst, true);
});

test("ambient voice can stop after one unanswered turn", () => {
  assert.equal(ambientConsecutiveLimit({ ambientContinueUnanswered: false, ambientMaxConsecutive: 5 }), 1);
});
