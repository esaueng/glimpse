// Diagnostics log only the error class: never request data, identities, payloads or messages.
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name || "Error" : typeof error;
}
export function logFailure(context: string, error: unknown) {
  console.error(`${context}: ${errorName(error)}`);
}
