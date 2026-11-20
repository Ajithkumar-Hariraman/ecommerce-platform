# Milestone 2B — Customer email verification and recovery

## How the flow works

1. The storefront sends the browser to Keycloak for registration. The customer enters their name, username, and email on Keycloak’s form.
2. Keycloak sends a short-lived, signed link. In local Docker, the Mailpit inbox catches this message. Open the message at `http://127.0.0.1:8025`. Its action link points to Keycloak at `http://127.0.0.1:8180`.
3. Keycloak checks the link and verifies that it still belongs to the account’s email address. For new registrations, Keycloak 26.7.4 collects the initial password after this step. Sign in and open **My account** to see **Verified**.
4. For recovery, use **Forgot your password? → Continue to password recovery** in the storefront, then **Forgot Password?** on the Keycloak page. Open the reset message in Mailpit and set a new password on Keycloak. Keycloak uses the same request acknowledgement for known and unknown accounts. [Keycloak server administration guide](https://www.keycloak.org/docs/26.7.5/server_admin/) · [Keycloak 26.7.4 registration password behavior](https://github.com/keycloak/keycloak/blob/26.7.4/services/src/main/java/org/keycloak/authentication/forms/RegistrationPassword.java)

## Findings and decisions

- The running realm already allowed registration and recovery. SMTP was unset and `VERIFY_EMAIL` was enabled as an optional action. Registration did not trigger it. The realm import also omitted `UPDATE_PASSWORD`, the native action that registration and recovery need to set a password. The storefront already delegated login, password reset, profile management, and logout to Keycloak and displayed the boolean `email_verified` claim in My account.
- The local realm now makes `VERIFY_EMAIL` a default action for new accounts. Realm-wide `verifyEmail` remains false, so existing customers are eligible to sign in under their existing rules. Existing signed-in users with an unverified address can open **My account → Verify email** and request a message on the secure Keycloak page.
- The checkout API still requires a valid customer session and enforces order ownership and existing staff permissions. It has no separate verified-email gate. New registrations must verify before Keycloak issues their first completed sign-in, so they verify before reaching authenticated checkout. Existing customers have the same checkout eligibility as before. The API's issuer, audience, signature, expiry, role, and ownership checks stayed in place.
- Resend stays inside Keycloak’s account action. The user must have a registration or authenticated flow and cannot select an arbitrary recipient through the storefront. The native per-user cooldown is 30 seconds for explicit resends. Keycloak’s initial challenge in a fresh required-action session is a separate path, so this cooldown should not be treated as a global outbound-mail quota. No new anonymous resend API or admin credential was added to the storefront. [Keycloak Verify Email action](https://github.com/keycloak/keycloak/blob/26.7.4/services/src/main/java/org/keycloak/authentication/requiredactions/VerifyEmail.java) · [Resend cooldown implementation](https://github.com/keycloak/keycloak/blob/26.7.4/services/src/main/java/org/keycloak/authentication/requiredactions/util/EmailCooldownManager.java)
- React shows a loading state while redirecting to sign-in, registration, recovery, or account verification. **Verified**, **Not verified**, and **Verification status unavailable** are distinct states. Keycloak renders action-link and credential errors. The storefront renders its existing safe provider error when a redirect cannot start.

## Exact local configuration

| Setting | Local value |
| --- | --- |
| SMTP server and port from inside Docker | `mailpit:1025` |
| SMTP sender | `Commerce Accounts <accounts@example.invalid>` |
| SMTP auth, SSL, STARTTLS | `false`, `false`, `false` on the local Docker network |
| Public Keycloak origin | Existing `KC_HOSTNAME=http://127.0.0.1:8180` |
| Browser inbox | `http://127.0.0.1:8025` |
| Verification action | Enabled and default for new accounts |
| Update Password action | Enabled on demand, priority 57, after Verify Email at priority 50 |
| Explicit resend cooldown | 30 seconds |
| User-generated action token lifespan | Existing 300 seconds for this local realm |

The local realm import template covers fresh installations. Keycloak skips import into an existing realm, so apply the targeted configuration to a running local realm from the repository root with Node 24.

```sh
node scripts/local/configure-keycloak-email.mjs
docker compose --env-file infra/.env -f infra/compose.yaml up -d --build --wait --no-deps web
```

The script reads existing admin credentials from ignored `infra/.env` and sends them only to the loopback Keycloak Admin CLI token endpoint. It updates SMTP and the two required actions in place. Mailpit catches local mail and the repository’s Compose service has no external relay configured. No realm reimport, volume reset, account deletion, provider switch, or cloud configuration change is needed.

## Files changed

- `infra/keycloak/ecommerce-realm.json` and `scripts/local/configure-keycloak-email.mjs` for local realm setup.
- `apps/web/src/commerce/Account.tsx` for redirect and verification states.
- `apps/api/test/auth.test.ts` and `apps/web/test/e2e/local-account-email.mjs` for configuration and browser regressions.
- This milestone report.

## Reproduce the checks

Run `npm run typecheck`, `npm run build`, and `npm test` in both `apps/api` and `apps/web`. From the root, `node scripts/local/verify-integration.mjs` runs the integration suite against the local `ecommerce_test` databases. With the local stack and Playwright Chromium available, run the browser test from the root.

```sh
node apps/web/test/e2e/local-account-email.mjs
```

Set `CHROMIUM_EXECUTABLE` if using an existing Chromium binary outside Playwright’s default location. The test uses unique `.invalid` fixture addresses and leaves their accounts and messages in place. It waits for real action-token expiry rather than modifying realm clocks or shortening lifetimes.

## Results

Node 24.18.0, Keycloak 26.7.4, Chromium, and the local Docker stack.

| Check | Result | Evidence |
| --- | --- | --- |
| Local configuration and storefront Docker build | PASS | The in-place script read back Mailpit and both required actions. The storefront image built and served the browser flow. |
| API typecheck, build, and fast tests | PASS | 223 tests passed. |
| Web typecheck, build, and fast tests | PASS | 16 tests passed. |
| PostgreSQL and MongoDB integration | PASS | 107 passed, 7 cloud opt-in skips. Includes order ownership and the simulator payment workflow on both adapters. |
| Registration, local email links, resend cooldown, and sign-in | PASS | Chromium received a local action link, verified after resend, set the initial password, and displayed Verified. |
| Invalid and reused verification links | PASS | Chromium checked a modified signature and confirmed that replay could not verify the address a second time. |
| Password reset and password replacement | PASS | Mailpit delivered the link. The old password was refused and the new password restored the verified session. Invalid and reused reset tokens were rejected. Known and unknown accounts received the same acknowledgement. |
| Existing unverified customer and account management | PASS | An existing-account fixture signed in, loaded My Orders, opened the native account console, and completed optional verification from the storefront. |
| Naturally expired verification and reset links | PASS | Chromium opened both untouched signed links after their actual expiry and Keycloak rejected them. |
| Session refresh and logout | PASS | Chromium observed a successful refresh-token exchange. My account still showed Verified and sign-out returned to the signed-out storefront. |
| Full session expiry and revocation scenarios | NOT TESTED | Deferred to Milestone 2E. |
| External email delivery | NOT TESTED | All milestone messages went to local Mailpit. |

The final browser suite exited successfully. Earlier runs identified the missing Update Password action and differences between Keycloak’s built-in theme and the test selectors. The final run covered those paths.

## Remaining manual checks

- To verify an existing unverified account manually, sign in, open **My account → Verify email**, and select **Send email** on Keycloak. Open the new local message, confirm the address, then return to My account.
- If testing from another device, use a development hostname reachable by that device and allowed by the local Keycloak client. The current links work on the machine hosting Docker.
- Broader idle session, absolute expiry, and revocation coverage belongs to Milestone 2E. External SMTP delivery and production identity settings are outside this local milestone.
