import { createRemoteJWKSet, jwtVerify } from "jose";
// Cache only public signing keys and configuration; never request/identity data.
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
// Only the configured Access issuer can supply keys; token-controlled URLs are ignored.
export async function authorized(
  request: Request,
  env: Pick<Env, "ACCESS_ISSUER" | "ACCESS_AUD">,
): Promise<boolean> {
  if (
    !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER) ||
    !env.ACCESS_AUD
  )
    return false;
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || token.length > 8192) return false;
  try {
    let keys = keySets.get(env.ACCESS_ISSUER);
    if (!keys) {
      keys = createRemoteJWKSet(
        new URL(`${env.ACCESS_ISSUER}/cdn-cgi/access/certs`),
      );
      keySets.set(env.ACCESS_ISSUER, keys);
    }
    await jwtVerify(token, keys, {
      issuer: env.ACCESS_ISSUER,
      audience: env.ACCESS_AUD,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "sub"],
    });
    return true;
  } catch {
    return false;
  }
}
