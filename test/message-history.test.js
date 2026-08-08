const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { APP_DEFAULTS } = require("../src/defaults");
const {
  cleanMessageText,
  deleteMessageRecord,
  editMessageRecord
} = require("../src/main/message-history");

const root = path.join(__dirname, "..");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "src", "index.html"), "utf8");

test("message history editing is opt-in in both UI and IPC", () => {
  assert.equal(APP_DEFAULTS.messageHistoryEditingEnabled, false);
  assert.match(html, /name="messageHistoryEditingEnabled"/);
  assert.match(html, /기본값은 꺼짐/);
  assert.match(preload, /message:update/);
  assert.match(main, /if \(!state\.appSettings\.messageHistoryEditingEnabled\)/);
  assert.match(app, /historyEditingEnabled: Boolean\(state\.settings\.messageHistoryEditingEnabled\)/);
});

test("edited user messages are trimmed and invalidate grounded memories", () => {
  const room = {
    type: "direct",
    messages: [{ id: "user-1", role: "user", text: "이전 내용" }]
  };
  const friend = {
    memories: [
      { id: "memory-1", sourceMessageId: "user-1", pinned: false },
      { id: "memory-2", sourceMessageId: "user-1", pinned: true }
    ]
  };
  const edited = editMessageRecord(
    room,
    friend,
    "user-1",
    "  수정한 내용  ",
    "2026-08-08T00:00:00.000Z"
  );
  assert.equal(edited.text, "수정한 내용");
  assert.equal(edited.editedAt, "2026-08-08T00:00:00.000Z");
  assert.deepEqual(friend.memories, [
    { id: "memory-2", sourceMessageId: null, pinned: true }
  ]);
  assert.equal(cleanMessageText("   "), "");
});

test("editing an assistant message removes its stale spoken text", () => {
  const room = {
    type: "direct",
    messages: [{
      id: "assistant-1",
      role: "assistant",
      text: "원래 답장",
      spokenText: "元の返事"
    }]
  };
  const friend = { memories: [] };
  const edited = editMessageRecord(room, friend, "assistant-1", "바꾼 답장");
  assert.equal(edited.text, "바꾼 답장");
  assert.equal(edited.spokenText, null);
});

test("deleting either role also detaches replies to the removed message", () => {
  const room = {
    type: "group",
    messages: [
      { id: "assistant-1", role: "assistant", text: "삭제할 말" },
      { id: "user-1", role: "user", text: "답장", replyToId: "assistant-1" }
    ]
  };
  const friend = { memories: [] };
  assert.equal(deleteMessageRecord(room, friend, "assistant-1").role, "assistant");
  assert.equal(room.messages.length, 1);
  assert.equal(room.messages[0].replyToId, null);
});
