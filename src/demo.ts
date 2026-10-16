// Separate deployment with only static assets: no D1, RPC, secrets, or live API.
export default {
  async fetch(request: Request, env: Pick<Env, "ASSETS">) {
    const url = new URL(request.url);
    const path = url.pathname;
    const entry = path === "/demo" || path === "/demo/";
    const asset =
      /^\/demo\/(?:assets\/[\w.-]+\.(?:js|css)|brand\/[\w.-]+\.(?:svg|png)|favicon\.(?:svg|ico)|apple-touch-icon\.png)$/.test(
        path,
      );
    if (!entry && !asset) return new Response("Not found", { status: 404 });
    if (!["GET", "HEAD"].includes(request.method))
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    url.pathname = entry ? "/index.html" : path.slice("/demo".length);
    url.search = "";
    // Do not forward live Access cookies or request headers to the asset binding.
    const response = await env.ASSETS.fetch(
      new Request(url, { method: request.method }),
    );
    const result = new Response(response.body, response);
    result.headers.set(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    result.headers.set("X-Content-Type-Options", "nosniff");
    result.headers.set("Referrer-Policy", "no-referrer");
    result.headers.set("X-Frame-Options", "DENY");
    result.headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    result.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    return result;
  },
} satisfies ExportedHandler<Pick<Env, "ASSETS">>;
