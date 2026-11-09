export function SessionNotice({ pathname, error }: { pathname: string; error: string }) {
  const accountRoute = /^\/(login|register|account|checkout|orders|notifications|admin)(\/|$)/.test(pathname);
  if (!error || !accountRoute) return null;
  return <p role="alert" className="error session-error">{error}</p>;
}

// Only classifications are logged: never provider payloads, callback URLs or tokens.
export function initializationFailureCategory(error: unknown): string {
  const message = error instanceof Error ? error.message :
    typeof error === "object" && error !== null && "error" in error && typeof error.error === "string"
      ? error.error : "";
  if (/timeout|timed out/i.test(message)) return "provider-timeout";
  if (/fetch|network/i.test(message)) return "provider-network";
  return "provider-initialization";
}

export function initializationTimeout(raw: string | undefined): number {
  const value = raw ?? "60000";
  const milliseconds = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(milliseconds) || milliseconds < 1000 || milliseconds > 120000)
    throw new Error("Invalid account provider initialization timeout");
  return milliseconds;
}
