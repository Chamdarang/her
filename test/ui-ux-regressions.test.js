const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");
const settingsUi = fs.readFileSync(
  path.join(__dirname, "..", "src", "renderer", "settings-ui.js"),
  "utf8"
);
const chatView = fs.readFileSync(
  path.join(__dirname, "..", "src", "renderer", "chat-view.js"),
  "utf8"
);
const html = fs.readFileSync(path.join(__dirname, "..", "src", "index.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "src", "styles.css"), "utf8");

test("message search renders only matching messages and has an empty result", () => {
  assert.match(chatView, /const visibleMessages = searchQuery/);
  assert.match(chatView, /일치하는 메시지가 없어/);
  assert.doesNotMatch(chatView, /class="message-group \$\{message\.role\} \$\{matches/);
});

test("dialogs move focus, trap Tab, close on Escape, and restore focus", () => {
  assert.match(app, /function openModal\(/);
  assert.match(app, /function setAppShellInert\(inert\)/);
  assert.match(app, /appShell\.removeAttribute\("inert"\)/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /event\.key !== "Tab"/);
  assert.match(app, /activeModalTrigger/);
});

test("voice-gated replies expose a quiet composer status", () => {
  assert.match(html, /id="voiceSynthesisStatus"[^>]+aria-live="polite"/);
  assert.match(app, /state\.voiceSynthesisStatus/);
  assert.match(app, /음성 합성 중… 답장은 준비되면 표시돼\./);
  assert.match(css, /\.composer-status\s*\{[^}]*pointer-events:\s*none/s);
});

test("modal backdrop avoids compositor-heavy blur over form controls", () => {
  const backdrop = css.match(/\.modal-backdrop\s*\{([^}]*)\}/)?.[1] || "";
  assert.doesNotMatch(backdrop, /backdrop-filter/);
});

test("message actions remain visible to keyboard users", () => {
  assert.match(css, /\.message-group:focus-within \.message-actions/);
  assert.match(chatView, /aria-label="이 메시지에 답장"/);
  assert.match(chatView, /aria-label="메시지 삭제"/);
});

test("failed sends restore the draft and report a friendly error", () => {
  assert.match(app, /if \(!refs\.input\.value\) refs\.input\.value = text/);
  assert.match(app, /editedMessageId \? "메시지를 수정하지 못했어\." : "메시지를 보내지 못했어\."/);
  assert.match(html, /id="toast"[^>]+aria-live="polite"/);
});

test("an empty conversation no longer forces settings open at startup", () => {
  assert.doesNotMatch(app, /if \(!state\.messages\.length\) openFriendSettings\(\)/);
});

test("ambient voice has friend-level controls and can hide transcripts", () => {
  for (const name of [
    "ambientVoiceEnabled",
    "ambientVoiceFrequency",
    "ambientContinueUnanswered",
    "ambientMaxConsecutive",
    "ambientSaveTranscript"
  ]) {
    assert.match(html, new RegExp(`name="${name}"`));
  }
  assert.match(app, /message\.hiddenFromChat/);
  assert.match(app, /sameFriend/);
  assert.match(html, /<b>자동 음성 말걸기<\/b>/);
  assert.match(html, /계속 연결되는 음성 통화 기능은 아니야/);
  assert.match(html, /하루 자동 대화 토큰 한도/);
});

test("the sidebar is a room list with unambiguous friend and group creation", () => {
  assert.match(html, /<h2>대화방<\/h2>/);
  assert.match(html, /id="roomList"[^>]+aria-label="대화방 목록"/);
  assert.match(html, /친구 추가<small>새 친구와 1:1 대화<\/small>/);
  assert.match(html, /단톡 만들기<small>기존 친구 2~6명 선택<\/small>/);
  assert.doesNotMatch(html, /BETWEEN US/);
  assert.doesNotMatch(html, /class="relationship-card"/);
  assert.match(app, /친구를 만들면 그 친구와의 1:1 대화방도 함께 생겨/);
  assert.match(app, /이미 만든 친구를 골라 하나의 새 대화방으로 묶어/);
});

test("OpenAI token usage is a labeled non-interactive number beside the room-list title", () => {
  assert.match(html, /<span>토큰 사용량<\/span>/);
  assert.match(html, /<strong id="usageDisplay">/);
  assert.doesNotMatch(html, /localUsageDisplay/);
  assert.doesNotMatch(html, /id="usageButton"/);
  assert.match(app, /\$\("#usageDisplay"\)\.textContent = compactNumber/);
  assert.doesNotMatch(app, /usageDisplay.*addEventListener/);
  assert.doesNotMatch(app, / tok`/);
});

test("cumulative and latest-request costs are labeled separately", () => {
  assert.match(html, /<small>누적 예상 비용<\/small><strong id="usageCost">/);
  assert.match(app, /\$\("#usageCost"\)\.textContent = formatUsd\(usage\.estimatedCostUsd\)/);
  assert.match(app, /최근 요청 예상 \$\{formatUsd\(usage\.last\.estimatedCostUsd\)\}/);
  assert.doesNotMatch(app, /GPT-5\.6 누적 예상/);
});

test("friend settings separate essentials from optional behavior", () => {
  assert.match(html, /처음엔 이름과 ‘어떤 친구야\?’만 정해도 충분해/);
  assert.match(html, /<b>친구의 기본 설정<\/b>/);
  assert.match(html, /<b>성격과 관계<\/b>/);
  assert.match(html, /id="proactiveSettingsDisclosure"/);
  assert.match(html, /id="voiceSettingsDisclosure"/);
  assert.match(settingsUi, /function updateProactiveControls\(\)/);
  assert.match(settingsUi, /initiative\.disabled = !enabled/);
  assert.match(app, /settings\[key\] \?\? refs\.friendForm\.elements\[key\]\.value/);
});

test("shared user profile is editable from app settings", () => {
  assert.match(html, /<b>내 프로필<\/b>/);
  assert.match(html, /name="userName"/);
  assert.match(html, /name="userGender"/);
  assert.match(html, /name="userAge"/);
  assert.match(html, /name="userDescription"/);
  assert.match(app, /"userName",\s*"userGender",\s*"userAge",\s*"userDescription"/);
});

test("group settings explain and disable autonomous options when off", () => {
  assert.match(html, /id="groupParticipantCount"/);
  assert.match(html, /id="groupAutonomyDisclosure"/);
  assert.match(html, /쉬기 전 최대 발화 수/);
  assert.match(settingsUi, /function updateGroupParticipantCount\(\)/);
  assert.match(settingsUi, /function updateGroupAutonomyControls\(\)/);
  assert.match(settingsUi, /input\.disabled = !enabled/);
});

test("settings keep save actions visible while long forms scroll", () => {
  assert.match(css, /\.modal-actions\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*-1px;/s);
});

test("direct chats expose an explicit live conversation control and status", () => {
  assert.match(html, /id="liveConversationButton"/);
  assert.match(html, /id="liveConversationStatus"[^>]+aria-live="polite"/);
  assert.match(app, /window\.her\.toggleLiveConversation\(\)/);
  assert.match(app, /state\.room\?\.type === "group"/);
  assert.match(css, /\.live-conversation-button\.active/);
});
