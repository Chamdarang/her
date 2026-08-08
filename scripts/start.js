const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const projectRoot = path.join(__dirname, "..");
const electronExe = require("electron");
const electronDirectory = path.dirname(electronExe);
const developmentExe = path.join(electronDirectory, "HER-development.exe");
const markerPath = path.join(electronDirectory, ".her-development-icon.json");
const iconPath = path.join(projectRoot, "assets", "icon.ico");
const rceditPath = path.join(
  projectRoot,
  "node_modules",
  "electron-winstaller",
  "vendor",
  "rcedit.exe"
);

function desiredMarker() {
  const electronVersion = require("electron/package.json").version;
  const icon = fs.statSync(iconPath);
  return JSON.stringify({ electronVersion, iconSize: icon.size, iconMtimeMs: icon.mtimeMs });
}

function prepareDevelopmentExecutable() {
  const marker = desiredMarker();
  const currentMarker = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, "utf8") : "";
  if (fs.existsSync(developmentExe) && currentMarker === marker) return developmentExe;

  if (!fs.existsSync(rceditPath)) {
    throw new Error("개발 실행 파일에 아이콘을 넣는 도구를 찾지 못했어. npm install을 다시 실행해줘.");
  }
  fs.copyFileSync(electronExe, developmentExe);
  const result = spawnSync(
    rceditPath,
    [
      developmentExe,
      "--set-icon",
      iconPath,
      "--set-version-string",
      "FileDescription",
      "HER",
      "--set-version-string",
      "ProductName",
      "HER"
    ],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    fs.rmSync(developmentExe, { force: true });
    throw new Error(result.stderr || "개발 실행 파일 아이콘을 적용하지 못했어.");
  }
  fs.writeFileSync(markerPath, marker, "utf8");
  return developmentExe;
}

if (require.main === module) {
  try {
    const executable = prepareDevelopmentExecutable();
    if (!process.argv.includes("--prepare-only")) {
      const child = spawn(executable, [projectRoot], { stdio: "inherit" });
      child.on("exit", (code, signal) => {
        if (signal) process.kill(process.pid, signal);
        else process.exitCode = code ?? 0;
      });
      child.on("error", (error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { prepareDevelopmentExecutable };
