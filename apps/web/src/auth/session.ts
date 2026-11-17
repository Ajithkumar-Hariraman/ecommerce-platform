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
const redirectUri = () => window.location.origin + sessionReturnPath(window.location.pathname, window.location.search);
const returnUri = (path: string) => window.location.origin + safeReturnPath(path);
type Session = {
  ready: boolean;
  unavailable: boolean;
  authenticated: boolean;
  username: string;
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
  roles: [],
  firstName: "",
  lastName: "",
  email: "",
  emailVerified: null,
  error: "",
};
let session = initialSession;
let initializationFailed = false;
const listeners = new Set<() => void>();
function publish(error = "") {
  session = {
    ready: true,
    unavailable: initializationFailed,
    authenticated: !!keycloak.authenticated,
    ...profileFromClaims(keycloak.idTokenParsed ?? keycloak.tokenParsed),
    roles: (keycloak.tokenParsed?.resource_access?.["ecommerce-api"]?.roles ?? []).filter(
      (role: unknown): role is string => typeof role === "string",
    ),
    error,
  };
  listeners.forEach((listener) => listener());
}
keycloak.onAuthSuccess = () => publish();
keycloak.onAuthRefreshSuccess = () => publish();
keycloak.onAuthLogout = () => publish();
export function expireSession() {
  keycloak.clearToken();
  publish("Your session has ended. Please log in again.");
}
keycloak.onAuthRefreshError = expireSession;
keycloak.onTokenExpired = () => {
  void accessToken().catch(() => {});
};
let initialization: Promise<void> | undefined;
export function initializeSession(): Promise<void> {
  // One initialization across React StrictMode mounts; tokens remain in adapter memory.
  return (initialization ??= Promise.resolve()
    .then(() =>
      keycloak.init({
        onLoad: "check-sso",
        flow: "standard",
        pkceMethod: "S256",
        messageReceiveTimeout: initializationTimeout(
          import.meta.env?.VITE_KEYCLOAK_MESSAGE_TIMEOUT_MS,
        ),
        redirectUri: redirectUri(),
      }),
    )
    .then(() => publish())
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
    await keycloak.login({ redirectUri: returnUri(returnTo) });
  } catch {
    publish("Unable to open Keycloak login. Reload and try again.");
  }
}
export async function logout() {
  try {
    // Let the adapter submit the ID-token hint before clearing local tokens.
    await keycloak.logout({ redirectUri: window.location.origin + "/", logoutMethod: "POST" });
    keycloak.clearToken();
    publish();
  } catch {
    publish("Unable to complete secure sign-out. Please try again.");
  }
}
export async function accessToken(forceRefresh = false): Promise<string> {
  if (!session.authenticated) {
    throw new Error("Please log in to continue.");
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const exp = keycloak.tokenParsed?.exp;

    const tokenExpiredOrNearExpiry = typeof exp !== "number" || exp <= now + 30;

    await keycloak.updateToken(forceRefresh || tokenExpiredOrNearExpiry ? -1 : 30);

    const refreshedExp = keycloak.tokenParsed?.exp;

    if (
      !keycloak.authenticated ||
      !keycloak.token ||
      typeof refreshedExp !== "number" ||
      refreshedExp <= Math.floor(Date.now() / 1000)
    ) {
      throw new Error("Access token refresh failed");
    }

    return keycloak.token;
  } catch {
    expireSession();
    throw new Error("Your session has ended. Please log in again.");
  }
}

export async function register(returnTo = "/account") {
  await initializeSession();
  if (initializationFailed) return;
  try {
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
