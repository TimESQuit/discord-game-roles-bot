import type { Config } from "../config.ts";
import type { Db } from "../db/index.ts";
import type { Repos } from "../db/index.ts";
import type { Gateway } from "../discord/index.ts";
import type { Audit } from "./audit.ts";

export interface AppContext {
  config: Config;
  db: Db;
  repos: Repos;
  gateway: Gateway;
  audit: Audit;
  now: () => Date;
}
