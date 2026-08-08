const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("the composer remains clickable above chat overlays", () => {
  const css = read("src/styles.css");
  const composerWrap = css.match(/\.composer-wrap\s*\{([^}]*)\}/)?.[1] || "";
  const textarea = css.match(/\.composer textarea\s*\{([^}]*)\}/)?.[1] || "";
  const newMessageButton = css.match(/\.new-message-button\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(composerWrap, /z-index:\s*5/);
  assert.match(composerWrap, /pointer-events:\s*auto/);
  assert.match(composerWrap, /-webkit-app-region:\s*no-drag/);
  assert.match(textarea, /user-select:\s*text/);
  assert.match(textarea, /-webkit-app-region:\s*no-drag/);
  assert.doesNotMatch(newMessageButton, /position:\s*absolute/);
});

test("Korean IME composition does not submit a partial message", () => {
  const app = read("src/app.js");
  assert.match(app, /event\.isComposing\s*\|\|\s*event\.keyCode\s*===\s*229/);
});

test("window activation never steals focus from the clicked control", () => {
  const main = read("main.js");
  const preload = read("preload.js");
  const app = read("src/app.js");

  const focusHandler = main.slice(
    main.indexOf('mainWindow.on("focus"'),
    main.indexOf('mainWindow.on("blur"')
  );
  assert.doesNotMatch(focusHandler, /webContents\.focus/);
  assert.doesNotMatch(focusHandler, /composer:focus/);
  assert.doesNotMatch(preload, /onComposerFocus/);
  assert.doesNotMatch(app, /window\.her\.onComposerFocus/);
});

test("composer pointer focus is captured early and retried once", () => {
  const app = read("src/app.js");
  assert.match(app, /\.composer-wrap"\)\.addEventListener\(\s*"pointerdown"/);
  assert.match(app, /focusComposer\(true\)/);
  assert.match(app, /document\.activeElement !== refs\.input/);
  assert.match(app, /,\s*true\s*\);/);
  assert.match(app, /if \(!event\.target\.closest\("\.composer-wrap"\)\) clearTimeout\(composerFocusRetry\)/);
});

test("composer focus is only requested by renderer interactions", () => {
  const main = read("main.js");
  const app = read("src/app.js");

  assert.doesNotMatch(main, /composer:focus/);
  assert.doesNotMatch(app, /window\.addEventListener\("focus",\s*\(\) => focusComposer/);
});

test("clearing a conversation restores focus to the composer after closing settings", () => {
  const app = read("src/app.js");
  const clearHandler = app.slice(
    app.indexOf('$("#clearButton").addEventListener'),
    app.indexOf('$("#deleteFriendButton").addEventListener')
  );

  assert.match(app, /options\.restoreFocusTo/);
  assert.match(clearHandler, /closeFriendSettings\(\{ restoreFocusTo: refs\.input \}\)/);
  assert.doesNotMatch(clearHandler, /\bconfirm\(/);
  assert.match(clearHandler, /button\.dataset\.confirming !== "true"/);
  assert.match(clearHandler, /한 번 더 누르면 초기화/);
});

test("unchanged room state does not replace clickable room elements", () => {
  const app = read("src/app.js");
  assert.match(app, /let lastRoomRenderKey = ""/);
  assert.match(app, /if \(nextRenderKey === lastRoomRenderKey\) return/);
});

test("unchanged messages do not rebuild the entire message DOM", () => {
  const app = read("src/app.js");
  const chatView = read("src/renderer/chat-view.js");
  assert.match(chatView, /function messageRenderKey/);
  assert.match(app, /chatView\.messageRenderKey/);
  assert.match(app, /nextRenderKey === lastMessageRenderKey/);
});
