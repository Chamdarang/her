const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeExplicitMemories, migrateMemories } = require("../src/memory");

let sequence = 0;
const nextId = () => `memory-${++sequence}`;

test("legacy string memories migrate to structured records", () => {
  sequence = 0;
  const memories = migrateMemories(["매운 음식을 좋아함"], nextId, 0);
  assert.equal(memories[0].text, "매운 음식을 좋아함");
  assert.equal(memories[0].category, "profile");
  assert.equal(memories[0].pinned, false);
});

test("only grounded memories with a real user-message source are stored", () => {
  sequence = 0;
  const result = mergeExplicitMemories(
    [],
    [
      {
        category: "preference",
        text: "공포영화를 좋아함",
        sourceMessageId: "user-1"
      },
      {
        category: "profile",
        text: "아마 서울에 살 것 같음",
        sourceMessageId: "user-2",
        explicit: false
      }
    ],
    new Set(["user-1"]),
    nextId,
    0
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].text, "공포영화를 좋아함");
});

test("similar memories update instead of duplicating", () => {
  sequence = 0;
  const existing = migrateMemories(["공포영화를 좋아함"], nextId, 0);
  const result = mergeExplicitMemories(
    existing,
    [
      {
        category: "preference",
        text: "공포 영화를 정말 좋아함",
        sourceMessageId: "user-1"
      }
    ],
    new Set(["user-1"]),
    nextId,
    1000
  );
  assert.equal(result.length, 1);
});
