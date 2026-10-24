import { describe, expect, it } from "vitest";
import { readJsonConfig as readConfig } from "./json-config";
describe("preview isolation", () => {
  it("keeps Preview data, migration targets and JWT audiences separate from production", () => {
    const config = readConfig("wrangler.jsonc");
    const migrations = readConfig("wrangler.preview-migrations.jsonc");
    const preview = config.previews;
    const production = config.d1_databases.find((db: { binding: string }) => db.binding === "DB");
    const database = preview.d1_databases.find((db: { binding: string }) => db.binding === "DB");
    expect(database.database_id).not.toBe(production.database_id);
    expect(database.database_name).not.toBe(production.database_name);
    expect(migrations.d1_databases).toHaveLength(1);
    expect(migrations.d1_databases[0]).toMatchObject({
      binding: "PREVIEW_DB", database_id: database.database_id,
      database_name: database.database_name, migrations_dir: "migrations",
    });
    expect(preview.vars.ACCESS_ISSUER).toBe(config.vars.ACCESS_ISSUER);
    expect(preview.vars.ACCESS_AUD).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.vars.ACCESS_AUD).not.toBe(config.vars.ACCESS_AUD);
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(true);
    expect(preview.triggers).toBeUndefined();
    expect(preview.routes).toBeUndefined();
    expect(preview.services).toBeUndefined();
    expect(config.observability.enabled).toBe(false);
    expect(config.vars.CF_MONITOR_ENABLED).toBe("false");
    expect(preview.vars.CF_MONITOR_ENABLED).toBe("false");
    expect(config.vars.CF_API_TOKEN).toBeUndefined();
    expect(preview.vars.CF_API_TOKEN).toBeUndefined();
  });
});
