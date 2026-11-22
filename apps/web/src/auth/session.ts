/// <reference types="vite/client" />
import { initializationFailureCategory, initializationTimeout } from "./SessionNotice";
import { profileFromClaims, safeReturnPath, sessionReturnPath } from "./access";
import Keycloak from "keycloak-js";
import { useSyncExternalStore } from "react";

const keycloak = new Keycloak({
  url: import.meta.env?.VITE_KEYCLOAK_URL || "http://127.0.0.1:8180",
  realm: "ecommerce",
  clientId: "ecommerce-web",
});
const redirectUri = () =>
  window.location.origin + sessionReturnPath(window.location.pathname, window.location.search);
const returnUri = (path: string) => window.location.origin + safeReturnPath(path);
type Session = {
  ready: boolean;
  unavailable: boolean;
  authenticated: boolean;
  username: string;
  subject: string | undefined;
  error: string;
  roles: string[];
  firstName: string;
  lastName: string;
  email: string;
  emailVerified: boolean | null;
};
const initialSession: Session = {
  ready: false,
  unavailable: false,
  authenticated: false,
  username: "",
  subject: undefined,
  roles: [],
  firstName: "",
  lastName: "",
  email: "",
  emailVerified: null,
  error: "",
};
let session = initialSession;
let initializationFailed = false;
let signingOut = false;
let refreshRetry: ReturnType<typeof setTimeout> | undefined;
const logoutKey = "commerce-logout";
const loginKey = "commerce-login";
const loginAttemptKey = "commerce-login-attempt";
// Only event identifiers are shared. Credentials stay in adapter memory.
const logoutMarker = () => localStorage.getItem(logoutKey);
const eventId = () => crypto.getRandomValues(new Uint32Array(2)).join("-");
const expiredMessage = "Your session has ended. Please log in again.";
const recoveryMessage = "Unable to reconnect to the account provider. Retrying…";
function tokenIsCurrent() {
  return (keycloak.tokenParsed?.exp ?? 0) > Date.now() / 1000;
}

const listeners = new Set<() => void>();
function publish(error = "") {
  const authenticated = !signingOut && !!keycloak.authenticated && tokenIsCurrent();

  session = {
    ready: true,
    unavailable: initializationFailed,
    authenticated,
    subject: authenticated ? keycloak.tokenParsed?.sub : undefined,
    ...profileFromClaims(
      authenticated ? (keycloak.idTokenParsed ?? keycloak.tokenParsed) : undefined,
    ),
    roles: (authenticated
      ? (keycloak.tokenParsed?.resource_access?.["ecommerce-api"]?.roles ?? [])
      : []
    ).filter((role: unknown): role is string => typeof role === "string"),
    error,
  };
  listeners.forEach((listener) => listener());
}
function clearLocalSession(error = "") {
  clearTimeout(refreshRetry);
  keycloak.clearToken();
  publish(error);
}
keycloak.onAuthRefreshSuccess = () => {
  clearTimeout(refreshRetry);
  if (signingOut || logoutMarker()) clearLocalSession();
  else publish();
};
keycloak.onAuthLogout = () => {
  clearTimeout(refreshRetry);
  publish(signingOut ? "" : expiredMessage);
};
export function expireSession() {
  if (signingOut || logoutMarker()) return;
  localStorage.setItem(logoutKey, eventId());
  clearLocalSession(expiredMessage);
}
function refreshInBackground() {
  void accessToken().catch(() => {});
}
keycloak.onTokenExpired = refreshInBackground;
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === logoutKey && event.newValue) {
      signingOut = true;
      sessionStorage.removeItem(loginAttemptKey);
      clearLocalSession();
    }
    if (event.key === loginKey && !session.authenticated && !logoutMarker()) {
      window.location.reload();
    }
  });
  // A back/forward cache snapshot can contain an already-rendered account page.
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) document.documentElement.style.visibility = "hidden";
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  });
}
let initialization: Promise<void> | undefined;
export function initializeSession(): Promise<void> {
  // One initialization across React StrictMode mounts; tokens remain in adapter memory.
  return (initialization ??= Promise.resolve()
    .then(async () => {
      const marker = logoutMarker();
      const attempt = sessionStorage.getItem(loginAttemptKey);
      const explicitLogin = attempt !== null && attempt === (marker ?? "");
      sessionStorage.removeItem(loginAttemptKey);
      await keycloak.init({
        ...(marker ? {} : { onLoad: "check-sso" }),
        flow: "standard",
        pkceMethod: "S256",
        messageReceiveTimeout: initializationTimeout(
          import.meta.env?.VITE_KEYCLOAK_MESSAGE_TIMEOUT_MS,
        ),
        redirectUri: redirectUri(),
      });
      if (signingOut || logoutMarker() !== marker || (marker && !explicitLogin)) {
        clearLocalSession();
        return;
      }
      if (explicitLogin && keycloak.authenticated) {
        localStorage.removeItem(logoutKey);
        localStorage.setItem(loginKey, eventId());
      }
      publish();
    })
    .catch((error: unknown) => {
      initializationFailed = true;
      keycloak.clearToken();
      console.warn("Account provider initialization failed", {
        category: initializationFailureCategory(error),
      });
      publish(
        "Sign-in is temporarily unavailable. You can still browse and use your cart. Reload to try again.",
      );
    }));
}
export function useSession() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => session,
    () => initialSession,
  );
}
export async function login(returnTo = window.location.pathname + window.location.search) {
  await initializeSession();
  if (initializationFailed) return;
  try {
    const marker = logoutMarker();
    sessionStorage.setItem(loginAttemptKey, marker ?? "");
    await keycloak.login({
      redirectUri: returnUri(returnTo),
      ...(marker ? { prompt: "login" } : {}),
    });
  } catch {
    publish("Unable to open Keycloak login. Reload and try again.");
  }
}
export async function logout() {
  signingOut = true;
  localStorage.setItem(logoutKey, eventId());
  sessionStorage.removeItem(loginAttemptKey);
  publish();
  try {
    await keycloak.logout({ redirectUri: window.location.origin + "/", logoutMethod: "POST" });
    clearLocalSession();
  } catch {
    clearLocalSession(
      "Signed out of this store. The account provider could not complete sign-out.",
    );
  }
}

