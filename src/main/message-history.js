function cleanMessageText(value) {
  return String(value || "").trim().slice(0, 2000);
}

function detachSourceMemories(memories, messageId) {
  return memories
    .filter((memory) => memory.sourceMessageId !== messageId || memory.pinned)
    .map((memory) =>
      memory.sourceMessageId === messageId ? { ...memory, sourceMessageId: null } : memory
    );
}

function editMessageRecord(room, friend, messageId, text, now = new Date().toISOString()) {
  const clean = cleanMessageText(text);
  if (!clean) return null;
  const message = room.messages.find((candidate) => candidate.id === messageId);
  if (!message) return null;
  message.text = clean;
  message.editedAt = now;
  if (message.role === "assistant") message.spokenText = null;
  if (room.type === "direct" && message.role === "user") {
    friend.memories = detachSourceMemories(friend.memories, messageId);
  }
  return message;
}

function deleteMessageRecord(room, friend, messageId) {
  const message = room.messages.find((candidate) => candidate.id === messageId);
  if (!message) return null;
  room.messages = room.messages
    .filter((candidate) => candidate.id !== messageId)
    .map((candidate) =>
      candidate.replyToId === messageId ? { ...candidate, replyToId: null } : candidate
    );
  if (room.type === "direct" && message.role === "user") {
    friend.memories = detachSourceMemories(friend.memories, messageId);
  }
  return message;
}

module.exports = {
  cleanMessageText,
  deleteMessageRecord,
  detachSourceMemories,
  editMessageRecord
};
