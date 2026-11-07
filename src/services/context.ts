import type { Config } from "../config.ts";
import type { Repos } from "../db/repos/index.ts";
import type { Gateway } from "../discord/gateway.ts";
import type { Audit } from "./audit.ts";

export interface AppContext {
  config: Config;
  repos: Repos;
  gateway: Gateway;
  audit: Audit;
  now: () => Date;
}
