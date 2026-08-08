const test = require("node:test");
const assert = require("node:assert/strict");
const { concatWavBuffers } = require("../src/wav");

function wav(audio) {
  const output = Buffer.alloc(44 + audio.length);
  output.write("RIFF", 0);
  output.writeUInt32LE(output.length - 8, 4);
  output.write("WAVEfmt ", 8);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(24000, 24);
  output.writeUInt32LE(48000, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36);
  output.writeUInt32LE(audio.length, 40);
  audio.copy(output, 44);
  return output;
}

test("split synthesis WAV files are joined into one valid stream", () => {
  const joined = concatWavBuffers([wav(Buffer.from([1, 2])), wav(Buffer.from([3, 4]))]);
  assert.equal(joined.toString("ascii", 0, 4), "RIFF");
  assert.equal(joined.readUInt32LE(40), 4);
  assert.deepEqual([...joined.subarray(44)], [1, 2, 3, 4]);
});
