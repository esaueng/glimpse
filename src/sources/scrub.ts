// Scrubbing for text that external sources send (issue titles, error types, stack frames).
// Privacy choice B: keep what explains a failure, drop what identifies a person or request:
// no IPs, emails, tokens, query strings, request bodies or long identifiers.

const RULES: [RegExp, string | ((match: string) => string)][] = [
  // JWTs and bearer-style tokens before anything that might split them.
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, "[token]"],
  [/\b(?:bearer|token|key|secret|password|pwd|auth)[=: ]+\S+/gi, "[secret]"],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]"],
  // Query strings and fragments on URLs and paths.
  [/([/\w.-])[?#][^\s"'`)<>]*/g, "$1"],
  [/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "[ip]"],
  [/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi, "[ip]"],
  // Compressed IPv6 ("2001:db8::1", "fe80::1%eth0", "::1", "::ffff:...").
  // A digit is required, so hex-only C++ scopes such as abc::def survive.
  [
    /(?:\b(?:[0-9a-f]{1,4}:){1,7}:|(?<![\w:])::)(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?(?:%[\w.]+)?(?![\w:])/gi,
    (match) => (/\d/.test(match) ? "[ip]" : match),
  ],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]"],
  [/\b[0-9a-f]{16,}\b/gi, "[id]"],
  [/\b[A-Za-z0-9_-]{32,}\b/g, "[id]"],
  [/\b\d{6,}\b/g, "[n]"],
];

/** Scrubbed single-line text, at most `max` characters; null when nothing usable is left. */
export function scrub(value: unknown, max = 200): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  let text = String(value).replace(/[\u0000-\u001f\u007f]+/g, " ");
  for (const [pattern, replacement] of RULES)
    text = typeof replacement === "string" ? text.replace(pattern, replacement) : text.replace(pattern, replacement);
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Stack frames as "fn (file:line:col)". Only lines that look like frames are kept, so a
 * message embedded in the stack never survives; at most `max` frames.
 */
export function frames(stack: unknown, max = 15): string[] {
  if (typeof stack !== "string") return [];
  const out: string[] = [];
  for (const line of stack.split("\n")) {
    const m = /^\s*at\s+(?:(.+?)\s+\()?([^()\s]+?:\d+(?::\d+)?)\)?\s*$/.exec(line);
    if (!m) continue;
    const fn = m[1] ? scrub(m[1], 80) : null,
      // Drop a query string before the line and column, then everything up to the file name.
      where = scrub(
        m[2]!.replace(/[?#][^:]*(?=:\d+(?::\d+)?$)/, "").replace(/^.*\/(?=[^/]+:\d)/, ""),
        120,
      );
    if (where) out.push(fn ? `${fn} (${where})` : where);
    if (out.length >= max) break;
  }
  return out;
}

/** Key paths of a JSON value without any values, to describe an unrecognised payload. */
export function shape(value: unknown, prefix = "", out: string[] = [], depth = 0): string[] {
  if (out.length >= 80 || depth > 4) return out;
  if (Array.isArray(value)) {
    if (value.length) shape(value[0], `${prefix}[]`, out, depth + 1);
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value).sort().slice(0, 40)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (!/^[\w-]{1,64}$/.test(key)) continue;
      out.push(path);
      shape((value as Record<string, unknown>)[key], path, out, depth + 1);
    }
  }
  return out;
}
