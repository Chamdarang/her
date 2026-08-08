const GPT_56_PRICES_PER_MILLION = {
  "gpt-5.6-sol": { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 30 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2 }
};

function modelPrice(model) {
  if (model === "gpt-5.6") return GPT_56_PRICES_PER_MILLION["gpt-5.6-sol"];
  const key = Object.keys(GPT_56_PRICES_PER_MILLION).find((candidate) =>
    model === candidate || String(model || "").startsWith(`${candidate}-`)
  );
  return key ? GPT_56_PRICES_PER_MILLION[key] : null;
}

function estimateUsageCost(usage, model) {
  const price = modelPrice(model);
  if (!price) return null;
  const cached = Math.max(0, Number(usage.cachedTokens || 0));
  const cacheWrite = Math.max(0, Number(usage.cacheWriteTokens || 0));
  const standardInput = Math.max(
    0,
    Number(usage.inputTokens || 0) - cached - cacheWrite
  );
  const output = Math.max(0, Number(usage.outputTokens || 0));
  return (
    standardInput * price.input +
    cached * price.cachedInput +
    cacheWrite * price.cacheWrite +
    output * price.output
  ) / 1_000_000;
}

module.exports = {
  GPT_56_PRICES_PER_MILLION,
  estimateUsageCost,
  modelPrice
};
