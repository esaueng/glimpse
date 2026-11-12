// @vitest-environment node
// Failed /api/* responses: the worker's JSON `error` text is shown, capped and
// as plain text; anything else falls back to the dashboard's generic message.
import { describe, expect, it } from "vitest";
import {
  cleanServerMessage,
  loadErrorMessage,
  MAX_SERVER_MESSAGE,
  responseError,
  ServerError,
} from "../web/api";

const pending =
  "Database migration pending: 0004_cloudflare.sql. Apply it with `wrangler d1 migrations apply` before using this page.";
const json = (body: unknown, status = 503) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("responseError", () => {
  it("uses the worker's message for a pending migration", async () => {
    const error = await responseError(
      json({ error: pending, missingMigrations: ["0004_cloudflare.sql"] }),
      "Analytics unavailable. Try Refresh.",
    );
    expect(error).toBeInstanceOf(ServerError);
    expect(error.message).toBe(pending);
    expect((error as ServerError).status).toBe(503);
    expect(loadErrorMessage(error, "Cloudflare data could not be loaded.")).toBe(pending);
  });

  it("falls back for plain-text and malformed bodies", async () => {
    const fallback = "Analytics unavailable. Try Refresh.";
    const responses = [
      new Response("Authentication temporarily unavailable", { status: 503 }),
      new Response("Authentication required", { status: 401 }),
      new Response("{not json", {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
      json({ error: 42 }),
      json({ error: "   " }),
      json({ message: "nope" }),
      json(["error"]),
      json(null),
    ];
    for (const response of responses) {
      const error = await responseError(response, fallback);
      expect(error).not.toBeInstanceOf(ServerError);
      expect(error.message).toBe(fallback);
      expect(loadErrorMessage(error, "Generic.")).toBe("Generic.");
    }
  });

  it("keeps the generic message for errors that did not come from the server", () => {
    expect(loadErrorMessage(new Error("Failed to fetch"), "Generic.")).toBe("Generic.");
    expect(loadErrorMessage("boom", "Generic.")).toBe("Generic.");
  });
});

describe("cleanServerMessage", () => {
  it("reduces the text to one plain line", () => {
    expect(cleanServerMessage("  Line one\n\tline\u0000two\u001b[31m  ")).toBe(
      "Line one line two [31m",
    );
    expect(cleanServerMessage("<b>bold</b>")).toBe("<b>bold</b>");
    expect(cleanServerMessage("\n\r\t")).toBeNull();
  });

  it("caps long messages with an ellipsis", () => {
    const long = cleanServerMessage("x".repeat(5000))!;
    expect([...long]).toHaveLength(MAX_SERVER_MESSAGE);
    expect(long.endsWith("…")).toBe(true);
    const exact = "y".repeat(MAX_SERVER_MESSAGE);
    expect(cleanServerMessage(exact)).toBe(exact);
  });
});
