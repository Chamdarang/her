(function exposeChatView(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HerChatView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function initials(name) {
    return (name || "?").trim().slice(0, 1);
  }

  function formatTime(iso) {
    return new Intl.DateTimeFormat("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(iso));
  }

  function dateKey(iso) {
    return new Date(iso).toLocaleDateString("ko-KR");
  }

  function formatDate(iso) {
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short"
    }).format(new Date(iso));
  }

  function messageRenderKey({
    activeRoomId,
    searchQuery,
    messages,
    loadingVoiceIds,
    playingVoiceId,
    historyEditingEnabled
  }) {
    return JSON.stringify([
      activeRoomId,
      searchQuery,
      historyEditingEnabled,
      messages.map((message) => [
        message.id,
        message.text,
        message.role,
        message.senderId,
        message.senderName,
        message.createdAt,
        message.editedAt,
        message.readAt,
        message.replyToId,
        message.proactive,
        message.reactions,
        message.spokenText,
        loadingVoiceIds.has(message.id),
        playingVoiceId === message.id
      ])
    ]);
  }

  function renderMessagesHtml({
    messages,
    searchQuery,
    friendName,
    loadingVoiceIds,
    playingVoiceId,
    historyEditingEnabled
  }) {
    const visibleMessages = searchQuery
      ? messages.filter((message) =>
          message.text.toLocaleLowerCase("ko-KR").includes(searchQuery)
        )
      : messages;
    let previousDate = null;
    const html = visibleMessages.length
      ? visibleMessages.map((message, index) => {
          const previous = visibleMessages[index - 1];
          const currentDate = dateKey(message.createdAt);
          const separator = currentDate !== previousDate
            ? `<div class="date-separator">${escapeHtml(formatDate(message.createdAt))}</div>`
            : "";
          previousDate = currentDate;
          const startGroup =
            !previous ||
            previous.role !== message.role ||
            previous.senderId !== message.senderId ||
            new Date(message.createdAt) - new Date(previous.createdAt) > 5 * 60 * 1000;
          const meta = startGroup && message.role === "assistant"
            ? `<div class="message-meta">${escapeHtml(message.senderName || friendName)}${message.proactive ? " · 먼저 보냄" : ""}</div>`
            : "";
          const unread = message.role === "user" && !message.readAt
            ? `<span class="unread-count" title="친구가 아직 안 읽음">1</span>`
            : "";
          const quoted = message.replyToId
            ? messages.find((candidate) => candidate.id === message.replyToId)
            : null;
          const quote = quoted
            ? `<div class="quoted-message">${escapeHtml(quoted.text)}</div>`
            : "";
          const reactionButtons = message.role === "assistant"
            ? ["heart", "laugh", "like"].map((reaction) => {
                const labels = { heart: "♥", laugh: "ㅋㅋ", like: "👍" };
                const names = { heart: "하트", laugh: "웃음", like: "좋아요" };
                return `<button class="${message.reactions?.[reaction] ? "active" : ""}" data-action="react" data-reaction="${reaction}" data-message-id="${escapeHtml(message.id)}" aria-label="${names[reaction]} 반응">${labels[reaction]}</button>`;
              }).join("")
            : "";
          const historyButtons = historyEditingEnabled
            ? `<button data-action="edit" data-message-id="${escapeHtml(message.id)}" title="수정" aria-label="메시지 수정">✎</button>
               <button data-action="delete" data-message-id="${escapeHtml(message.id)}" title="삭제" aria-label="메시지 삭제">×</button>`
            : "";
          const loading = loadingVoiceIds.has(message.id);
          const playing = playingVoiceId === message.id;
          const voiceButton = message.role === "assistant" && message.spokenText
            ? `<button class="voice-button ${loading ? "loading" : ""} ${playing ? "active" : ""}" data-action="voice" data-message-id="${escapeHtml(message.id)}" title="${playing ? "음성 정지" : "음성 재생"}" aria-label="${playing ? "음성 정지" : "음성 재생"}">${loading ? "…" : playing ? "■" : "▶"}</button>`
            : "";
          return `
            ${separator}
            <div class="message-group ${message.role}" data-message-id="${escapeHtml(message.id)}">
              ${meta}${quote}
              <div class="message-shell">
                <div class="bubble">${escapeHtml(message.text)}</div>
                <div class="message-actions">
                  <button data-action="reply" data-message-id="${escapeHtml(message.id)}" title="답장" aria-label="이 메시지에 답장">↩</button>
                  ${voiceButton}
                  ${historyButtons}
                </div>
              </div>
              ${reactionButtons ? `<div class="message-reactions">${reactionButtons}</div>` : ""}
              <div class="message-footer">${unread}<span class="time">${formatTime(message.createdAt)}${message.editedAt ? " · 수정됨" : ""}</span></div>
            </div>
          `;
        }).join("")
      : searchQuery
        ? `<div class="search-empty">일치하는 메시지가 없어.</div>`
        : "";
    return { html, visibleMatches: visibleMessages.length };
  }

  function renderRoomsHtml(rooms, activeRoomId) {
    return rooms.map((room) => {
      const last = room.lastMessage;
      const preview = last?.text || "아직 대화를 시작하지 않았어";
      const time = last ? formatTime(last.createdAt) : "";
      const unread = room.unreadCount
        ? `<span class="unread-badge">${room.unreadCount > 99 ? "99+" : room.unreadCount}</span>`
        : `<span>${time}</span>`;
      return `
        <button class="room-card ${room.id === activeRoomId ? "active" : ""}" data-room-id="${escapeHtml(room.id)}">
          <div class="avatar">${room.type === "group" ? "#" : escapeHtml(initials(room.name))}</div>
          <div class="room-card-copy">
            <div class="room-row">
              <strong>${escapeHtml(room.name)}</strong>
              ${unread}
            </div>
            <p>${room.type === "group" ? `${room.participantNames.length}명 · ${room.autonomousEnabled ? "자율 대화 · " : ""}` : ""}${escapeHtml(preview)}</p>
          </div>
        </button>
      `;
    }).join("");
  }

  return { messageRenderKey, renderMessagesHtml, renderRoomsHtml };
});
