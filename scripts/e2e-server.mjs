import { spawnSync, spawn } from "node:child_process";
const env = {
  ...process.env,
  DATABASE_URL: "file:./e2e.db",
  DEMO_MODE: "true",
  APP_ORIGIN: "http://127.0.0.1:3100",
  // Isolated E2E runs never inherit real Ring credentials.
  RING_ACCESS_TOKEN: "",
  RING_REFRESH_TOKEN: "",
  RING_WEBHOOK_SIGNING_KEY: "",
  RING_ACCOUNT_ID: "",
};
for (const args of [
  ["--env-file-if-exists=.env", "scripts/migrate.mjs"],
  ["--env-file-if-exists=.env", "--import", "tsx", "prisma/seed.ts"],
]) {
  const r = spawnSync(process.execPath, args, { stdio: "inherit", env });
  if (r.status !== 0) process.exit(r.status || 1);
}
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3100",
  ],
  { stdio: "inherit", env },
);
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code || 0));
