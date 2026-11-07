export interface Config {
  token: string;
  applicationId: string;
  guildId: string;
  adminRoleId: string;
  healthcheckUrl: string | null;
  databasePath: string;
  backupHourUtc: number;
}

const SNOWFLAKE = /^\d{17,20}$/;

/** Parses the environment. Error messages name variables but never include their values. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const problems: string[] = [];
  const missing: string[] = [];

  const required = (name: string): string => {
    const value = env[name];
    if (value === undefined || value === "") {
      missing.push(name);
      return "";
    }
    return value;
  };
  const snowflake = (name: string): string => {
    const value = required(name);
    if (value !== "" && !SNOWFLAKE.test(value)) problems.push(`${name} must be a Discord ID`);
    return value;
  };

  const token = required("DISCORD_TOKEN");
  const applicationId = snowflake("DISCORD_APPLICATION_ID");
  const guildId = snowflake("DISCORD_GUILD_ID");
  const adminRoleId = snowflake("ADMIN_ROLE_ID");

  let healthcheckUrl: string | null = null;
  const rawUrl = env["HEALTHCHECK_URL"];
  if (rawUrl !== undefined && rawUrl !== "") {
    if (URL.canParse(rawUrl) && new URL(rawUrl).protocol === "https:") healthcheckUrl = rawUrl;
    else problems.push("HEALTHCHECK_URL must be an https URL");
  }

  const databasePath = env["DATABASE_PATH"] || "data/bot.sqlite";

  let backupHourUtc = 4;
  const rawHour = env["BACKUP_HOUR_UTC"];
  if (rawHour !== undefined && rawHour !== "") {
    if (/^\d{1,2}$/.test(rawHour) && Number(rawHour) <= 23) backupHourUtc = Number(rawHour);
    else problems.push("BACKUP_HOUR_UTC must be a whole number from 0 to 23");
  }

  if (missing.length > 0) problems.unshift(`Missing environment variables: ${missing.join(", ")}`);
  if (problems.length > 0) throw new Error(`Invalid configuration. ${problems.join("; ")}`);

  return {
    token,
    applicationId,
    guildId,
    adminRoleId,
    healthcheckUrl,
    databasePath,
    backupHourUtc,
  };
}
