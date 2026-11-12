import { describe, expect, it } from "vitest";
import { readJsonConfig } from "./json-config";
import { COLLECT_CRON, CRONS, RETENTION_CRON } from "../src/schedule";

describe("scheduled triggers", () => {
  it("dispatches on exactly the crons configured in wrangler.jsonc", () => {
    const config = readJsonConfig("wrangler.jsonc") as {
      triggers?: { crons?: string[] };
    };
    const configured = config.triggers?.crons ?? [];
    expect([...configured].sort()).toEqual([...CRONS].sort());
    expect(configured).toContain(COLLECT_CRON);
    expect(configured).toContain(RETENTION_CRON);
    expect(new Set(configured).size).toBe(configured.length);
  });
});
