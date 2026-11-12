// Error handling for the protected /api/* endpoints. A failed request may carry
// a JSON body `{ "error": "..." }` written by the worker (for example a pending
// D1 migration); that text is shown instead of a generic message.

/** Longest server message shown; anything longer is cut with an ellipsis. */
export const MAX_SERVER_MESSAGE = 300;

/** A request failure whose message came from the server and is safe to show. */
export class ServerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ServerError";
  }
}

/** Plain, single-line text of at most MAX_SERVER_MESSAGE characters, or null if empty. */
export function cleanServerMessage(text: string): string | null {
  const plain = text
    // Control characters (including newlines) become spaces.
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return null;
  const chars = [...plain];
  return chars.length > MAX_SERVER_MESSAGE
    ? `${chars.slice(0, MAX_SERVER_MESSAGE - 1).join("").trimEnd()}…`
    : plain;
}

/** The `error` string from a JSON error body, cleaned; null when there is none. */
export async function serverMessage(response: Response): Promise<string | null> {
  if (!(response.headers.get("Content-Type") ?? "").includes("application/json"))
    return null;
  try {
    const body: unknown = await response.json();
    return body &&
      typeof body === "object" &&
      typeof (body as { error?: unknown }).error === "string"
      ? cleanServerMessage((body as { error: string }).error)
      : null;
  } catch {
    return null;
  }
}

/**
 * The error to throw for a non-OK response: the server's own message when the
 * body provides one, otherwise a plain Error with `fallback`.
 */
export async function responseError(
  response: Response,
  fallback: string,
): Promise<Error> {
  const message = await serverMessage(response);
  return message === null
    ? new Error(fallback)
    : new ServerError(message, response.status);
}

/** The message to show for a failed load: the server's text, else `fallback`. */
export const loadErrorMessage = (error: unknown, fallback: string) =>
  error instanceof ServerError ? error.message : fallback;
