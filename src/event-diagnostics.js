const fs = require("node:fs");
const path = require("node:path");

function eventDiagnosticPath(userDataPath) {
  return path.join(userDataPath, "conversation-events.jsonl");
}

function appendEventDiagnostic(userDataPath, entry) {
  const target = eventDiagnosticPath(userDataPath);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target) && fs.statSync(target).size > 5 * 1024 * 1024) {
      fs.renameSync(
        target,
        path.join(path.dirname(target), `conversation-events-${Date.now()}.jsonl`)
      );
    }
    fs.appendFileSync(
      target,
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
      "utf8"
    );
  } catch {}
  return target;
}

module.exports = { appendEventDiagnostic, eventDiagnosticPath };
