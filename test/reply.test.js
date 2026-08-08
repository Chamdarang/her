const test = require("node:test");
const assert = require("node:assert/strict");
const { boundedInteger, normalizeGeneratedReply } = require("../src/reply");

test("invalid timing values receive safe bounded defaults", () => {
  const reply = normalizeGeneratedReply({
    messages: ["응"],
    firstDelaySeconds: "잠깐",
    betweenDelaySeconds: null,
    nextNudgeHours: "NaN",
    memories: null,
    mood: "unknown",
    relationshipEvent: "unknown"
  }, "피곤함");
  assert.equal(reply.firstDelaySeconds, 4);
  assert.equal(reply.betweenDelaySeconds, 3);
  assert.equal(reply.nextNudgeHours, 8);
  assert.deepEqual(reply.memories, []);
  assert.equal(reply.mood, "피곤함");
  assert.equal(reply.relationshipEvent, "ordinary");
});

test("numeric timing strings are accepted and clamped", () => {
  assert.equal(boundedInteger("5", 2, 90, 4), 5);
  assert.equal(boundedInteger(999, 2, 90, 4), 90);
  assert.equal(boundedInteger(-10, 2, 90, 4), 2);
});

test("a reply without a usable message fails before scheduling", () => {
  assert.throws(() => normalizeGeneratedReply({ messages: [] }), /표시할 메시지/);
  assert.throws(() => normalizeGeneratedReply(null), /형식/);
});

test("paired voice bubbles preserve display and spoken text alignment", () => {
  const reply = normalizeGeneratedReply({
    messages: [
      { displayText: "야, 뭐야?", spokenText: "ねえ、なに？" },
      { displayText: "지금 뭐 해? ㅋㅋ", spokenText: "今なにしてるの？ ふふ" }
    ]
  });
  assert.deepEqual(reply.messages, ["야, 뭐야?", "지금 뭐 해? ㅋㅋ"]);
  assert.deepEqual(reply.spokenMessages, ["ねえ、なに？", "今なにしてるの？ ふふ"]);
});

test("legacy parallel voice arrays remain compatible", () => {
  const reply = normalizeGeneratedReply({
    messages: ["응", "왜?"],
    spokenMessages: ["うん", "なに？"]
  });
  assert.deepEqual(reply.messages, ["응", "왜?"]);
  assert.deepEqual(reply.spokenMessages, ["うん", "なに？"]);
});
