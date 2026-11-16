// Scrubbing for text that external sources send (issue titles, error types, stack frames).
// Privacy choice B: keep what explains a failure, drop what identifies a person or request:
// no IPs, emails, tokens, query strings, request bodies or long identifiers.

// Separator/case variants and common prefixes (newPassword, user_password, x-api-key).
const CREDENTIAL_NAME = /^(?:bearer|key|pwd|auth|authorization)$|(?:password|passwd|passphrase|privatekey|apikey|token|secret)$/i;

/** End of one assigned value, including quoted strings and balanced containers. */
function valueEnd(text: string, start: number): number {
  const first = text[start];
  if (first !== '"' && first !== "'" && first !== "{" && first !== "[") {
    const scalar = /^[^\s,}\]]*/.exec(text.slice(start));
    return start + scalar![0].length;
  }
  const closing: string[] = [];
  let quote = first === '"' || first === "'" ? first : "";
  if (!quote) closing.push(first === "{" ? "}" : "]");
  for (let i = start + 1; i < text.length; i++) {
    const char = text[i]!;
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) {
        quote = "";
        if (!closing.length) return i + 1;
      }
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "{" || char === "[") closing.push(char === "{" ? "}" : "]");
    else if (char === "}" || char === "]") {
      if (closing.pop() !== char) return text.length;
      if (!closing.length) return i + 1;
    }
  }
  // An explicit credential assignment with an incomplete value must fail closed.
  return text.length;
}

function assignments(text: string): string {
  // Escaped delimiters belong to a later decoding pass, not new quoted keys.
  const fields = /(?<!\\)"((?:\\.|[^"\\])*)"\s*[:=]\s*|(?<!\\)'((?:\\.|[^'\\])*)'\s*[:=]\s*|\b([a-z][\w-]*)\s*[:=]\s*/gi;
  let result = "", copied = 0;
  for (let match; (match = fields.exec(text));) {
    // Decode field names independently, so escaped value delimiters stay intact.
    const name = (match[1] ?? match[2] ?? match[3]!)
      .replace(/\\u([0-9a-f]{4})|\\(.)/gi,
        (_, hex: string | undefined, char: string | undefined) => hex ? String.fromCharCode(parseInt(hex, 16)) : char!)
      .replace(/[_\-\u0000-\u0020\u007f]/g, "");
    if (!CREDENTIAL_NAME.test(name)) continue;
    // Leave an encoded opening delimiter intact until the decoding pass exposes
    // its whole quoted value. Consuming it as a scalar would leak later words.
    if (/^\\(?:["'\\]|u[0-9a-f]{4})/i.test(text.slice(fields.lastIndex))) continue;
    // Preserve the established Authorization header label while removing its scheme
    // and complete credential, rather than treating Bearer/Basic as the value alone.
    const header = match[3] !== undefined && name.toLowerCase() === "authorization"
      ? /^(?:bearer|basic)\s+\S+/i.exec(text.slice(fields.lastIndex)) : null;
    const end = header ? fields.lastIndex + header[0].length : valueEnd(text, fields.lastIndex);
    result += text.slice(copied, header ? fields.lastIndex : match.index) + "[secret]";
    copied = fields.lastIndex = end;
  }
  return result + text.slice(copied);
}

function credentials(text: string): string {
  let result = assignments(text), candidate = result;
  // Error text may embed stringified JSON more than once. Each decoding pass
  // strictly shortens the candidate. Keep the original formatting unless a newly
  // exposed credential assignment is actually redacted; never decode arbitrary prose.
  while (true) {
    const decoded = candidate.replace(/\\u([0-9a-f]{4})|\\(["'\\])/gi,
      (_, hex: string | undefined, char: string | undefined) => hex ? String.fromCharCode(parseInt(hex, 16)) : char!);
    if (decoded === candidate) return result;
    const redacted = assignments(decoded);
    if (redacted !== decoded) result = redacted;
    candidate = redacted;
  }
}

const RULES: [RegExp, string | ((match: string) => string)][] = [
  // JWTs and bearer-style tokens before anything that might split them.
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, "[token]"],
  // Legacy whitespace/Bearer forms: an unmatched quote in prose (Unexpected token ")
  // must not consume the rest of the diagnostic. Explicit assignments are handled above.
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
  let text = credentials(String(value).replace(/[\u0000-\u001f\u007f]+/g, " "));
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
