const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeStoredUsage } = require("../src/main/state");
const { periodKeys, recordUsageInStore, tokenBudgetMessage } = require("../src/main/usage");

test("usage is accumulated in totals, periods, and friend buckets", () => {
  const store = normalizeStoredUsage();
  const createdAt = "2026-08-02T12:00:00.000Z";
  const usage = {
    inputTokens: 1000,
    outputTokens: 100,
    totalTokens: 1100,
    cachedTokens: 200,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    requestCount: 1
  };

  assert.equal(
    recordUsageInStore(store, usage, {
      model: "gpt-5.6-luna",
      friendId: "friend-1",
      mode: "proactive",
      createdAt
    }),
    true
  );

  const { day, month } = periodKeys(createdAt);
  assert.equal(store.totalTokens, 1100);
  assert.equal(store.requestCount, 1);
  assert.equal(store.byDay[day].proactiveTokens, 1100);
  assert.equal(store.byMonth[month].totalTokens, 1100);
  assert.equal(store.byFriend["friend-1"].totalTokens, 1100);
  assert.equal(store.last.model, "gpt-5.6-luna");
  assert.equal(store.estimatedCostUsd, 0.000284);
});

test("token budgets distinguish monthly and proactive limits", () => {
  const now = "2026-08-02T12:00:00.000Z";
  const { day, month } = periodKeys(now);
  const usage = normalizeStoredUsage({
    byDay: { [day]: { proactiveTokens: 500 } },
    byMonth: { [month]: { totalTokens: 1000 } }
  });

  assert.match(tokenBudgetMessage(usage, { monthlyTokenLimit: 1000 }, "reply", now), /월간/);
  assert.match(
    tokenBudgetMessage(
      usage,
      { monthlyTokenLimit: 2000, proactiveDailyTokenLimit: 500 },
      "proactive",
      now
    ),
    /자동 대화/
  );
  assert.equal(
    tokenBudgetMessage(
      usage,
      { monthlyTokenLimit: 2000, proactiveDailyTokenLimit: 1000 },
      "reply",
      now
    ),
    null
  );
});
