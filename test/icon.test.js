const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const start = fs.readFileSync(path.join(__dirname, "..", "scripts", "start.js"), "utf8");
const packageJson = require("../package.json");

test("the same HER icon is used by the window, tray, and Windows package", () => {
  assert.equal(packageJson.build.win.icon, "assets/icon.ico");
  assert.match(main, /const APP_ICON = path\.join\(__dirname, "assets", "icon\.ico"\)/);
  assert.match(main, /icon: APP_ICON/);
  assert.match(main, /show: false/);
  assert.match(main, /mainWindow\.setIcon\(windowIcon\)/);
  assert.match(main, /mainWindow\.setAppDetails\(\{/);
  assert.match(main, /appIconPath: process\.execPath/);
  assert.match(main, /mainWindow\.once\("ready-to-show"/);
  assert.match(main, /app\.setAppUserModelId\(APP_ID\)/);
  assert.equal(fs.existsSync(path.join(__dirname, "..", "assets", "icon.png")), true);
  assert.equal(fs.existsSync(path.join(__dirname, "..", "assets", "icon.ico")), true);
});

test("npm start uses a HER-branded development executable", () => {
  assert.equal(packageJson.scripts.start, "node scripts/start.js");
  assert.match(start, /HER-development\.exe/);
  assert.match(start, /"--set-icon"/);
});

test("Windows auto-start points at the packaged HER executable, never electron.exe", () => {
  assert.match(main, /process\.platform !== "win32" \|\| !app\.isPackaged/);
  assert.match(main, /syncLoginItemSettings\(state\.appSettings\.launchAtLogin\)/);
  assert.doesNotMatch(main, /app\.getAppPath\(\), "--hidden"/);
});
