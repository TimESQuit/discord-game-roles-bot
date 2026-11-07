import { spawnSync } from "node:child_process";

// drizzle-kit exits 0 even when it fails to load the schema, so judge it by its output.
const generate = spawnSync("pnpm", ["exec", "drizzle-kit", "generate"], { encoding: "utf8" });
const output = `${generate.stdout}${generate.stderr}`;

if (generate.status === 0 && !/error/i.test(output) && output.includes("No schema changes")) {
  process.exit(0);
}
if (generate.status === 0 && !/error/i.test(output) && output.includes("Your SQL migration file")) {
  console.error(
    "Schema changed without a migration: a new migration was written to drizzle/ — review it and commit it.",
  );
  console.error(output);
  process.exit(1);
}
console.error("drizzle-kit generate did not finish cleanly:");
console.error(output);
process.exit(1);
