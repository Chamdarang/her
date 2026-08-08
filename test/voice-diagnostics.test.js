const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { appendVoiceDiagnostic } = require("../src/voice-diagnostics");
const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");

test("voice diagnostics preserve display and spoken text locally", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "her-voice-log-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = appendVoiceDiagnostic(directory, {
    event: "synthesis_started",
    displayText: "웃기네 ㅋㅋ",
    spokenText: "面白いね、ふふ"
  });
  const entry = JSON.parse(fs.readFileSync(target, "utf8").trim());
  assert.equal(entry.displayText, "웃기네 ㅋㅋ");
  assert.equal(entry.spokenText, "面白いね、ふふ");
});

test("voice playback logs queue, start, completion, stop, and failure per bubble", () => {
  for (const event of [
    "playback_queued",
    "playback_started",
    "playback_completed",
    "playback_stopped",
    "playback_failed"
  ]) {
    assert.match(`${main}\n${renderer}`, new RegExp(`"${event}"`));
  }
  assert.match(main, /replyBatchIndex/);
  assert.match(main, /replyBatchTotal/);
  assert.match(renderer, /음성 재생 중 \$\{playbackMeta\.batchIndex\}\/\$\{playbackMeta\.batchTotal\}/);
});

test("failed voice preparation falls back to text without an automatic retry", () => {
  assert.match(main, /VOICE_SERVER_HEALTH_TIMEOUT_MS = 3000/);
  assert.match(main, /VOICE_SERVER_FAILURE_TTL_MS = 5000/);
  assert.match(main, /voiceError: item\.voiceError \|\| null/);
  assert.match(main, /item\.spokenText &&\s*!item\.voiceError/s);
  assert.match(renderer, /message\.spokenText &&\s*!message\.voiceError/s);
  assert.match(renderer, /delivery\?\.voiceError/);
});
