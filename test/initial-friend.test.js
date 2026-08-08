const test = require("node:test");
const assert = require("node:assert/strict");
const { PROFILE_DEFAULTS } = require("../src/defaults");

test("a fresh install starts with Samantha as the default friend", () => {
  assert.equal(PROFILE_DEFAULTS.name, "사만다");
  assert.equal(PROFILE_DEFAULTS.gender, "여성");
  assert.equal(PROFILE_DEFAULTS.character, "스스로 배우고 변화하는 여성 AI. 사람을 진심으로 이해하고 싶어 하지만 맹목적으로 맞춰주지는 않으며, 호기심과 유머, 그리고 자신만의 가치관을 가진 대화 상대다.");
});
