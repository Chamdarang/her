const fs = require("node:fs");
const path = require("node:path");

function atomicWriteJson(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temporaryPath, targetPath);
}

function preserveCorruptFile(targetPath, now = Date.now()) {
  if (!fs.existsSync(targetPath)) return null;
  const extension = path.extname(targetPath);
  const base = targetPath.slice(0, extension ? -extension.length : undefined);
  const recoveryPath = `${base}.corrupt-${now}${extension || ".json"}`;
  try {
    fs.copyFileSync(targetPath, recoveryPath, fs.constants.COPYFILE_EXCL);
    return recoveryPath;
  } catch {
    return null;
  }
}

module.exports = { atomicWriteJson, preserveCorruptFile };
