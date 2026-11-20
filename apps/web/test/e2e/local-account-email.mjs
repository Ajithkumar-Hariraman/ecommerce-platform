// Local Docker only. Unique .invalid accounts and Mailpit messages are retained.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const storefront = "http://localhost:8088";
const issuer = "http://127.0.0.1:8180";
const mailpit = "http://127.0.0.1:8025/api/v1";
const originalPassword = `Initial!${randomUUID()}a9`;
const replacementPassword = `Changed!${randomUUID()}b9`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
});
const check = (label) => console.log("PASS " + label);
const fixture = (tag) => `m2b-${tag}-${randomUUID()}@example.invalid`;
async function mail(path) {
  const response = await fetch(mailpit + path, { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200, "Mailpit API available");
  return response.json();
}
async function messages(email) {
  const query = encodeURIComponent("to:" + email);
  return (await mail("/search?query=" + query)).messages ?? [];
}
async function link(email, subject, skip = []) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const summary = (await messages(email)).find((item) =>
      subject.test(item.Subject) && !skip.includes(item.ID));
    if (summary) {
      const message = await mail("/message/" + summary.ID);
      const href = message.HTML.match(/href="([^"]*\/login-actions\/action-token[^"]*)"/)?.[1];
      assert.ok(href, "Mail contains an action link");
      const url = new URL(href.replaceAll("&amp;", "&"));
      assert.equal(url.origin, issuer, "Email uses the browser-reachable local Keycloak origin");
      assert.equal(url.pathname, "/realms/ecommerce/login-actions/action-token");
      const token = url.searchParams.get("key");
      const { exp } = JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
      return { id: summary.ID, url, exp };
    }
    await delay(500);
  }
  assert.fail("Expected account email did not reach Mailpit");
}
async function register(page, email) {
  await page.goto(storefront + "/register");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.locator("#firstName").waitFor();
  await page.locator("#firstName").fill("Email");
  await page.locator("#lastName").fill("Fixture");
  await page.locator("#email").fill(email);
  const username = page.locator("#username");
  if (await username.isVisible()) await username.fill(email.split("@")[0]);
  assert.equal(await page.locator("#password").count(), 0, "Password is set after verification");
  await page.locator('form input[type="submit"], form button[type="submit"]').first().click();
  await page.getByText(/need to verify|verification email|verify your email/i).first().waitFor();
}
async function login(page, email, password) {
  await page.goto(storefront + "/login?returnTo=/account");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.locator("#username").fill(email);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
}
async function logout(page) {
  await page.getByRole("button", { name: "Sign out", exact: true }).first().click();
  await page.waitForURL(storefront + "/");
  await page.getByRole("link", { name: "Sign in", exact: true }).first().waitFor();
}
async function reset(page, email) {
  await page.goto(storefront + "/login");
  await page.getByText("Forgot your password?", { exact: true }).click();
  await page.getByRole("button", { name: "Continue to password recovery" }).click();
  await page.getByRole("link", { name: /forgot password/i }).click();
  await page.locator("#username").fill(email);
  await page.locator('form input[type="submit"], form button[type="submit"]').first().click();
  const notice = page.getByText(/you should receive an email shortly/i);
  await notice.waitFor();
  return notice.innerText();
}
async function setPassword(page, password) {
  await page.locator("#password-new").fill(password);
  await page.locator("#password-confirm").fill(password);
  await page.locator("#password-confirm").press("Enter");
}
async function openAction(page, url) {
  await page.goto(url.toString());
  assert.equal(new URL(page.url()).origin, issuer);
  const proceed = page.getByRole("link", { name: /click here to proceed/i });
  if (await proceed.isVisible()) await proceed.click();
}
function tampered(url) {
  const invalid = new URL(url);
  const parts = invalid.searchParams.get("key").split(".");
  parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
  invalid.searchParams.set("key", parts.join("."));
  return invalid;
}
async function rejected(page, action, message) {
  await page.goto(action.toString());
  const notice = await page.locator("body").innerText();
  assert.match(notice, message);

  assert.equal(await page.locator("#password-new").count(), 0);
}

