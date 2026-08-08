const APP_DEFAULTS = {
  keepInTray: true,
  launchAtLogin: false,
  playVoiceInBackground: false,
  voiceMuted: false,
  showNotificationPreview: true,
  messageHistoryEditingEnabled: false,
  userName: "",
  userGender: "설정하지 않음",
  userAge: 0,
  userDescription: "",
  quietStart: "01:00",
  quietEnd: "09:00",
  model: "gpt-5.6-sol",
  autonomousModel: "gpt-5.6-luna",
  monthlyTokenLimit: 0,
  proactiveDailyTokenLimit: 5000,
  maxOutputTokens: 700,
  sbv2Endpoint: "http://127.0.0.1:5000"
};

const PROFILE_DEFAULTS = {
  name: "사만다",
  gender: "여성",
  character:
    "스스로 배우고 변화하는 여성 AI. 사람을 진심으로 이해하고 싶어 하지만 맹목적으로 맞춰주지는 않으며, 호기심과 유머, 그리고 자신만의 가치관을 가진 대화 상대다.",
  romanceAllowed: false,
  proactiveEnabled: true,
  initiative: 70,
  playfulness: 70,
  warmth: 50,
  bluntness: 70,
  replyPace: "natural",
  speechStyle: "auto",
  voiceEnabled: false,
  voiceAutoPlay: false,
  voiceRevealAfterSynthesis: false,
  ambientVoiceEnabled: false,
  ambientVoiceFrequency: "normal",
  ambientContinueUnanswered: true,
  ambientMaxConsecutive: 3,
  ambientSaveTranscript: true,
  voiceLanguage: "ja",
  voiceModelId: 0,
  voiceSpeakerId: 0,
  voiceStyle: "Neutral",
  voiceStyleWeight: 1,
  voiceLength: 1
};

const RELATIONSHIP_DEFAULTS = { closeness: 50, trust: 50, mood: "평범함" };

const USAGE_DEFAULTS = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalTokens: 0,
  totalCachedTokens: 0,
  totalCacheWriteTokens: 0,
  totalReasoningTokens: 0,
  estimatedCostUsd: 0,
  requestCount: 0,
  last: null,
  byDay: {},
  byMonth: {},
  byFriend: {}
};

module.exports = { APP_DEFAULTS, PROFILE_DEFAULTS, RELATIONSHIP_DEFAULTS, USAGE_DEFAULTS };
