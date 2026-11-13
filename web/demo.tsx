import React from "react";
import { createRoot } from "react-dom/client";
import { Dashboard, ErrorBoundary } from "./Dashboard";
import { loadDemoStats } from "./demo-data";
import { loadCloudflareDemo } from "./cloudflare-demo";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Dashboard
        demo
        loadStats={loadDemoStats}
        loadCloudflare={loadCloudflareDemo}
      />
    </ErrorBoundary>
  </React.StrictMode>,
);
