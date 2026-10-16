import React from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "./Dashboard";
import type { Range, Stats } from "./data";

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
    <Dashboard loadStats={loadStats} />
  </React.StrictMode>,
);
