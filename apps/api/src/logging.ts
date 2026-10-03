// Runtime entry points install JSON stdout/stderr for Cloud Logging and local collectors.
// Call sites remain responsible for excluding credentials, payloads and provider details.
export function installStructuredLogging(): void {
  for (const [method, severity] of [
    ["info", "INFO"],
    ["warn", "WARNING"],
    ["error", "ERROR"],
  ] as const) {
    const write = console[method].bind(console);
    console[method] = (...values: unknown[]) => {
      const message = values.filter((value) => typeof value === "string").join(" ");
      const details = values.filter((value) => typeof value !== "string");
      write(JSON.stringify({ severity, message, ...(details.length ? { details } : {}) }));
    };
  }
}
