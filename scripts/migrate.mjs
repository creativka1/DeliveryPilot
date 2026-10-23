import { mkdirSync, openSync, closeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
// Prisma 6's SQLite migration engine can fail with an empty error if the file is absent.
const url = process.env.DATABASE_URL || "file:./dev.db";
if (!url.startsWith("file:"))
  throw new Error(
    "This project uses SQLite. DATABASE_URL must start with file:.",
  );
const path = url.slice(5).split("?")[0];
const absolute = resolve("prisma", path);
mkdirSync(dirname(absolute), { recursive: true });
closeSync(openSync(absolute, "a"));
const result = spawnSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
