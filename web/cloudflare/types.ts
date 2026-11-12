import type { CloudflareData } from "../../src/cloudflare/model";
export type MonitorLoader = (signal: AbortSignal) => Promise<CloudflareData>;
export type SettingsWriter = (value: Record<string, unknown>) => Promise<void>;
