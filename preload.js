const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("her", {
  getState: () => ipcRenderer.invoke("state:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  clearApiKey: () => ipcRenderer.invoke("api-key:clear"),
  resetUsage: () => ipcRenderer.invoke("usage:reset"),
  createFriend: (profile) => ipcRenderer.invoke("friend:create", profile),
  selectFriend: (friendId) => ipcRenderer.invoke("friend:select", friendId),
  selectRoom: (roomId) => ipcRenderer.invoke("room:select", roomId),
  createRoom: (room) => ipcRenderer.invoke("room:create", room),
  updateRoom: (roomId, room) => ipcRenderer.invoke("room:update", roomId, room),
  deleteRoom: (roomId) => ipcRenderer.invoke("room:delete", roomId),
  deleteFriend: (friendId) => ipcRenderer.invoke("friend:delete", friendId),
  sendMessage: (payload) => ipcRenderer.invoke("message:send", payload),
  reactToMessage: (messageId, reaction) =>
    ipcRenderer.invoke("message:react", messageId, reaction),
  updateMessage: (messageId, text) => ipcRenderer.invoke("message:update", messageId, text),
  deleteMessage: (messageId) => ipcRenderer.invoke("message:delete", messageId),
  retryMessage: () => ipcRenderer.invoke("message:retry"),
  createMemory: (memory) => ipcRenderer.invoke("memory:create", memory),
  updateMemory: (memoryId, changes) =>
    ipcRenderer.invoke("memory:update", memoryId, changes),
  deleteMemory: (memoryId) => ipcRenderer.invoke("memory:delete", memoryId),
  setTyping: (isTyping) => ipcRenderer.invoke("typing:set", Boolean(isTyping)),
  triggerNudge: () => ipcRenderer.invoke("nudge:trigger"),
  toggleLiveConversation: () => ipcRenderer.invoke("live-conversation:toggle"),
  getVoiceModels: () => ipcRenderer.invoke("voice:models"),
  synthesizeVoice: (messageId) => ipcRenderer.invoke("voice:synthesize", messageId),
  reportVoicePlayback: (details) => ipcRenderer.invoke("voice:playback:event", details),
  previewVoice: (profile) => ipcRenderer.invoke("voice:preview", profile),
  openVoiceDiagnostics: () => ipcRenderer.invoke("voice:diagnostics:open"),
  openEventDiagnostics: () => ipcRenderer.invoke("events:diagnostics:open"),
  clearConversation: () => ipcRenderer.invoke("conversation:clear"),
  exportBackup: () => ipcRenderer.invoke("backup:export"),
  importBackup: () => ipcRenderer.invoke("backup:import"),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  close: () => ipcRenderer.invoke("window:close"),
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("state:changed", handler);
    return () => ipcRenderer.removeListener("state:changed", handler);
  },
  onAutoVoice: (callback) => {
    const handler = (_event, delivery) => callback(delivery);
    ipcRenderer.on("voice:auto-deliver", handler);
    return () => ipcRenderer.removeListener("voice:auto-deliver", handler);
  },
  onStopAutoVoice: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("voice:auto-stop", handler);
    return () => ipcRenderer.removeListener("voice:auto-stop", handler);
  },
  onThinking: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on("thinking:changed", handler);
    return () => ipcRenderer.removeListener("thinking:changed", handler);
  }
});
