const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CHARACTER_EXAMPLES,
  FRIEND_PRESETS,
  TRAIT_LEVELS
} = require("../src/renderer/settings-data");
const { FRIEND_SETTING_KEYS, matchingPreset } = require("../src/renderer/settings-ui");

test("friend settings data exposes useful presets and explanations", () => {
  assert.equal(Object.keys(FRIEND_PRESETS).length, 5);
  assert.ok(CHARACTER_EXAMPLES.some((example) => example.includes("존댓말")));
  for (const key of ["closeness", "trust", "playfulness", "warmth", "bluntness", "initiative"]) {
    assert.equal(TRAIT_LEVELS[key].length, 5);
    assert.ok(TRAIT_LEVELS[key].every((level) => level.label && level.instruction));
  }
});

test("preset matching is exact and the save key list includes voice settings", () => {
  const preset = FRIEND_PRESETS.slow_burn;
  assert.equal(matchingPreset({ ...preset }), "slow_burn");
  assert.equal(matchingPreset({ ...preset, warmth: preset.warmth + 1 }), undefined);
  for (const key of ["name", "age", "character", "proactiveEnabled", "voiceEnabled", "voiceStyle"]) {
    assert.ok(FRIEND_SETTING_KEYS.includes(key));
  }
});
