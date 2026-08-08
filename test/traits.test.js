const test = require("node:test");
const assert = require("node:assert/strict");
const {
  nearestTraitLevel,
  personalityGuidance,
  relationshipGuidance
} = require("../src/traits");

test("numeric legacy traits become concrete behavioral guidance", () => {
  assert.equal(nearestTraitLevel("playfulness", 72).label, "많음");
  assert.match(
    personalityGuidance({ playfulness: 72, warmth: 52, bluntness: 64, initiative: 62 }),
    /티키타카와 가벼운 놀림을 자주 섞는다/
  );
  assert.match(
    relationshipGuidance({ closeness: 90, trust: 30 }),
    /오래 알고 지낸 사람처럼 편하며.*개인적인 이야기에는 신중하게 반응/
  );
});
