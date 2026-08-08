const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { APP_DEFAULTS } = require("../src/defaults");
const { liveRequestContext } = require("../src/prompt");

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const preload = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf8");
const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");
const chatView = fs.readFileSync(
  path.join(__dirname, "..", "src", "renderer", "chat-view.js"),
  "utf8"
);
const html = fs.readFileSync(path.join(__dirname, "..", "src", "index.html"), "utf8");

test("room IPC and group settings are exposed through the sandbox bridge", () => {
  for (const channel of ["room:select", "room:create", "room:update", "room:delete"]) {
    assert.match(main, new RegExp(`"${channel}"`));
  }
  for (const method of ["selectRoom", "createRoom", "updateRoom", "deleteRoom"]) {
    assert.match(preload, new RegExp(`\\b${method}:`));
  }
  assert.match(html, /id="groupSettingsForm"/);
  assert.match(renderer, /name="participantIds"/);
  assert.match(renderer, /participantIds\.length < 2 \|\| participantIds\.length > 6/);
});

test("group messages retain speaker identity and use a shared sequential voice queue", () => {
  assert.match(main, /senderId: friend\.baseFriendId \|\| friend\.id/);
  assert.match(main, /friendName: speaker\.profile\.name/);
  assert.match(chatView, /previous\.senderId !== message\.senderId/);
  assert.match(chatView, /message\.senderName \|\| friendName/);
  assert.match(renderer, /new window\.SequentialAudioQueue/);
});

test("autonomous group chats default to Luna and are configured only in the group form", () => {
  assert.equal(APP_DEFAULTS.autonomousModel, "gpt-5.6-luna");
  assert.match(html, /name="autonomousModel"/);
  assert.equal((html.match(/name="autonomousEnabled"/g) || []).length, 1);
  assert.doesNotMatch(renderer, /friendForm\.elements\.autonomousEnabled/);
  assert.match(main, /if \(room\.type !== "group"\) return;/);
  assert.match(main, /source === "autonomous"/);
  assert.match(main, /state\.appSettings\.autonomousModel \|\| "gpt-5\.6-luna"/);
});

test("autonomous group prompt responds as one participant without impersonating others", () => {
  const friend = {
    profile: {
      name: "서윤",
      gender: "여성",
      speechStyle: "casual",
      romanceAllowed: false,
      character: "장난기 많은 친구",
      playfulness: 70,
      warmth: 50,
      bluntness: 60,
      initiative: 70,
      voiceEnabled: false
    },
    relationship: { closeness: 50, trust: 50, mood: "평범함" },
    memories: [],
    messages: [{ role: "assistant", senderName: "지훈", text: "오늘 뭐 먹지?" }],
    autonomousRequest: true,
    conversationRoom: { type: "group", name: "저녁팟" },
    groupParticipantNames: ["서윤", "지훈"]
  };
  const prompt = liveRequestContext("proactive", friend, new Date("2026-08-02T12:00:00+09:00"));
  assert.match(prompt, /사용자가 말하지 않아도 이어지는 단체 대화/);
  assert.match(prompt, /너는 서윤 한 명으로만 말한다/);
  assert.match(prompt, /지훈/);
});

test("turn scheduling pauses for typing and group bursts take a short conversational interval", () => {
  assert.match(main, /if \(userIsTyping\) \{\s*scheduleRoomTurn\(room, 2000, source\)/);
  assert.match(main, /Date\.now\(\) \+ 3500 \+ Math\.random\(\) \* 7500/);
  assert.match(main, /scheduleNextAutonomousTurn\(room, true\)/);
  assert.match(main, /item\.source === "group_reply" && item\.replyMetadata/);
  assert.match(main, /item\.source === "autonomous" && item\.replyMetadata/);
});
