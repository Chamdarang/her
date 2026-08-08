const test = require("node:test");
const assert = require("node:assert/strict");
const {
  autonomousIntervalMs,
  chooseNextSpeaker,
  ensureRoomState,
  normalizeRoom
} = require("../src/rooms");

function friend(id, initiative = 50, messages = []) {
  return {
    id,
    profile: { name: id, initiative },
    messages,
    pending: [],
    proactiveLog: [],
    memories: [],
    relationshipEvents: []
  };
}

test("legacy friend conversations migrate into direct rooms without serialized duplicates", () => {
  const originalMessage = { id: "m1", role: "assistant", text: "안녕" };
  const state = {
    friends: [friend("a", 50, [originalMessage])],
    activeFriendId: "a"
  };
  ensureRoomState(state, () => "generated");
  assert.equal(state.rooms.length, 1);
  assert.equal(state.rooms[0].type, "direct");
  assert.equal(state.rooms[0].messages[0].senderId, "a");
  assert.equal(state.friends[0].messages, state.rooms[0].messages);
  assert.equal(Object.keys(state.friends[0]).includes("messages"), false);
  assert.equal(JSON.parse(JSON.stringify(state)).friends[0].messages, undefined);
});

test("group rooms retain at most six unique participants", () => {
  const room = normalizeRoom({
    type: "group",
    participantIds: ["a", "b", "c", "d", "e", "f", "g", "a"]
  });
  assert.deepEqual(room.participantIds, ["a", "b", "c", "d", "e", "f"]);
});

test("the next group speaker avoids repeating the previous AI", () => {
  const friends = [friend("a", 100), friend("b", 1)];
  const room = normalizeRoom({
    type: "group",
    participantIds: ["a", "b"],
    messages: [{ role: "assistant", senderId: "a", text: "먼저 말함" }]
  });
  assert.equal(chooseNextSpeaker(room, friends, () => 0).id, "b");
});

test("autonomous frequency and rest intervals stay within their ranges", () => {
  assert.equal(autonomousIntervalMs("chatty", () => 0), 1.5 * 60 * 1000);
  assert.equal(autonomousIntervalMs("chatty", () => 1), 4 * 60 * 1000);
  assert.equal(autonomousIntervalMs("normal", () => 0), 3 * 60 * 1000);
  assert.equal(autonomousIntervalMs("quiet", () => 1), 15 * 60 * 1000);
  assert.equal(autonomousIntervalMs("normal", () => 0, true), 10 * 60 * 1000);
});

test("room autonomy defaults off and normalizes its limits", () => {
  const room = normalizeRoom({ autonomousMaxTurns: 99, autonomousFrequency: "invalid" });
  assert.equal(room.autonomousEnabled, false);
  assert.equal(room.autonomousMaxTurns, 20);
  assert.equal(room.autonomousFrequency, "normal");
});

test("direct rooms discard legacy autonomous state and queued autonomous replies", () => {
  const room = normalizeRoom({
    type: "direct",
    participantIds: ["a"],
    autonomousEnabled: true,
    autonomousTurnCount: 4,
    nextAutonomousAt: "2026-08-02T12:00:00.000Z",
    pending: [
      { id: "auto", source: "autonomous" },
      { id: "reply", source: "reply" }
    ]
  });
  assert.equal(room.autonomousEnabled, false);
  assert.equal(room.autonomousTurnCount, 0);
  assert.equal(room.nextAutonomousAt, null);
  assert.deepEqual(room.pending.map((item) => item.id), ["reply"]);
});

test("group rooms retain autonomous state", () => {
  const room = normalizeRoom({
    type: "group",
    participantIds: ["a", "b"],
    autonomousEnabled: true,
    nextAutonomousAt: "2026-08-02T12:00:00.000Z"
  });
  assert.equal(room.autonomousEnabled, true);
  assert.equal(room.nextAutonomousAt, "2026-08-02T12:00:00.000Z");
});
