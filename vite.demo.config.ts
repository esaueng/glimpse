import { defineConfig } from "vite";
export default defineConfig({
  base: "/demo/",
  plugins: [
    {
      name: "demo-entry",
      transformIndexHtml: {
        order: "pre",
        handler(html) {
          return html
            .replace("/web/main.tsx", "/web/demo.tsx")
            .replace("Glimpse · Private analytics", "Glimpse · Public demo")
            .replace(
              "Private analytics for OpenZCAD, OpenFEA, and OpenLattice3D, built on Cloudflare Workers and D1.",
              "Explore Glimpse with fictional analytics. Public interactive demo with no live data.",
            );
        },
      },
    },
  ],
  build: { outDir: "dist-demo" },
});
