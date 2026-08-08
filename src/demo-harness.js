(() => {
  if (window.her) return;

  const now = Date.now();
  let mockState = {
    version: 5,
    activeRoomId: "demo-room",
    activeFriendId: "demo-friend",
    friends: [
      {
        id: "demo-friend",
        name: "서윤",
        gender: "여성",
        relationship: "친한 친구",
        proactiveEnabled: true,
        unreadCount: 0,
        mood: "평범함",
        lastMessage: {
          id: "demo-3",
          role: "assistant",
          text: "그래서 결국 라면 먹은 거야?",
          createdAt: new Date(now - 2 * 60000).toISOString()
        }
      },
      {
        id: "demo-friend-2",
        name: "지훈",
        gender: "남성",
        proactiveEnabled: true,
        unreadCount: 0,
        mood: "평범함",
        lastMessage: null
      }
    ],
    rooms: [
      {
        id: "demo-room",
        type: "direct",
        name: "서윤",
        participantIds: ["demo-friend"],
        participantNames: ["서윤"],
        autonomousEnabled: false,
        unreadCount: 0,
        lastMessage: {
          id: "demo-3",
          role: "assistant",
          text: "그래서 결국 라면 먹은 거야?",
          createdAt: new Date(now - 2 * 60000).toISOString()
        }
      },
      {
        id: "demo-room-2",
        type: "direct",
        name: "지훈",
        participantIds: ["demo-friend-2"],
        participantNames: ["지훈"],
        autonomousEnabled: false,
        unreadCount: 0,
        lastMessage: null
      }
    ],
    room: {
      id: "demo-room",
      type: "direct",
      name: "서윤",
      participantIds: ["demo-friend"],
      participantNames: ["서윤"],
      autonomousEnabled: false,
      autonomousFrequency: "normal",
      autonomousMaxTurns: 6,
      autonomousTurnCount: 0
    },
    settings: {
      name: "서윤",
      gender: "여성",
      relationship: "친한 친구",
      character: "오래 알고 지낸 편한 친구",
      playfulness: 72,
      warmth: 52,
      bluntness: 64,
      initiative: 62,
      replyPace: "natural",
      speechStyle: "auto",
      romanceAllowed: false,
      proactiveEnabled: true,
      model: "gpt-5.6-sol",
      autonomousModel: "gpt-5.6-luna",
      monthlyTokenLimit: 100000,
      proactiveDailyTokenLimit: 5000,
      maxOutputTokens: 700,
      keepInTray: true,
      launchAtLogin: false,
      messageHistoryEditingEnabled: false,
      userName: "민수",
      userGender: "남성",
      userAge: 29,
      userDescription: "게임과 영화, 매운 음식을 좋아한다.",
      quietStart: "01:00",
      quietEnd: "09:00",
      hasApiKey: true
    },
    relationship: {
      closeness: 58,
      trust: 61,
      mood: "장난스러움",
      stage: { key: "warming_up", label: "조금 친해진 사이" }
    },
    memories: [
      {
        id: "memory-1",
        category: "preference",
        text: "매운 라면을 좋아함",
        sourceMessageId: "demo-1",
        pinned: true,
        createdAt: new Date(now - 86400000).toISOString(),
        updatedAt: new Date(now - 86400000).toISOString()
      }
    ],
    messages: [
      {
        id: "demo-1",
        role: "user",
        text: "오늘은 진짜 매운 라면 먹고 싶다",
        createdAt: new Date(now - 8 * 60000).toISOString(),
        readAt: new Date(now - 7 * 60000).toISOString(),
        reactions: {}
      },
      {
        id: "demo-2",
        role: "assistant",
        text: "또 매운 거ㅋㅋ",
        createdAt: new Date(now - 6 * 60000).toISOString(),
        reactions: { laugh: true }
      },
      {
        id: "demo-3",
        role: "assistant",
        text: "그래서 결국 라면 먹은 거야?",
        createdAt: new Date(now - 2 * 60000).toISOString(),
        reactions: {}
      }
    ],
    pending: [],
    liveConversation: { active: false },
    error: null,
    usage: {
      totalInputTokens: 12480,
      totalOutputTokens: 2180,
      totalTokens: 14660,
      totalCachedTokens: 2048,
      totalCacheWriteTokens: 1024,
      totalReasoningTokens: 0,
      estimatedCostUsd: 0.0284,
      requestCount: 9,
      byDay: {
        [new Date().toISOString().slice(0, 10)]: {
          totalTokens: 2400,
          proactiveTokens: 620
        }
      },
      byMonth: {
        [new Date().toISOString().slice(0, 7)]: { totalTokens: 14660 }
      },
      byFriend: { "demo-friend": { totalTokens: 14660 } },
      last: null
    }
  };
  const stateListeners = [];
  const emit = () => stateListeners.forEach((listener) => listener(structuredClone(mockState)));
  const result = async () => structuredClone(mockState);

  window.her = {
    getState: result,
    saveSettings: async (settings) => {
      mockState.settings = { ...mockState.settings, ...settings };
      emit();
      return result();
    },
    clearApiKey: result,
    resetUsage: result,
    createFriend: result,
    selectFriend: result,
    selectRoom: async (roomId) => {
      const room = mockState.rooms.find((item) => item.id === roomId);
      if (room) {
        mockState.activeRoomId = room.id;
        mockState.activeFriendId = room.participantIds[0];
        mockState.room = { ...room, autonomousFrequency: room.autonomousFrequency || "normal", autonomousMaxTurns: room.autonomousMaxTurns || 6 };
      }
      emit();
      return result();
    },
    createRoom: async (room) => {
      const id = `demo-room-${Date.now()}`;
      mockState.rooms.push({
        id,
        type: "group",
        name: room.name || "새 단톡",
        participantIds: room.participantIds,
        participantNames: mockState.friends
          .filter((friend) => room.participantIds.includes(friend.id))
          .map((friend) => friend.name),
        autonomousEnabled: Boolean(room.autonomousEnabled),
        unreadCount: 0,
        lastMessage: null
      });
      mockState.activeRoomId = id;
      mockState.room = mockState.rooms.at(-1);
      mockState.messages = [];
      emit();
      return result();
    },
    updateRoom: async (_roomId, changes) => {
      Object.assign(mockState.room, changes);
      Object.assign(
        mockState.rooms.find((room) => room.id === mockState.activeRoomId),
        changes
      );
      emit();
      return result();
    },
    deleteRoom: result,
    deleteFriend: result,
    sendMessage: async ({ text, replyToId }) => {
      mockState.messages.push({
        id: `demo-${Date.now()}`,
        role: "user",
        text,
        replyToId,
        createdAt: new Date().toISOString(),
        readAt: null,
        reactions: {}
      });
      emit();
      return result();
    },
    reactToMessage: async (messageId, reaction) => {
      const message = mockState.messages.find((item) => item.id === messageId);
      message.reactions[reaction] = !message.reactions[reaction];
      emit();
      return result();
    },
    updateMessage: async (messageId, text) => {
      const message = mockState.messages.find((item) => item.id === messageId);
      if (message) Object.assign(message, { text, editedAt: new Date().toISOString(), spokenText: null });
      emit();
      return result();
    },
    deleteMessage: async (messageId) => {
      mockState.messages = mockState.messages.filter((item) => item.id !== messageId);
      emit();
      return result();
    },
    retryMessage: result,
    createMemory: async (memory) => {
      mockState.memories.push({
        id: `memory-${Date.now()}`,
        category: memory.category,
        text: memory.text,
        sourceMessageId: null,
        pinned: Boolean(memory.pinned),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      emit();
      return result();
    },
    updateMemory: async (memoryId, changes) => {
      const memory = mockState.memories.find((item) => item.id === memoryId);
      Object.assign(memory, changes);
      emit();
      return result();
    },
    deleteMemory: async (memoryId) => {
      mockState.memories = mockState.memories.filter((item) => item.id !== memoryId);
      emit();
      return result();
    },
    setTyping: async () => true,
    getVoiceModels: async () => [],
    synthesizeVoice: async () => {
      throw new Error("데모 화면에서는 로컬 음성을 재생할 수 없어.");
    },
    reportVoicePlayback: async () => true,
    previewVoice: async () => {
      throw new Error("데모 화면에서는 로컬 음성을 미리 들을 수 없어.");
    },
    openVoiceDiagnostics: async () => true,
    openEventDiagnostics: async () => true,
    triggerNudge: async () => ({
      state: await result(),
      status: "queued",
      message: "선톡을 만들었어. 잠시 후 전달할게."
    }),
    toggleLiveConversation: async () => {
      mockState.liveConversation = mockState.liveConversation.active
        ? { active: false, roomId: mockState.activeRoomId, reason: "manual", stoppedAt: new Date().toISOString() }
        : {
            active: true,
            roomId: mockState.activeRoomId,
            friendId: mockState.activeFriendId,
            status: "waiting",
            nextTurnAt: new Date(Date.now() + 12000).toISOString(),
            unansweredTurns: 0,
            startedAt: new Date().toISOString()
          };
      emit();
      return result();
    },
    clearConversation: result,
    exportBackup: async () => ({ canceled: true }),
    importBackup: result,
    minimize: async () => true,
    close: async () => true,
    onState: (callback) => {
      stateListeners.push(callback);
      return () => {};
    },
    onAutoVoice: () => () => {},
    onStopAutoVoice: () => () => {},
    onThinking: () => () => {}
  };
})();
