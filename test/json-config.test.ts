import { describe, expect, it } from "vitest";
import { parseJsonConfig } from "./json-config";

describe("JSONC configuration parsing", () => {
  it("accepts comments and trailing commas without changing URL strings", () => {
    expect(parseJsonConfig(`{
      // Wrangler configuration supports JSONC.
      "url": "https://example.test/a//b",
      /* Optional bindings. */
      "bindings": ["DB",],
    }`, "fixture.jsonc")).toEqual({
      url: "https://example.test/a//b",
      bindings: ["DB"],
    });
  });

  it.each(['{"broken": }', '{"ok": true} trailing', '/* unfinished'])(
    "rejects malformed input instead of validating a partial configuration: %s",
    (source) => {
      expect(() => parseJsonConfig(source, "fixture.jsonc"))
        .toThrow("Invalid JSONC: fixture.jsonc");
    },
  );
});
