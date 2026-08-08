const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { APP_DEFAULTS } = require("../src/defaults");

const root = path.join(__dirname, "..");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const stateModule = fs.readFileSync(path.join(root, "src", "main", "state.js"), "utf8");
const schedulerModule = fs.readFileSync(path.join(root, "src", "main", "scheduler.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
const renderer = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "src", "index.html"), "utf8");
const player = fs.readFileSync(path.join(root, "src", "voice-player.js"), "utf8");

test("automatic voice defaults to focused-window playback and stops on blur", () => {
  assert.equal(APP_DEFAULTS.playVoiceInBackground, false);
  assert.match(main, /playVoiceInBackground \|\| mainWindow\.isFocused\(\)/);
  assert.match(main, /mainWindow\.on\("blur"/);
  assert.match(preload, /onStopAutoVoice/);
  assert.match(renderer, /window\.her\.onStopAutoVoice/);
});

test("legacy focused-only voice settings migrate without changing behavior", () => {
  assert.match(stateModule, /function normalizeAppSettings/);
  assert.match(stateModule, /normalized\.playVoiceInBackground = !Boolean\(raw\.autoVoiceOnlyWhenFocused\)/);
  assert.match(html, /name="playVoiceInBackground"/);
});

test("tray mute and private notification previews are available", () => {
  assert.equal(APP_DEFAULTS.voiceMuted, false);
  assert.equal(APP_DEFAULTS.showNotificationPreview, true);
  assert.match(main, /label: "자동 음성 음소거"/);
  assert.match(main, /showNotificationPreview/);
  assert.match(html, /name="showNotificationPreview"/);
});

test("proactive work is spread after quiet hours and system resume", () => {
  assert.match(schedulerModule, /function quietHoursState/);
  assert.match(main, /reason: "quiet_hours"/);
  assert.match(main, /function spreadOverdueWorkAfterResume/);
  assert.match(main, /deferOverdueWorkAfterResume\(state, now/);
  assert.match(main, /now - lastTickAt <= 30 \* 1000/);
  assert.match(main, /!proactiveGenerationInFlight/);
});

test("nudge state is visible without opening diagnostic logs", () => {
  assert.match(html, /id="nudgeStatus"/);
  assert.match(renderer, /function formatNudgeStatus/);
  assert.match(main, /setNudgeStatus\(friend, "generating"/);
  assert.match(main, /setNudgeStatus\(friend, "delivered"/);
  assert.match(main, /setNudgeStatus\(friend, "failed"/);
});

test("automatic playback fades in instead of starting at full volume", () => {
  assert.match(player, /fadeInSeconds \?\? 0\.18/);
  assert.match(player, /linearRampToValueAtTime/);
});

test("live conversation respects focused-window audio and remains ephemeral", () => {
  assert.match(main, /function startLiveConversation\(/);
  assert.match(main, /function stopLiveConversation\(/);
  assert.match(main, /stopLiveConversation\("window_inactive"\)/);
  assert.match(main, /MAX_UNANSWERED_TURNS/);
  assert.match(preload, /live-conversation:toggle/);
  assert.doesNotMatch(stateModule, /liveConversationSession/);
});
