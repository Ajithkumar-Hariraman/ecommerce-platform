// Apply the local Mailpit settings to an existing realm without reimporting it.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const origin = "http://127.0.0.1:8180";
const realm = origin + "/admin/realms/ecommerce";
const env = parseEnv(readFileSync(new URL("../../infra/.env", import.meta.url), "utf8"));
const template = JSON.parse(readFileSync(new URL("../../infra/keycloak/ecommerce-realm.json", import.meta.url), "utf8"));
const actions = template.requiredActions;
if (template.smtpServer.host !== "mailpit" || template.smtpServer.port !== "1025" ||
    !env.KC_BOOTSTRAP_ADMIN_USERNAME || !env.KC_BOOTSTRAP_ADMIN_PASSWORD)
  throw new Error("Local Mailpit settings and local Keycloak admin credentials are required");

async function request(url, options) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10000), ...options });
  if (!response.ok) throw new Error(`Local Keycloak returned HTTP ${response.status} at ${new URL(url).pathname}`);
  return response.status === 204 ? undefined : response.json();
}
const { access_token: token } = await request(origin + "/realms/master/protocol/openid-connect/token", {
  method: "POST",
  body: new URLSearchParams({
    grant_type: "password",
    client_id: "admin-cli",
    username: env.KC_BOOTSTRAP_ADMIN_USERNAME,
    password: env.KC_BOOTSTRAP_ADMIN_PASSWORD,
  }),
});
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const auth = realm + "/authentication";
const currentActions = await request(auth + "/required-actions", { headers });
await request(realm, { method: "PUT", headers, body: JSON.stringify({ smtpServer: template.smtpServer }) });
for (const action of actions) {
  const url = auth + "/required-actions/" + action.alias;
  const current = currentActions.find(({ alias }) => alias === action.alias);
  if (!current) {
    await request(auth + "/register-required-action", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: action.name, providerId: action.providerId }),
    });
  }
  await request(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({ ...action, config: { ...current?.config, ...action.config } }),
  });
  const configured = await request(url, { headers });
  if (configured.enabled !== action.enabled || configured.defaultAction !== action.defaultAction ||
      configured.priority !== action.priority ||
      Object.entries(action.config).some(([key, value]) => configured.config?.[key] !== value))
    throw new Error("Local Keycloak required action could not be confirmed: " + action.alias);
}
const configuredRealm = await request(realm, { headers });
if (Object.entries(template.smtpServer).some(([key, value]) => configuredRealm.smtpServer?.[key] !== value))
  throw new Error("Local Keycloak SMTP configuration could not be confirmed");
console.log("Local Keycloak uses Mailpit and requires email verification for new accounts.");
