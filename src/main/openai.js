function extractResponseText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") return content.text;
    }
  }
  throw new Error("AI 응답에서 텍스트를 찾지 못했습니다.");
}

function normalizeUsage(raw = {}) {
  const inputTokens = Number(raw.input_tokens ?? raw.prompt_tokens ?? 0);
  const outputTokens = Number(raw.output_tokens ?? raw.completion_tokens ?? 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: Number(raw.total_tokens ?? inputTokens + outputTokens),
    cachedTokens: Number(raw.input_tokens_details?.cached_tokens ?? 0),
    cacheWriteTokens: Number(raw.input_tokens_details?.cache_write_tokens ?? 0),
    reasoningTokens: Number(raw.output_tokens_details?.reasoning_tokens ?? 0)
  };
}

function addUsage(target, usage) {
  for (const key of Object.keys(target)) target[key] += Number(usage[key] || 0);
}

function attachUsage(error, accumulatedUsage, requestCount) {
  const wrapped = error instanceof Error ? error : new Error(String(error));
  wrapped.usage = { ...accumulatedUsage, requestCount };
  return wrapped;
}

async function requestOpenAI({
  apiKey,
  body,
  signal,
  fetchImpl = fetch,
  waitForRetry = async () => {},
  onInvalidResponse = () => {}
}) {
  const accumulatedUsage = normalizeUsage();
  let requestCount = 0;
  const pauseBeforeRetry = async () => {
    try {
      await waitForRetry(signal);
    } catch (error) {
      throw attachUsage(error, accumulatedUsage, requestCount);
    }
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    requestCount += 1;
    let response;
    try {
      response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });
    } catch (error) {
      throw attachUsage(error, accumulatedUsage, requestCount);
    }

    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.text();
      } catch {}
      const retryable = response.status === 429 || response.status >= 500;
      if (attempt === 0 && retryable) {
        await pauseBeforeRetry();
        continue;
      }
      const error = new Error(`OpenAI API 오류 (${response.status}): ${detail.slice(0, 240)}`);
      error.status = response.status;
      error.retryable = retryable;
      throw attachUsage(error, accumulatedUsage, requestCount);
    }

    try {
      const payload = await response.json();
      addUsage(accumulatedUsage, normalizeUsage(payload.usage));
      return {
        reply: JSON.parse(extractResponseText(payload)),
        usage: { ...accumulatedUsage, requestCount }
      };
    } catch (error) {
      try {
        onInvalidResponse(error, attempt + 1);
      } catch {}
      if (attempt === 0) {
        await pauseBeforeRetry();
        continue;
      }
      throw attachUsage(error, accumulatedUsage, requestCount);
    }
  }

  throw attachUsage(new Error("AI 응답을 처리하지 못했어."), accumulatedUsage, requestCount);
}

module.exports = { extractResponseText, normalizeUsage, requestOpenAI };
