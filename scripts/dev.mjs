import { spawn } from "node:child_process";
// Accept the preview supervisor's port while ignoring Vite-only flags it appends.
const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = portIndex >= 0 ? args[portIndex + 1] : process.env.PORT || "3000";
const mode = args.includes("--production") ? "start" : "dev";
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    mode,
    "--hostname",
    "0.0.0.0",
    "--port",
    port,
  ],
  { stdio: "inherit", env: process.env },
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
