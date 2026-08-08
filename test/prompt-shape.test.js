const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mainSource = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const defaultsSource = fs.readFileSync(path.join(__dirname, "..", "src", "defaults.js"), "utf8");
const promptSource = fs.readFileSync(path.join(__dirname, "..", "src", "prompt.js"), "utf8");
const openaiSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "main", "openai.js"),
  "utf8"
);
const source = `${mainSource}\n${defaultsSource}\n${promptSource}\n${openaiSource}`;

test("the AI contract no longer includes activity generation", () => {
  const requestContract = promptSource;

  assert.doesNotMatch(requestContract, /activityDurationMinutes/);
  assert.doesNotMatch(requestContract, /currentActivity/);
  assert.doesNotMatch(requestContract, /\bactivity\s*:/);
});

test("only stable friend settings are placed before the cache breakpoint", () => {
  const stableStart = promptSource.indexOf("function stableFriendContext");
  const liveStart = promptSource.indexOf("function liveRequestContext");
  const stableContext = promptSource.slice(stableStart, liveStart);

  assert.doesNotMatch(stableContext, /recentConversation/);
  assert.match(source, /text:\s*stableFriendContext\(friend, userProfile\)/);
  assert.match(source, /stableBlock\.prompt_cache_breakpoint/);
});

test("memory output is grounded by source message id without an explicit flag", () => {
  const schemaStart = promptSource.indexOf("const replySchema");
  const schemaEnd = promptSource.indexOf("function responseSchema");
  const schema = promptSource.slice(schemaStart, schemaEnd);

  assert.match(schema, /sourceMessageId/);
  assert.doesNotMatch(schema, /explicit:\s*\{\s*type:/);
});

test("speech style is explicit and automatic mode respects Korean age context", () => {
  assert.match(source, /speechStyle:\s*"auto"/);
  assert.match(source, /profile\.speechStyle === "casual"/);
  assert.match(source, /profile\.speechStyle === "polite"/);
  assert.match(source, /친구가 사용자보다 어리면 존댓말/);
  assert.match(source, /말투=\$\{speechStyleInstruction\(profile\)\}/);
});

test("specific character description outranks generic personality hints", () => {
  assert.match(source, /\[캐릭터 핵심\]/);
  assert.match(source, /보조 성향 지침·일반적인 친구상보다 우선/);
  assert.match(source, /\[보조 성향 지침\]/);
  assert.match(source, /personalityGuidance\(profile\)/);
  assert.match(source, /relationshipGuidance\(relationship\)/);
  assert.doesNotMatch(source, /장난기=\$\{profile\.playfulness\}/);
});

test("shared user profile is included in the stable prompt without becoming friend identity", () => {
  const { userProfileContext } = require("../src/prompt");
  const context = userProfileContext({
    userName: "민수",
    userGender: "남성",
    userAge: 29,
    userDescription: "게임과 영화를 좋아한다."
  });
  assert.match(context, /이름=민수; 성별=남성; 나이=29세/);
  assert.match(context, /게임과 영화를 좋아한다/);
  assert.match(promptSource, /\[사용자 프로필\]/);
  assert.match(promptSource, /친구 자신의 성격이나 과거로 착각하지 않는다/);
  assert.match(mainSource, /userProfile: state\.appSettings/);
});

test("voice output stays short and uses pronounceable laughter", () => {
  assert.match(promptSource, /한국어 120자 안쪽/);
  assert.match(promptSource, /90자 이내/);
  assert.match(promptSource, /단독 笑나 메타 표기 （笑）/);
  assert.match(promptSource, /笑う·笑顔처럼 문장 의미에 필요한 일반 단어/);
  assert.match(promptSource, /ふふ·はは·あはは/);
  assert.match(promptSource, /body\.text\.verbosity = "low"/);
});

test("Japanese voice output pairs display and spoken text inside each bubble", () => {
  assert.match(promptSource, /모든 말풍선은 너 한 명이 같은 상대에게 연속해서 보내는 한 번의 답장/);
  assert.match(promptSource, /서로 다른 사람처럼 문답하지 않는다/);
  assert.match(promptSource, /messages의 각 항목은 하나의 말풍선/);
  assert.match(promptSource, /displayText/);
  assert.match(promptSource, /spokenText/);
  assert.match(promptSource, /required: \["displayText", "spokenText"\]/);
  const schemaStart = promptSource.indexOf("function responseSchema");
  const schemaEnd = promptSource.indexOf("function buildOpenAIRequestBody");
  const schemaSource = promptSource.slice(schemaStart, schemaEnd);
  assert.doesNotMatch(schemaSource, /spokenMessages:/);
});

test("structured output enforces message lengths with supported string patterns", () => {
  assert.match(promptSource, /pattern: "\^\[\^\\\\r\\\\n\]\{1,120\}\$"/);
  assert.match(promptSource, /pattern: "\^\[\^\\\\r\\\\n\]\{1,90\}\$"/);
  assert.match(mainSource, /generation_response_invalid/);
  assert.match(openaiSource, /requestCount/);
});

test("live conversation prompt treats slow replies naturally without repeated pressure", () => {
  const { liveRequestContext, responseSchema } = require("../src/prompt");
  const friend = {
    id: "friend-live",
    profile: { name: "사만다", voiceEnabled: false },
    relationship: { closeness: 50, trust: 50, mood: "평범함" },
    memories: [],
    messages: [],
    liveConversationRequest: { silenceSeconds: 18, unansweredTurns: 1 }
  };
  const context = liveRequestContext("proactive", friend, new Date("2026-08-08T00:00:00Z"));
  assert.match(context, /통화형 연속 대화 중/);
  assert.match(context, /연속 무응답=1회/);
  assert.match(context, /같은 질문을 되풀이하지 않는다/);
  assert.equal(responseSchema(friend, 2).properties.messages.maxItems, 2);
});
