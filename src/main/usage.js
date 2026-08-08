const { estimateUsageCost } = require("../cost");

function periodKeys(value = Date.now()) {
  const date = new Date(value);
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
  return { day, month: day.slice(0, 7) };
}

function addUsageToBucket(collection, key, usage, mode) {
  const current = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    proactiveTokens: 0,
    estimatedCostUsd: 0,
    requestCount: 0,
    ...(collection[key] || {})
  };
  current.inputTokens += usage.inputTokens;
  current.outputTokens += usage.outputTokens;
  current.totalTokens += usage.totalTokens;
  current.cachedTokens += usage.cachedTokens;
  current.cacheWriteTokens += usage.cacheWriteTokens;
  current.reasoningTokens += usage.reasoningTokens;
  current.estimatedCostUsd += Number(usage.estimatedCostUsd || 0);
  if (mode === "proactive") current.proactiveTokens += usage.totalTokens;
  current.requestCount += Math.max(1, Number(usage.requestCount || 1));
  collection[key] = current;
}

function recordUsageInStore(target, usage, { model, friendId, mode, createdAt = new Date().toISOString() }) {
  if (!usage) return false;
  const estimatedCostUsd = estimateUsageCost(usage, model);
  const pricedUsage = { ...usage, estimatedCostUsd: estimatedCostUsd || 0 };
  target.totalInputTokens += usage.inputTokens;
  target.totalOutputTokens += usage.outputTokens;
  target.totalTokens += usage.totalTokens;
  target.totalCachedTokens += usage.cachedTokens;
  target.totalCacheWriteTokens += usage.cacheWriteTokens;
  target.totalReasoningTokens += usage.reasoningTokens;
  target.estimatedCostUsd += estimatedCostUsd || 0;
  target.requestCount += Math.max(1, Number(usage.requestCount || 1));
  const { day, month } = periodKeys(createdAt);
  addUsageToBucket(target.byDay, day, pricedUsage, mode);
  addUsageToBucket(target.byMonth, month, pricedUsage, mode);
  addUsageToBucket(target.byFriend, friendId, pricedUsage, mode);
  target.last = {
    ...usage,
    estimatedCostUsd,
    model,
    friendId,
    mode,
    createdAt
  };
  return true;
}

function tokenBudgetMessage(usage, settings, mode, now = Date.now()) {
  const { day, month } = periodKeys(now);
  const monthUsage = usage.byMonth[month]?.totalTokens || 0;
  const dayUsage = usage.byDay[day]?.proactiveTokens || 0;
  const monthlyLimit = Math.max(0, Number(settings.monthlyTokenLimit || 0));
  const proactiveLimit = Math.max(0, Number(settings.proactiveDailyTokenLimit || 0));
  if (monthlyLimit && monthUsage >= monthlyLimit) {
    return "설정한 월간 토큰 한도에 도달했어.";
  }
  if (mode === "proactive" && proactiveLimit && dayUsage >= proactiveLimit) {
    return "오늘 자동 대화 토큰 한도에 도달했어.";
  }
  return null;
}

module.exports = { periodKeys, recordUsageInStore, tokenBudgetMessage };
