const test = require("node:test");
const assert = require("node:assert/strict");
const {
  GPT_56_PRICES_PER_MILLION,
  estimateUsageCost
} = require("../src/cost");

test("uses current GPT-5.6 standard and cache prices", () => {
  assert.deepEqual(GPT_56_PRICES_PER_MILLION, {
    "gpt-5.6-sol": { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 30 },
    "gpt-5.6-terra": { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 12 },
    "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2 }
  });
});

test("estimates GPT-5.6 Luna standard token cost", () => {
  const cost = estimateUsageCost(
    {
      inputTokens: 1000,
      outputTokens: 100,
      cachedTokens: 0,
      cacheWriteTokens: 0
    },
    "gpt-5.6-luna"
  );
  assert.equal(cost, 0.00032);
});

test("applies cache read discount and cache write premium", () => {
  const cost = estimateUsageCost(
    {
      inputTokens: 2000,
      outputTokens: 0,
      cachedTokens: 1000,
      cacheWriteTokens: 1000
    },
    "gpt-5.6-luna"
  );
  assert.equal(cost, 0.00027);
});

test("does not invent prices for custom models", () => {
  assert.equal(
    estimateUsageCost(
      { inputTokens: 1000, outputTokens: 100, cachedTokens: 0, cacheWriteTokens: 0 },
      "custom-model"
    ),
    null
  );
  assert.equal(
    estimateUsageCost(
      { inputTokens: 1000, outputTokens: 100, cachedTokens: 0, cacheWriteTokens: 0 },
      "gpt-5.6-lunatic"
    ),
    null
  );
});
