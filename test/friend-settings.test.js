const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("free-form relationship name is removed in favor of character context", () => {
  const html = read("src/index.html");
  const app = read("src/app.js");
  const main = read("main.js");

  assert.doesNotMatch(html, /name="relationship"/);
  assert.doesNotMatch(html, /id="relationshipLabel"/);
  assert.doesNotMatch(app, /"relationship",/);
  assert.doesNotMatch(main, /관계=\$\{s\.relationship\}/);
  assert.match(html, /알게 된 계기, 나이 차이, 현재 말투/);
});

test("closeness and trust are editable and included in saves", () => {
  const html = read("src/index.html");
  const app = read("src/app.js");
  const main = read("main.js");

  assert.match(html, /<select name="closeness" data-discrete-setting="true">/);
  assert.match(html, /<select name="trust" data-discrete-setting="true">/);
  assert.doesNotMatch(html, /type="range" name="(?:closeness|trust|playfulness|warmth|bluntness|initiative)"/);
  assert.match(app, /state\.relationship\.closeness/);
  assert.match(app, /state\.relationship\.trust/);
  assert.match(main, /friend\.relationship\.closeness = clampScore/);
  assert.match(main, /friend\.relationship\.trust = clampScore/);
});

test("friend age is optional and nonbinary is no longer a gender option", () => {
  const html = read("src/index.html");
  const app = read("src/app.js");
  const prompt = read("src/prompt.js");

  assert.match(html, /name="age" type="number" min="0" max="120"/);
  assert.doesNotMatch(html, /논바이너리/);
  assert.match(app, /settings\.age = Math\.max/);
  assert.match(prompt, /나이=\$\{Number\(profile\.age\)\}세/);
});
