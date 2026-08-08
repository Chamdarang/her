const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_UNANSWERED_TURNS,
  livePromptState,
  nextLiveDelayMs
} = require("../src/live-conversation");

test("통화형 대화는 질문 뒤 침묵보다 자연스러운 이어 말하기를 더 빨리 시작한다", () => {
  assert.equal(nextLiveDelayMs({ expectsReply: false }), 7000);
  assert.equal(nextLiveDelayMs({ expectsReply: true }), 12000);
});

test("무응답이 반복될수록 다음 반응을 더 오래 기다린다", () => {
  assert.equal(nextLiveDelayMs({ unansweredTurns: 1 }), 18000);
  assert.equal(nextLiveDelayMs({ unansweredTurns: 2 }), 30000);
  assert.equal(MAX_UNANSWERED_TURNS, 3);
});

test("프롬프트용 침묵 시간을 안전하게 계산한다", () => {
  assert.deepEqual(
    livePromptState(
      { lastSpokenAt: "2026-08-08T00:00:00.000Z", unansweredTurns: 2 },
      Date.parse("2026-08-08T00:00:21.000Z")
    ),
    { reason: "silence", silenceSeconds: 21, unansweredTurns: 2 }
  );
});
