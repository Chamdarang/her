const test = require("node:test");
const assert = require("node:assert/strict");

const { ChatScrollController } = require("../src/chat-scroll");

function fixture() {
  const frames = [];
  const classes = new Set();
  const list = {
    scrollHeight: 1000,
    scrollTop: 700,
    clientHeight: 300,
    scrollTo({ top }) { this.scrollTop = top; }
  };
  const indicator = {
    classList: {
      add: (name) => classes.add(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)
    }
  };
  const controller = new ChatScrollController(list, indicator, {
    requestFrame: (callback) => frames.push(callback)
  });
  return { controller, frames, list };
}

test("consecutive renders keep the latest reply pinned to the bottom", () => {
  const { controller, frames, list } = fixture();
  const first = controller.beforeRender({ newMessageArrived: true });
  list.scrollHeight = 1120;
  controller.afterRender(first);

  const second = controller.beforeRender({ newMessageArrived: false });
  list.scrollHeight = 1160;
  controller.afterRender(second);

  while (frames.length) frames.shift()();
  assert.equal(list.scrollTop, 1160);
});

test("reading older messages preserves position and exposes the new-message control", () => {
  const { controller, frames, list } = fixture();
  controller.forceNext = false;
  list.scrollTop = 200;
  const snapshot = controller.beforeRender({ newMessageArrived: true });
  list.scrollHeight = 1100;
  controller.afterRender(snapshot);
  while (frames.length) frames.shift()();
  assert.equal(list.scrollTop, 200);
});
