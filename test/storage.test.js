const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { atomicWriteJson, preserveCorruptFile } = require("../src/storage");

test("state JSON is replaced without leaving a temporary file", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "her-storage-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, "state.json");
  atomicWriteJson(target, { version: 1 });
  atomicWriteJson(target, { version: 2, value: "saved" });
  assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), {
    version: 2,
    value: "saved"
  });
  assert.equal(fs.existsSync(`${target}.tmp`), false);
});

test("a corrupt state file is preserved before recovery", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "her-corrupt-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, "state.json");
  fs.writeFileSync(target, "{broken", "utf8");
  const recovery = preserveCorruptFile(target, 1234);
  assert.equal(recovery, path.join(directory, "state.corrupt-1234.json"));
  assert.equal(fs.readFileSync(recovery, "utf8"), "{broken");
});
