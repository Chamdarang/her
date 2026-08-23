const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeMemory } = require("../src/memory");

const root = path.join(__dirname, "..");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "src", "index.html"), "utf8");

test("memory manager exposes direct add, edit, pin, and delete controls", () => {
  assert.match(html, /id="memoryCreateForm"/);
  assert.match(html, /친구가 기억할 내용/);
  assert.match(preload, /memory:create/);
  assert.match(app, /window\.her\.createMemory/);
  assert.match(app, /window\.her\.updateMemory/);
  assert.match(app, /window\.her\.deleteMemory/);
  assert.match(main, /ipcMain\.handle\("memory:create"/);
});

test("manually created memories are independent from conversation messages", () => {
  const memory = normalizeMemory(
    {
      category: "preference",
      text: "  커피는 연하게 마심  ",
      sourceMessageId: null,
      pinned: true
    },
    () => "manual-1",
    0
  );
  assert.deepEqual(memory, {
    id: "manual-1",
    category: "preference",
    text: "커피는 연하게 마심",
    sourceMessageId: null,
    pinned: true,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z"
  });
  assert.match(main, /Object\.hasOwn\(changes \|\| \{\}, "text"\) \? \{ sourceMessageId: null \}/);
});

test("memory categories use plain labels and explain that only pinning changes priority", () => {
  for (const label of ["기본 정보", "좋아함·싫어함", "요즘 하는 일", "함께 나눈 기억"]) {
    assert.ok(`${html}\n${app}`.includes(label));
  }
  assert.match(html, /분류는 목록을 정리하기 위한 표시일 뿐/);
  assert.match(html, /우선 참고/);
  assert.match(app, /function updateMemoryCategoryGuide\(\)/);
});