try {
  const email = fixture("journey");
  const registration = await browser.newPage();
  await register(registration, email);
  const initial = await link(email, /verify email/i);
  check("registration delivers a local verification link");
  const resend = registration.getByRole("link", { name: /click here|resend/i }).last();
  await resend.click();
  await registration.getByText(/wait .*seconds|try again in|cooldown/i).first().waitFor();
  assert.equal((await messages(email)).length, 1);
  check("immediate resend is blocked at Keycloak without another email");

  const expiryEmail = fixture("expiry");
  const expiryPage = await browser.newPage();
  await register(expiryPage, expiryEmail);
  const expiredVerify = await link(expiryEmail, /verify email/i);

  const bad = await browser.newPage();
  await rejected(bad, tampered(initial.url), /invalid|could not verify|no longer valid|expired|stale/i);
  check("tampered verification link rejected");
  await delay(31000);
  await resend.click();
  const fresh = await link(email, /verify email/i, [initial.id]);
  check("resend after cooldown delivers another local link");

  const customer = await browser.newPage();
  await openAction(customer, fresh.url);
  await setPassword(customer, originalPassword);
  await login(customer, email, originalPassword);
  await customer.waitForURL(storefront + "/account");
  await customer.getByText("Verified", { exact: true }).waitFor();
  check("cross-browser verification followed by sign-in shows Verified");
  await rejected(bad, fresh.url, /verified.*already|already.*verified|already.*used|invalid|no longer valid|expired|stale/i);
  check("reused verification link has no second effect");
  await logout(customer);
  check("verified session signs out and storefront returns to signed-out state");

  const recovery = await browser.newPage();
  const known = await reset(recovery, email);
  const expiredReset = await link(email, /reset password/i);
  const missingEmail = fixture("unknown");
  assert.equal(await reset(recovery, missingEmail), known);
  assert.equal((await messages(missingEmail)).length, 0);
  check("password-reset response does not reveal account existence");
  await rejected(bad, tampered(expiredReset.url), /invalid|could not verify|no longer valid|expired|stale|reset credential not allowed/i);
  check("tampered reset token rejected");
  assert.ok(await reset(recovery, email));
  const freshReset = await link(email, /reset password/i, [expiredReset.id]);
  await openAction(recovery, freshReset.url);
  await setPassword(recovery, replacementPassword);
  await rejected(bad, freshReset.url, /expired|invalid|already.*used|no longer valid|reset credential not allowed/i);
  check("used reset token cannot set another password");
  const changed = await browser.newPage();
  await login(changed, email, originalPassword);
  await changed.getByText(/invalid username or password/i).first().waitFor();
  await changed.locator("#password").fill(replacementPassword);
  await changed.locator("#kc-login").click();
  await changed.waitForURL(storefront + "/account");
  await changed.getByText("Verified", { exact: true }).waitFor();
  let refreshObserved = false;
  changed.on("response", (response) => {
    const request = response.request();
    if (response.ok() && request.url() === issuer + "/realms/ecommerce/protocol/openid-connect/token" &&
        new URLSearchParams(request.postData() ?? "").get("grant_type") === "refresh_token")
      refreshObserved = true;
  });
  check("password reset rejects the old password and new sign-in stays verified");

  const expiry = Math.max(expiredVerify.exp, expiredReset.exp);
  const remaining = expiry * 1000 - Date.now() + 2500;
  assert.ok(remaining <= 310000, "Unexpected local action token lifetime");
  await delay(Math.max(0, remaining));
  await rejected(bad, expiredVerify.url, /expired|no longer valid/i);
  await rejected(bad, expiredReset.url, /expired|no longer valid/i);
  check("original signed verification and reset links rejected after natural expiry");

  await changed.getByRole("link", { name: /my orders/i }).last().click();
  await changed.getByRole("heading", { name: "My orders", exact: true }).waitFor();
  // Access tokens in the local realm last five minutes. Keep this browser open long enough
  // for its real adapter refresh, without altering realm session lifetimes.
  for (let i = 0; !refreshObserved && i < 30; i++) await delay(1000);
  assert.equal(refreshObserved, true, "Browser refreshed its access token with Keycloak");
  await changed.getByRole("link", { name: "My account", exact: true }).first().click();
  await changed.getByText("Verified", { exact: true }).waitFor();
  await logout(changed);
  check("automatic refresh retains verified status; logout still works");
} catch (error) {
  // Action and callback URLs can contain secrets. Keep browser failure output free of them.
  const message = error instanceof Error ? error.message : "Unknown browser error";
  console.error(message
    .replaceAll(/https?:\/\/\S+/g, "[URL redacted]")
    .replaceAll(/m2b-[a-z]+-[0-9a-f-]+@example\.invalid/gi, "[fixture email redacted]")
    .replaceAll(originalPassword, "[password redacted]")
    .replaceAll(replacementPassword, "[password redacted]"));
  process.exitCode = 1;
} finally {
  await browser.close();
}
