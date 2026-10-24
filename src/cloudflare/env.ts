export interface MonitorEnv {
  DB: D1Database;
  CF_MONITOR_ENABLED?: string;
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  CF_ALERT_WEBHOOK?: string;
}
declare global {
  interface Env extends Omit<MonitorEnv, "DB" | "CF_MONITOR_ENABLED"> {}
}
