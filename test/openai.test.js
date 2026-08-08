const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeUsage, requestOpenAI } = require("../src/main/openai");

function apiResponse(outputText, usage, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ output_text: outputText, usage }),
    text: async () => outputText
  };
}

test("OpenAI usage normalization preserves cache and reasoning details", () => {
  assert.deepEqual(normalizeUsage({
    input_tokens: 100,
    output_tokens: 20,
    total_tokens: 120,
    input_tokens_details: { cached_tokens: 60, cache_write_tokens: 10 },
    output_tokens_details: { reasoning_tokens: 4 }
  }), {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    cachedTokens: 60,
    cacheWriteTokens: 10,
    reasoningTokens: 4
  });
});

test("an invalid first response is retried and both requests are counted", async () => {
  const responses = [
    apiResponse("not json", { input_tokens: 10, output_tokens: 2, total_tokens: 12 }),
    apiResponse('{"messages":["응"]}', { input_tokens: 11, output_tokens: 3, total_tokens: 14 })
  ];
  const invalidAttempts = [];
  let waits = 0;
  const result = await requestOpenAI({
    apiKey: "test-key",
    body: { model: "test" },
    fetchImpl: async () => responses.shift(),
    waitForRetry: async () => { waits += 1; },
    onInvalidResponse: (_error, attempt) => invalidAttempts.push(attempt)
  });

  assert.deepEqual(result.reply, { messages: ["응"] });
  assert.deepEqual(result.usage, {
    inputTokens: 21,
    outputTokens: 5,
    totalTokens: 26,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    requestCount: 2
  });
  assert.deepEqual(invalidAttempts, [1]);
  assert.equal(waits, 1);
});

test("usage from two billed invalid responses is attached to the final error", async () => {
  const responses = [
    apiResponse("broken", { input_tokens: 30, output_tokens: 4, total_tokens: 34 }),
    apiResponse("still broken", { input_tokens: 31, output_tokens: 5, total_tokens: 36 })
  ];
  let failure;
  try {
    await requestOpenAI({
      apiKey: "test-key",
      body: { model: "test" },
      fetchImpl: async () => responses.shift()
    });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure);
  assert.deepEqual(failure.usage, {
    inputTokens: 61,
    outputTokens: 9,
    totalTokens: 70,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    requestCount: 2
  });
});

test("usage already spent before a final HTTP failure is retained", async () => {
  const responses = [
    apiResponse("broken", { input_tokens: 40, output_tokens: 6, total_tokens: 46 }),
    apiResponse("server error", null, 500)
  ];
  await assert.rejects(
    requestOpenAI({
      apiKey: "test-key",
      body: { model: "test" },
      fetchImpl: async () => responses.shift()
    }),
    (error) => {
      assert.equal(error.status, 500);
      assert.equal(error.usage.totalTokens, 46);
      assert.equal(error.usage.requestCount, 2);
      return true;
    }
  );
});

test("aborting during an invalid-response retry keeps already billed usage", async () => {
  const abortError = new Error("Aborted");
  abortError.name = "AbortError";
  await assert.rejects(
    requestOpenAI({
      apiKey: "test-key",
      body: { model: "test" },
      fetchImpl: async () =>
        apiResponse("broken", { input_tokens: 50, output_tokens: 7, total_tokens: 57 }),
      waitForRetry: async () => { throw abortError; }
    }),
    (error) => {
      assert.equal(error.name, "AbortError");
      assert.equal(error.usage.totalTokens, 57);
      assert.equal(error.usage.requestCount, 1);
      return true;
    }
  );
});
