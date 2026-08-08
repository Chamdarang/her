function chunk(buffer, id) {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (chunkId === id) return buffer.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  return null;
}

function concatWavBuffers(buffers) {
  if (buffers.length === 1) return buffers[0];
  if (!buffers.length) throw new Error("합칠 WAV 데이터가 없어.");
  const formats = buffers.map((buffer) => chunk(buffer, "fmt "));
  const data = buffers.map((buffer) => chunk(buffer, "data"));
  if (formats.some((value) => !value) || data.some((value) => !value)) {
    throw new Error("SBV2가 올바른 WAV 파일을 반환하지 않았어.");
  }
  if (formats.some((value) => !value.equals(formats[0]))) {
    throw new Error("분할 합성된 WAV 형식이 서로 달라.");
  }
  const format = formats[0];
  const audio = Buffer.concat(data);
  const formatPadding = format.length % 2;
  const audioPadding = audio.length % 2;
  const output = Buffer.alloc(12 + 8 + format.length + formatPadding + 8 + audio.length + audioPadding);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(output.length - 8, 4);
  output.write("WAVE", 8, "ascii");
  output.write("fmt ", 12, "ascii");
  output.writeUInt32LE(format.length, 16);
  format.copy(output, 20);
  const dataHeader = 20 + format.length + formatPadding;
  output.write("data", dataHeader, "ascii");
  output.writeUInt32LE(audio.length, dataHeader + 4);
  audio.copy(output, dataHeader + 8);
  return output;
}

module.exports = { concatWavBuffers };
