import React from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "./Dashboard";
import type { Range, Stats } from "./data";
import type { CloudflareData } from "../src/cloudflare/model";
async function loadCloudflare(signal: AbortSignal): Promise<CloudflareData> {
  const response = await fetch("/api/cloudflare", {
    cache: "no-store",
    signal,
  });
  if (
    !response.ok ||
    !(response.headers.get("Content-Type") ?? "").includes("application/json")
  )
    throw new Error("Cloudflare monitor unavailable");
  return response.json();
}
async function writeCloudflare(value: Record<string, unknown>): Promise<void> {
  const response = await fetch("/api/cloudflare/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error("Cloudflare settings could not be saved");
}

async function loadStats(range: Range, signal: AbortSignal): Promise<Stats> {
  const response = await fetch(`/api/stats?${new URLSearchParams(range)}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Sign in through Cloudflare Access."
        : response.status === 400
          ? "Choose a valid UTC range of at most 90 days."
          : "Analytics unavailable. Try Refresh.",
    );
  if (
    !(response.headers.get("Content-Type") ?? "").includes("application/json")
  )
    throw new Error("Protected analytics API unavailable.");
  return response.json();
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Dashboard
      loadStats={loadStats}
      loadCloudflare={loadCloudflare}
      writeCloudflare={writeCloudflare}
    />
  </React.StrictMode>,
);
