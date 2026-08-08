const test = require("node:test");
const assert = require("node:assert/strict");

const { SequentialAudioQueue } = require("../src/audio-queue");

test("automatic voices play sequentially without interrupting each other", async () => {
  const events = [];
  const releases = [];
  const queue = new SequentialAudioQueue(async (id) => {
    events.push(`start:${id}`);
    await new Promise((resolve) => releases.push(resolve));
    events.push(`end:${id}`);
  });

  queue.enqueue("first");
  queue.enqueue("second");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["start:first"]);

  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["start:first", "end:first", "start:second"]);

  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["start:first", "end:first", "start:second", "end:second"]);
});
