const test = require("node:test");
const assert = require("node:assert/strict");
const {
  STATE_VERSION,
  createInitialState,
  modernStateFromLoaded,
  normalizeAppSettings
} = require("../src/main/state");

test("legacy provider settings are removed during app settings migration", () => {
  const settings = normalizeAppSettings({
    llmProvider: "ollama",
    ollamaEndpoint: "http://localhost:11434",
    ollamaModel: "qwen",
    ollamaAutonomousModel: "qwen-small",
    model: "gpt-5.6-luna"
  });

  assert.equal(settings.model, "gpt-5.6-luna");
  assert.equal("llmProvider" in settings, false);
  assert.equal("ollamaEndpoint" in settings, false);
  assert.equal("ollamaModel" in settings, false);
  assert.equal("ollamaAutonomousModel" in settings, false);
});

test("message history editing stays opt-in during state migration", () => {
  assert.equal(normalizeAppSettings({}).messageHistoryEditingEnabled, false);
  assert.equal(normalizeAppSettings({ messageHistoryEditingEnabled: "true" }).messageHistoryEditingEnabled, false);
  assert.equal(normalizeAppSettings({ messageHistoryEditingEnabled: true }).messageHistoryEditingEnabled, true);
});

test("user profile is normalized as shared app settings", () => {
  const settings = normalizeAppSettings({
    userName: "  민수  ",
    userGender: "남성",
    userAge: 999,
    userDescription: "  게임과 영화를 좋아한다.  "
  });
  assert.equal(settings.userName, "민수");
  assert.equal(settings.userGender, "남성");
  assert.equal(settings.userAge, 120);
  assert.equal(settings.userDescription, "게임과 영화를 좋아한다.");
});

test("legacy per-friend user name migrates to the shared user profile", () => {
  const state = modernStateFromLoaded({
    appSettings: {},
    friends: [{ id: "friend-1", profile: { name: "사만다", userName: "테오도르" } }],
    activeFriendId: "friend-1"
  }, () => "generated");
  assert.equal(state.appSettings.userName, "테오도르");
  assert.equal("userName" in state.friends[0].profile, false);
});

test("legacy focused-only voice setting keeps the same behavior", () => {
  assert.equal(normalizeAppSettings({ autoVoiceOnlyWhenFocused: true }).playVoiceInBackground, false);
  assert.equal(normalizeAppSettings({ autoVoiceOnlyWhenFocused: false }).playVoiceInBackground, true);
  assert.equal(
    normalizeAppSettings({ autoVoiceOnlyWhenFocused: true, playVoiceInBackground: true })
      .playVoiceInBackground,
    true
  );
});

test("initial state has a Samantha friend and independent usage buckets", () => {
  const state = createInitialState(() => "friend-1");

  assert.equal(state.version, STATE_VERSION);
  assert.equal(state.activeFriendId, "friend-1");
  assert.equal(state.friends[0].profile.name, "사만다");
  assert.equal(state.friends[0].profile.gender, "여성");
  assert.deepEqual(state.usage.byDay, {});
  assert.deepEqual(state.usage.byFriend, {});
});

test("modern state migration normalizes friends and ignores obsolete local usage", () => {
  let nextId = 0;
  const state = modernStateFromLoaded(
    {
      friends: [{ id: "existing", profile: { name: "유진" }, messages: [] }],
      activeFriendId: "missing",
      usage: { totalTokens: 12 },
      localUsage: { totalTokens: 999 }
    },
    () => `generated-${++nextId}`
  );

  assert.equal(state.activeFriendId, "existing");
  assert.equal(state.usage.totalTokens, 12);
  assert.equal("localUsage" in state, false);
});

test("friend age is bounded and removed gender values migrate safely", () => {
  const state = modernStateFromLoaded(
    {
      version: STATE_VERSION,
      appSettings: { userGender: "논바이너리" },
      friends: [{
        id: "friend-1",
        profile: { name: "민", gender: "논바이너리", age: 999 },
        messages: [],
        memories: []
      }],
      activeFriendId: "friend-1",
      usage: {}
    },
    () => "generated"
  );

  assert.equal(state.friends[0].profile.gender, "설정하지 않음");
  assert.equal(state.friends[0].profile.age, 120);
  assert.equal(state.appSettings.userGender, "설정하지 않음");
});
