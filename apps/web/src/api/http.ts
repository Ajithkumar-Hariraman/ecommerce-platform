export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new Error(
      "Cannot reach the API. Check the connection and try again.",
    );
  }
  if (response.status === 204 && response.ok) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const safe = body as { error?: { message?: unknown } } | null;
    throw new Error(
      typeof safe?.error?.message === "string"
        ? safe.error.message
        : `Request failed (${response.status}). Please try again.`,
    );
  }
  if (body === null)
    throw new Error("The API returned an unexpected response.");
  return body as T;
}
