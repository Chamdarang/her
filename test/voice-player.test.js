const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizationGain } = require("../src/voice-player");

test("quiet voice clips are amplified toward a consistent level", () => {
  const gain = normalizationGain([Float32Array.from([0, 0.02, -0.02, 0.03, -0.03])]);
  assert.ok(gain > 1);
  assert.ok(gain <= 4);
});

test("loud voice clips are attenuated without exceeding the peak ceiling", () => {
  const gain = normalizationGain([Float32Array.from([0.7, -0.8, 0.9, -0.75])]);
  assert.ok(gain < 1);
  assert.ok(gain * 0.9 <= 0.92);
});