export async function accessToken(forceRefresh = false): Promise<string> {
  if (signingOut || logoutMarker() || !keycloak.authenticated) {
    throw new Error(session.error || "Please log in to continue.");
  }

  try {
    await keycloak.updateToken(forceRefresh || !tokenIsCurrent() ? -1 : 30);
  } catch {
    // The adapter clears its tokens when Keycloak rejects a refresh grant (HTTP 400).
    if (signingOut || logoutMarker()) throw new Error("Please log in to continue.");
    if (!keycloak.authenticated || !keycloak.refreshToken) {
      expireSession();
      throw new Error(expiredMessage);
    }
    publish(recoveryMessage);
    clearTimeout(refreshRetry);
    refreshRetry = setTimeout(() => void accessToken(true).catch(() => {}), 5000);
    if (!forceRefresh && tokenIsCurrent() && keycloak.token) return keycloak.token;
    throw new Error(recoveryMessage);
  }

  if (signingOut || logoutMarker() || !keycloak.token || !tokenIsCurrent()) {
    throw new Error(session.error || "Please log in to continue.");
  }
  return keycloak.token;
}

export async function register(returnTo = "/account") {
  await initializeSession();
  if (initializationFailed) return;
  try {
    sessionStorage.setItem(loginAttemptKey, logoutMarker() ?? "");
    await keycloak.register({ redirectUri: returnUri(returnTo) });
  } catch {
    publish("Unable to open account registration. Please try again.");
  }
}
export async function forgotPassword() {
  await initializeSession();
  if (initializationFailed) return;
  // Keycloak's login page owns the native Forgot password flow and reset tokens.
  try {
    sessionStorage.setItem(loginAttemptKey, logoutMarker() ?? "");
    await keycloak.login({ redirectUri: returnUri("/account"), prompt: "login" });
  } catch {
    publish("Unable to open secure password recovery.");
  }
}
export async function manageAccount() {
  try {
    await keycloak.accountManagement();
  } catch {
    publish("Unable to open account management.");
  }
}
export async function verifyEmail() {
  try {
    await keycloak.login({ action: "VERIFY_EMAIL", redirectUri: returnUri("/account") });
  } catch {
    publish("Email verification is unavailable. Please contact support.");
  }
}
