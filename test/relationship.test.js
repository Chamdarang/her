const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyRelationshipEvent,
  clampScore,
  relationshipStage
} = require("../src/relationship");

function friend() {
  return {
    relationship: { closeness: 48, trust: 52 },
    relationshipEvents: []
  };
}

test("ordinary conversation does not move relationship scores", () => {
  const subject = friend();
  const result = applyRelationshipEvent(subject, "ordinary", Date.UTC(2026, 6, 28, 1));
  assert.deepEqual(result, {
    event: "ordinary",
    closenessChange: 0,
    trustChange: 0
  });
  assert.equal(subject.relationship.closeness, 48);
  assert.equal(subject.relationship.trust, 52);
});

test("positive events have a six-hour repeat cooldown", () => {
  const subject = friend();
  const start = Date.UTC(2026, 6, 28, 1);
  applyRelationshipEvent(subject, "personal_share", start);
  const repeated = applyRelationshipEvent(subject, "personal_share", start + 60 * 60 * 1000);
  assert.equal(subject.relationship.closeness, 49);
  assert.equal(subject.relationship.trust, 53);
  assert.equal(repeated.closenessChange, 0);
  assert.equal(repeated.trustChange, 0);
});

test("positive score movement is capped per day", () => {
  const subject = friend();
  const start = Date.UTC(2026, 6, 28, 1);
  applyRelationshipEvent(subject, "personal_share", start);
  applyRelationshipEvent(subject, "appreciation", start + 60 * 60 * 1000);
  applyRelationshipEvent(subject, "shared_fun", start + 2 * 60 * 60 * 1000);
  assert.equal(subject.relationship.closeness, 50);
  assert.equal(subject.relationship.trust, 54);
});

test("unknown model events are neutral", () => {
  const subject = friend();
  const result = applyRelationshipEvent(subject, "made_up_event", Date.UTC(2026, 6, 28, 1));
  assert.equal(result.event, "ordinary");
  assert.equal(subject.relationship.closeness, 48);
  assert.equal(subject.relationship.trust, 52);
});

test("negative movement is also capped per day", () => {
  const subject = friend();
  const start = Date.UTC(2026, 6, 28, 1);
  applyRelationshipEvent(subject, "conflict", start);
  applyRelationshipEvent(subject, "conflict", start + 60 * 60 * 1000);
  applyRelationshipEvent(subject, "conflict", start + 2 * 60 * 60 * 1000);
  assert.equal(subject.relationship.closeness, 46);
  assert.equal(subject.relationship.trust, 50);
});

test("relationship stage is derived from both scores", () => {
  assert.equal(relationshipStage({ closeness: 48, trust: 52 }).key, "warming_up");
  assert.equal(relationshipStage({ closeness: 90, trust: 80 }).key, "very_close");
});

test("manual relationship scores are rounded and clamped", () => {
  assert.equal(clampScore("76.6", 48), 77);
  assert.equal(clampScore(-10, 48), 0);
  assert.equal(clampScore(120, 48), 100);
  assert.equal(clampScore("not-a-number", 48), 48);
});
