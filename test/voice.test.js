const test = require("node:test");
const assert = require("node:assert/strict");

const {
  modelOptions,
  normalizeEndpoint,
  sanitizeJapaneseSpokenText,
  splitVoiceText,
  styleDisplayName,
  voiceDeliveryReady,
  voiceUrl,
  waitsForVoice
} = require("../src/voice");

test("Japanese speech removes meta laughter without changing ordinary words", () => {
  assert.equal(
    sanitizeJapaneseSpokenText("面白いね （笑） 次も見よう 笑"),
    "面白いね ふふ 次も見よう ふふ"
  );
  assert.equal(sanitizeJapaneseSpokenText("笑うと笑顔になる"), "笑うと笑顔になる");
  assert.equal(sanitizeJapaneseSpokenText("それなㅋㅋ"), "それなふふ");
});

test("SBV2 endpoint only accepts a local server", () => {
  assert.equal(normalizeEndpoint("http://127.0.0.1:5000/"), "http://127.0.0.1:5000");
  assert.equal(normalizeEndpoint("http://localhost:5000"), "http://localhost:5000");
  assert.throws(() => normalizeEndpoint("https://example.com"), /localhost/);
});

test("long SBV2 text is split without dropping any characters", () => {
  const text = "첫 번째로 충분히 긴 문장입니다。두 번째 문장도 그대로 남아야 합니다！마지막 문장입니다。";
  const chunks = splitVoiceText(text, 18);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => Array.from(chunk).length <= 18));
  assert.equal(chunks.join(""), text);
});

test("SBV2 voice request uses the official query parameters", () => {
  const url = voiceUrl("http://127.0.0.1:5000", {
    voiceModelId: 2,
    voiceSpeakerId: 3,
    voiceLanguage: "ja",
    voiceLength: 1.15,
    voiceStyle: "Happy",
    voiceStyleWeight: 2
  }, "こんにちは");
  assert.equal(url.pathname, "/voice");
  assert.equal(url.searchParams.get("text"), "こんにちは");
  assert.equal(url.searchParams.get("model_id"), "2");
  assert.equal(url.searchParams.get("speaker_id"), "3");
  assert.equal(url.searchParams.get("language"), "JP");
  assert.equal(url.searchParams.get("style"), "Happy");
  assert.equal(url.searchParams.get("length"), "1.15");
});

test("installed SBV2 model metadata becomes UI options", () => {
  const options = modelOptions({
    0: {
      model_path: "model_assets/Seoyun/model.safetensors",
      spk2id: { seoyun: 0 },
      style2id: { Neutral: 0, Happy: 1 }
    }
  });
  assert.deepEqual(options, [{
    id: 0,
    name: "Seoyun",
    displayName: "seoyun",
    speakers: [{ id: 0, name: "seoyun" }],
    styles: ["Neutral", "Happy"],
    styleLabels: { Neutral: "Neutral", Happy: "Happy" }
  }]);
});

test("Koharune Ami Japanese styles get Korean display labels without changing values", () => {
  assert.equal(styleDisplayName("るんるん"), "신남 (るんるん)");
  assert.equal(styleDisplayName("ささやきA（無声）"), "무성 속삭임 A (ささやきA)");
  assert.equal(styleDisplayName("ささやきB（有声）"), "유성 속삭임 B (ささやきB)");
  assert.equal(styleDisplayName("ノーマル"), "보통 (ノーマル)");
  assert.equal(styleDisplayName("よふかし"), "늦은 밤 (よふかし)");
  assert.equal(styleDisplayName("Neutral"), "Neutral");
});

test("JVNV internal model names are shown as Korean voice labels", () => {
  const [option] = modelOptions({
    3: {
      model_path: "/models/jvnv-M1-jp/model.safetensors",
      spk2id: { "jvnv-M1-jp": 0 },
      style2id: { Neutral: 0 }
    }
  });
  assert.equal(option.displayName, "JVNV 남성 화자 1");
});

test("known Japanese speaker models use Korean voice labels", () => {
  const options = modelOptions({
    0: { model_path: "/models/amitaro/a.safetensors", spk2id: { "あみたろ": 0 } },
    5: { model_path: "/models/koharune-ami/k.safetensors", spk2id: { "小春音アミ": 0 } }
  });
  assert.deepEqual(options.map((item) => item.displayName), ["아미타로", "코하루네 아미"]);
});

test("chat delivery can wait until local voice synthesis finishes", () => {
  const profile = { voiceEnabled: true, voiceRevealAfterSynthesis: true };
  const pending = { spokenText: "こんにちは" };
  assert.equal(waitsForVoice(profile, pending), true);
  assert.equal(voiceDeliveryReady(profile, pending), false);
  assert.equal(voiceDeliveryReady(profile, { ...pending, voiceReady: true }), true);
  assert.equal(voiceDeliveryReady(profile, { ...pending, voiceError: "offline" }), true);
  assert.equal(voiceDeliveryReady({ ...profile, voiceEnabled: false }, pending), true);
});
