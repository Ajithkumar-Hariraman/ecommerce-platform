import { accessToken, expireSession } from "../auth/session";
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
export async function request<T>(
  path: string,
  options: RequestInit = {},
  authenticated = true,
): Promise<T> {
  const send = async (forceRefresh = false): Promise<Response> => {
    const token = authenticated ? await accessToken(forceRefresh) : undefined;

    const headers = new Headers(options.headers);

    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    if (token) headers.set("Authorization", `Bearer ${token}`);

    return fetch(`/api/v1${path}`, {
      ...options,
      headers,
    });
  };

  let response: Response;

  try {
    response = await send();

    // A token may expire between acquisition and API verification.
    // Refresh once and retry before ending the user's session.
    if (authenticated && response.status === 401) {
      response = await send(true);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("Cannot reach the API. Check the connection and try again.");
  }
  if (authenticated && response.status === 401) expireSession();
  if (response.status === 204 && response.ok) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const safe = body as { error?: { message?: unknown } } | null;
    throw new ApiError(
      typeof safe?.error?.message === "string"
        ? safe.error.message
        : `Request failed (${response.status}). Please try again.`,
      response.status,
    );
  }
  if (body === null) throw new Error("The API returned an unexpected response.");
  return body as T;
}

export const publicRequest = <T>(path: string, options: RequestInit = {}) =>
  request<T>("/storefront" + path, options, false);

export async function downloadOrderDocument(id: string, kind: "invoice" | "receipt") {
  const send = async (refresh = false) =>
    fetch(`/api/v1/orders/${encodeURIComponent(id)}/${kind}`, {
      headers: { Authorization: `Bearer ${await accessToken(refresh)}` },
    });
  let response = await send();
  if (response.status === 401) response = await send(true);
  if (!response.ok) {
    if (response.status === 401) expireSession();
    const body = await response.json().catch(() => null);
    throw new ApiError(
      body?.error?.message ?? "Document download is unavailable. Please try again.",
      response.status,
    );
  }
  if (!response.headers.get("content-type")?.includes("application/pdf"))
    throw new Error("Unexpected document response");
  const url = URL.createObjectURL(await response.blob()),
    link = document.createElement("a");
  link.href = url;
  link.download = `${kind}-${id.slice(0, 8)}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
