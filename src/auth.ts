import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import { logFailure } from "./errors";
// Cache only public signing keys and configuration; never request/identity data.
const keySets = new Map<string, JWTVerifyGetKey>();
// Thrown when Access signing keys cannot be fetched or parsed: an outage, not a bad token.
export class KeysUnavailable extends Error {
  override name = "KeysUnavailable";
}
export type Access = "allowed" | "denied" | "unavailable";
// Tolerates small clock differences between Access and the Worker for exp/iat/nbf.
export const CLOCK_TOLERANCE_SECONDS = 60;
function keySet(issuer: string): JWTVerifyGetKey {
  let keys = keySets.get(issuer);
  if (!keys) {
    const remote = createRemoteJWKSet(
      new URL(`${issuer}/cdn-cgi/access/certs`),
    );
    keys = async (header, token) => {
      try {
        return await remote(header, token);
      } catch (error) {
        // Token-dependent lookups (unknown kid or alg) stay authentication failures.
        if (
          error instanceof errors.JWKSNoMatchingKey ||
          error instanceof errors.JWKSMultipleMatchingKeys ||
          error instanceof errors.JOSENotSupported
        )
          throw error;
        throw new KeysUnavailable("Access signing keys unavailable", {
          cause: error,
        });
      }
    };
    keySets.set(issuer, keys);
  }
  return keys;
}
// Only the configured Access issuer can supply keys; token-controlled URLs are ignored.
export async function access(
  request: Request,
  env: Pick<Env, "ACCESS_ISSUER" | "ACCESS_AUD">,
): Promise<Access> {
  if (
    !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER) ||
    !env.ACCESS_AUD
  )
    return "denied";
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || token.length > 8192) return "denied";
  try {
    // The RS256 allowlist is checked before any key lookup, so HS256/none tokens never
    // reach the key set.
    await jwtVerify(token, keySet(env.ACCESS_ISSUER), {
      issuer: env.ACCESS_ISSUER,
      audience: env.ACCESS_AUD,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "sub"],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });
    return "allowed";
  } catch (error) {
    if (error instanceof KeysUnavailable) {
      logFailure("Access keys unavailable", error.cause);
      return "unavailable";
    }
    return "denied";
  }
}
export async function authorized(
  request: Request,
  env: Pick<Env, "ACCESS_ISSUER" | "ACCESS_AUD">,
): Promise<boolean> {
  return (await access(request, env)) === "allowed";
}
