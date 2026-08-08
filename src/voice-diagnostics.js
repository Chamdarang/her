const fs = require("node:fs");
const path = require("node:path");

function diagnosticPath(userDataPath) {
  return path.join(userDataPath, "voice-diagnostics.jsonl");
}

function appendVoiceDiagnostic(userDataPath, entry) {
  const target = diagnosticPath(userDataPath);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target) && fs.statSync(target).size > 5 * 1024 * 1024) {
      const archive = path.join(
        path.dirname(target),
        `voice-diagnostics-${Date.now()}.jsonl`
      );
      fs.renameSync(target, archive);
    }
    fs.appendFileSync(target, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, "utf8");
  } catch {}
  return target;
}

module.exports = { appendVoiceDiagnostic, diagnosticPath };
