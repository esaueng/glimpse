import React from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "./Dashboard";
import { loadDemoStats } from "./demo-data";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Dashboard demo loadStats={loadDemoStats} />
  </React.StrictMode>,
);
