const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function normalizeEndpoint(value) {
  const raw = String(value || "http://127.0.0.1:5000").trim();
  const parsed = new URL(raw);
  if (!LOOPBACK_HOSTS.has(parsed.hostname) || !["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("SBV2 서버 주소는 이 PC의 localhost 주소만 사용할 수 있어.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function modelOptions(payload) {
  return Object.entries(payload || {}).map(([id, model]) => {
    const name = String(model.model_path || model.config_path || `모델 ${id}`).split(/[\\/]/).slice(-2, -1)[0] || `모델 ${id}`;
    const speakers = Object.entries(model.spk2id || {}).map(([speakerName, speakerId]) => ({
      id: Number(speakerId),
      name: speakerName
    }));
    const friendlyNames = {
      amitaro: "아미타로",
      "jvnv-F1-jp": "JVNV 여성 화자 1",
      "jvnv-F2-jp": "JVNV 여성 화자 2",
      "jvnv-M1-jp": "JVNV 남성 화자 1",
      "jvnv-M2-jp": "JVNV 남성 화자 2",
      "koharune-ami": "코하루네 아미"
    };
    return {
      id: Number(id),
      name,
      displayName: friendlyNames[name] || speakers[0]?.name || name,
      speakers,
      styles: Object.keys(model.style2id || {}),
      styleLabels: Object.fromEntries(
        Object.keys(model.style2id || {}).map((style) => [style, styleDisplayName(style)])
      )
    };
  });
}

function styleDisplayName(style) {
  const labels = {
    "るんるん": "신남 (るんるん)",
    "ささやきA（無声）": "무성 속삭임 A (ささやきA)",
    "ささやきB（有声）": "유성 속삭임 B (ささやきB)",
    "ノーマル": "보통 (ノーマル)",
    "よふかし": "늦은 밤 (よふかし)"
  };
  return labels[style] || style;
}

function voiceUrl(endpoint, profile, text) {
  const url = new URL(`${normalizeEndpoint(endpoint)}/voice`);
  const parameters = {
    text: String(text || "").trim(),
    model_id: Number(profile.voiceModelId || 0),
    speaker_id: Number(profile.voiceSpeakerId || 0),
    language: profile.voiceLanguage === "ko" ? "KR" : "JP",
    length: Math.max(0.5, Math.min(2, Number(profile.voiceLength || 1))),
    style: String(profile.voiceStyle || "Neutral"),
    style_weight: Math.max(0, Math.min(20, Number(profile.voiceStyleWeight || 1)))
  };
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return url;
}

function textLength(value) {
  return Array.from(String(value || "")).length;
}

function splitVoiceText(value, maximumLength = 90) {
  const text = String(value || "").trim();
  if (!text || textLength(text) <= maximumLength) return text ? [text] : [];
  const sentences = text.split(/(?<=[。！？!?…])|\n+/u).map((part) => part.trim()).filter(Boolean);
  const chunks = [];

  const append = (part) => {
    const characters = Array.from(part);
    if (characters.length > maximumLength) {
      for (let index = 0; index < characters.length; index += maximumLength) {
        append(characters.slice(index, index + maximumLength).join(""));
      }
      return;
    }
    const previous = chunks[chunks.length - 1];
    if (previous && textLength(`${previous}${part}`) <= maximumLength) {
      chunks[chunks.length - 1] = `${previous}${part}`;
    } else {
      chunks.push(part);
    }
  };

  for (const sentence of sentences) append(sentence);
  return chunks;
}

function sanitizeJapaneseSpokenText(value) {
  return String(value || "")
    .replace(/[（(]\s*笑\s*[）)]/gu, "ふふ")
    .replace(/(^|[\s、。！？!?])笑(?=$|[\s、。！？!?])/gu, "$1ふふ")
    .replace(/ㅋㅋ+/gu, "ふふ")
    .trim();
}

function waitsForVoice(profile, item) {
  return Boolean(
    profile?.voiceEnabled &&
    profile?.voiceRevealAfterSynthesis &&
    item?.spokenText
  );
}

function voiceDeliveryReady(profile, item) {
  return !waitsForVoice(profile, item) || Boolean(item.voiceReady || item.voiceError);
}

module.exports = {
  modelOptions,
  normalizeEndpoint,
  sanitizeJapaneseSpokenText,
  splitVoiceText,
  styleDisplayName,
  voiceDeliveryReady,
  voiceUrl,
  waitsForVoice
};
