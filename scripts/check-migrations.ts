import { execFileSync } from "node:child_process";

const run = (command: string, args: string[]): string =>
  execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

run("pnpm", ["exec", "drizzle-kit", "generate"]);
const changes = run("git", ["status", "--porcelain", "drizzle"]).trim();
if (changes !== "") {
  console.error("Schema changed without a migration: run pnpm db:generate and commit drizzle/");
  console.error(changes);
  process.exit(1);
}
