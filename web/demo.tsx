import React from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "./Dashboard";
import { loadDemoStats } from "./demo-data";
import { loadCloudflareDemo } from "./cloudflare-demo";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Dashboard
      demo
      loadStats={loadDemoStats}
      loadCloudflare={loadCloudflareDemo}
    />
  </React.StrictMode>,
);
