import { execFileSync, spawnSync } from "node:child_process";

// drizzle-kit exits 0 even when it fails to load the schema, so judge it by its output.
const generate = spawnSync("pnpm", ["exec", "drizzle-kit", "generate"], { encoding: "utf8" });
const output = `${generate.stdout}${generate.stderr}`;
const succeeded =
  generate.status === 0 &&
  !/error/i.test(output) &&
  (output.includes("No schema changes") || output.includes("Your SQL migration file"));
if (!succeeded) {
  console.error("drizzle-kit generate did not finish cleanly:");
  console.error(output);
  process.exit(1);
}

const changes = execFileSync("git", ["status", "--porcelain", "drizzle"], {
  encoding: "utf8",
}).trim();
if (changes !== "") {
  console.error("Schema changed without a migration: run pnpm db:generate and commit drizzle/");
  console.error(changes);
  process.exit(1);
}
