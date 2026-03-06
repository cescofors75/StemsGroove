const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function normalizeWindowsDriveCase(inputPath) {
  if (process.platform !== "win32") {
    return inputPath;
  }
  return inputPath.replace(/^[a-z]:/, (match) => match.toUpperCase());
}

const projectDir = normalizeWindowsDriveCase(fs.realpathSync(path.resolve(__dirname, "..")));

if (process.platform === "win32") {
  const killCmd =
    "$procs = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'next dev' -and $_.CommandLine -match 'Sterms' }; foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force }";
  spawnSync("powershell.exe", ["-NoProfile", "-Command", killCmd], { stdio: "inherit" });
}

fs.rmSync(path.join(projectDir, ".next"), { recursive: true, force: true });

const env = {
  ...process.env,
  PWD: projectDir,
};

let child;
if (process.platform === "win32") {
  const nextCmd = path.join(projectDir, "node_modules", ".bin", "next.cmd");
  child = spawn(nextCmd, ["dev"], {
    cwd: projectDir,
    stdio: "inherit",
    env,
    shell: true,
  });
} else {
  const nextBin = path.join(projectDir, "node_modules", ".bin", "next");
  child = spawn(nextBin, ["dev"], {
    cwd: projectDir,
    stdio: "inherit",
    env,
  });
}

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
