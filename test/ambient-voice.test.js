const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PROFILE_DEFAULTS } = require("../src/defaults");

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const prompt = fs.readFileSync(path.join(__dirname, "..", "src", "prompt.js"), "utf8");
const preload = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf8");
const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");

test("ambient voice is opt-in and has conservative defaults", () => {
  assert.equal(PROFILE_DEFAULTS.ambientVoiceEnabled, false);
  assert.equal(PROFILE_DEFAULTS.ambientVoiceFrequency, "normal");
  assert.equal(PROFILE_DEFAULTS.ambientMaxConsecutive, 3);
  assert.equal(PROFILE_DEFAULTS.ambientSaveTranscript, true);
});

test("enabling ambient voice also enables proactive automatic voice playback", () => {
  assert.match(main, /friend\.profile\.ambientVoiceEnabled/);
  assert.match(main, /friend\.profile\.proactiveEnabled = true/);
  assert.match(main, /friend\.profile\.voiceEnabled = true/);
  assert.match(main, /friend\.profile\.voiceAutoPlay = true/);
});

test("ambient-only speech can remain in context without appearing in chat", () => {
  assert.match(main, /hiddenFromChat: ambient && !friend\.profile\.ambientSaveTranscript/);
  assert.match(main, /!message\.hiddenFromChat/);
});

test("ambient scheduling and voice delivery do not depend on the selected friend", () => {
  assert.match(main, /function ambientVoiceActive\(friend\) \{\s*return conversationRoomFor\(friend\)\?\.type !== "group" && ambientVoiceConfigured\(friend\.profile\);\s*\}/);
  assert.doesNotMatch(main, /ambientVoiceConfigured\(friend\) && !ambientVoiceActive\(friend\)/);
  assert.match(main, /backgroundThrottling: false/);
  assert.match(main, /webContents\.send\("voice:auto-deliver"/);
});

test("the renderer accepts background-friend voices through one shared queue", () => {
  assert.match(preload, /onAutoVoice/);
  assert.match(renderer, /window\.her\.onAutoVoice/);
  assert.match(renderer, /queuedAutoVoiceIds/);
  assert.match(renderer, /enqueueAutoVoice\(delivery\)/);
});

test("ambient prompt asks for short non-repetitive companion speech", () => {
  assert.match(prompt, /자동 음성 말걸기 요청이다/);
  assert.match(prompt, /1~2개의 매우 짧은 말풍선/);
  assert.match(prompt, /앞선 무응답 발화를 그대로 반복하지 않는다/);
});
