const test = require("node:test");
const assert = require("node:assert/strict");
const {
  messageRenderKey,
  renderMessagesHtml,
  renderRoomsHtml
} = require("../src/renderer/chat-view");

test("message rendering escapes content and preserves chat actions", () => {
  const messages = [{
    id: "message-1",
    role: "assistant",
    text: "<script>안녕</script>",
    senderName: "사만다",
    createdAt: "2026-08-03T12:00:00.000Z",
    readAt: null,
    reactions: {},
    spokenText: "こんにちは"
  }];
  const rendered = renderMessagesHtml({
    messages,
    searchQuery: "",
    friendName: "사만다",
    loadingVoiceIds: new Set(),
    playingVoiceId: null
  });
  assert.equal(rendered.visibleMatches, 1);
  assert.match(rendered.html, /&lt;script&gt;안녕&lt;\/script&gt;/);
  assert.match(rendered.html, /data-action="reply"/);
  assert.match(rendered.html, /data-action="voice"/);
  assert.doesNotMatch(rendered.html, /<script>/);
});

test("message search has a dedicated empty state", () => {
  const rendered = renderMessagesHtml({
    messages: [{
      id: "message-1",
      role: "user",
      text: "안녕",
      createdAt: "2026-08-03T12:00:00.000Z",
      reactions: {}
    }],
    searchQuery: "없는말",
    friendName: "사만다",
    loadingVoiceIds: new Set(),
    playingVoiceId: null
  });
  assert.equal(rendered.visibleMatches, 0);
  assert.match(rendered.html, /일치하는 메시지가 없어/);
});

test("render keys include voice state and room lists escape names", () => {
  const base = {
    activeRoomId: "room-1",
    searchQuery: "",
    messages: [{ id: "message-1" }],
    loadingVoiceIds: new Set(),
    playingVoiceId: null
  };
  assert.notEqual(messageRenderKey(base), messageRenderKey({ ...base, playingVoiceId: "message-1" }));
  const html = renderRoomsHtml([{
    id: "room-1",
    name: "<친구>",
    type: "direct",
    participantNames: ["친구"],
    unreadCount: 2,
    lastMessage: null
  }], "room-1");
  assert.match(html, /&lt;친구&gt;/);
  assert.match(html, /unread-badge/);
});

test("history actions are hidden by default and shown only when enabled", () => {
  const input = {
    messages: [{
      id: "message-1",
      role: "assistant",
      text: "안녕",
      createdAt: "2026-08-03T12:00:00.000Z",
      reactions: {}
    }],
    searchQuery: "",
    friendName: "사만다",
    loadingVoiceIds: new Set(),
    playingVoiceId: null
  };
  const disabled = renderMessagesHtml(input).html;
  const enabled = renderMessagesHtml({ ...input, historyEditingEnabled: true }).html;
  assert.doesNotMatch(disabled, /data-action="edit"/);
  assert.doesNotMatch(disabled, /data-action="delete"/);
  assert.match(enabled, /data-action="edit"/);
  assert.match(enabled, /data-action="delete"/);
});
