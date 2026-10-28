import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
nextEnv.loadEnvConfig(root, true);

const children = new Set();
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    // Next starts workers of its own; Windows needs the whole process tree stopped.
    if (process.platform === "win32" && child.pid) {
      const cleanup = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      cleanup.on("error", () => child.kill());
      cleanup.on("exit", (exitCode) => {
        if (exitCode && children.has(child)) {
          console.error(`[dev] Could not stop process tree ${child.pid}; trying the direct child.`);
          child.kill();
        }
      });
    } else {
      child.kill();
    }
  }
}

function start(command, args, stdio = "inherit") {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio,
    windowsHide: true,
  });
  children.add(child);
  child.on("error", (error) => {
    console.error(`[dev] Could not start ${command}: ${error.message}`);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!stopping) stop(code ?? (signal ? 1 : 0));
  });
  return child;
}

function startWeb() {
  if (!stopping) {
    start(process.execPath, [require.resolve("next/dist/bin/next"), "dev", ...process.argv.slice(2)]);
  }
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
if (process.platform === "win32") process.on("SIGBREAK", () => stop(0));

if (process.env.OPTIMIZER_DEV_ORIGIN) {
  console.log("[dev] Using OPTIMIZER_DEV_ORIGIN; the optimizer is managed separately.");
  startWeb();
} else {
  const venvPython = fileURLToPath(new URL(
    process.platform === "win32" ? "../.venv/Scripts/python.exe" : "../.venv/bin/python",
    import.meta.url,
  ));
  const python = process.env.PYTHON || (existsSync(venvPython) ? venvPython : "python");
  const backend = start(python, ["-u", "-m", "backend.dev_server"], ["inherit", "pipe", "inherit"]);
  const readyTimeout = setTimeout(() => {
    console.error("[dev] Optimizer startup timed out.");
    stop(1);
  }, 15_000);
  backend.on("error", () => clearTimeout(readyTimeout));
  backend.on("exit", (code) => {
    clearTimeout(readyTimeout);
    if (code && !ready) {
      console.error(`[dev] Optimizer stopped. Check port 8000 and install dependencies with: "${python}" -m pip install -r requirements.txt`);
    }
  });
  let output = "";
  let ready = false;
  backend.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    output = (output + chunk.toString()).slice(-1024);
    if (!ready && output.includes("OPTIMIZER_READY ")) {
      ready = true;
      clearTimeout(readyTimeout);
      startWeb();
    }
  });
}
