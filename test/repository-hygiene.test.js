const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const packageJson = require("../package.json");
const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");

test("repository ignores local secrets, generated logs, backups, and model data", () => {
  for (const pattern of ["node_modules/", "sbv2-data/", "dist/", ".env", "*.jsonl", "HER-backup-*.json"]) {
    assert.match(gitignore, new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(gitignore, /!\.env\.example/);
  assert.doesNotMatch(envExample, /sk-[a-z0-9_-]{12,}/i);
});

test("desktop package cannot be accidentally published to npm", () => {
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.engines.node, ">=22.12.0");
  assert.ok(packageJson.build.files.includes("!assets/icon_old.png"));
  assert.ok(packageJson.build.files.includes("!assets/tray-icon.png"));
});
