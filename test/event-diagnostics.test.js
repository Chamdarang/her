const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { appendEventDiagnostic } = require("../src/event-diagnostics");
const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "src", "index.html"), "utf8");

test("conversation event diagnostics store structured stages without requiring message text", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "her-event-log-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = appendEventDiagnostic(directory, {
    event: "generation_completed",
    friendId: "friend-1",
    source: "test",
    bubbleCount: 2,
    durationMs: 1234
  });
  const entry = JSON.parse(fs.readFileSync(target, "utf8").trim());
  assert.equal(entry.event, "generation_completed");
  assert.equal(entry.friendId, "friend-1");
  assert.equal(entry.bubbleCount, 2);
  assert.equal(Object.hasOwn(entry, "text"), false);
});

test("generation completion reads token counts from the OpenAI result", () => {
  assert.match(main, /inputTokens: result\.usage\?\.inputTokens \?\? null/);
  assert.match(main, /outputTokens: result\.usage\?\.outputTokens \?\? null/);
  assert.doesNotMatch(main, /inputTokens: usage\?\./);
});

test("successful and failed generations record OpenAI usage once", () => {
  assert.match(main, /recordUsage\(result\.usage, requestModel,[\s\S]*?usageRecorded = Boolean\(result\.usage\);/);
  assert.match(main, /if \(!usageRecorded && error\.usage\) \{[\s\S]*?recordUsage\(error\.usage, requestModel,/);
});

test("nudge tests log every important stage and return visible status", () => {
  for (const event of [
    "nudge_test_requested",
    "nudge_test_blocked",
    "generation_started",
    "generation_completed",
    "reply_queued",
    "reply_delivered",
    "generation_failed",
    "nudge_test_finished"
  ]) {
    assert.match(main, new RegExp(`"${event}"`));
  }
  assert.match(renderer, /선톡 만드는 중…/);
  assert.match(renderer, /result\.status/);
  assert.match(html, /id="openEventDiagnosticsButton"/);
});

test("a failed nudge test always releases its own button lock", () => {
  assert.match(renderer, /finally \{\s*nudgeTestInFlight = false;\s*button\.textContent = "선톡 테스트";\s*render\(\);/);
  assert.match(renderer, /const nudgeAllowed = state\.room\?\.type === "group" \|\| settings\.proactiveEnabled/);
  assert.match(renderer, /!nudgeAllowed \|\| nudgeTestInFlight/);
  assert.doesNotMatch(renderer, /!nudgeAllowed \|\| thinking \|\| nudgeTestInFlight/);
});
