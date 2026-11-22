# Milestone 2D — E-commerce administration

## Existing workflows and gaps

The React Operations area already had Keycloak sign-in, role-based navigation, dashboard counts, product CRUD, category creation and listing, price and stock editing, and product activation through the edit form. The API already supported streamed CSV import and signed cloud image uploads. Local Compose displayed bundled catalog images but had no upload store. Category editing and deletion and a browser entry point for CSV import were missing. A failed dashboard request could leave the count displaying “Loading…” indefinitely. A product save followed by a failed image upload could also leave the list looking stale.

## Changes

- Categories support editing the name, slug and status and deleting an unassigned category. Deleting a category with products returns 409 and leaves the products in place. The UI displays confirmation, pending, success and error states.
- The product form checks for a positive price and whole, nonnegative stock. It reports when product details saved but the image failed, refreshes the list and retries against the same product.
- The CSV panel submits the selected file to the existing streaming endpoint and displays imported and failed counts and sampled row errors. Imports can partially succeed, so the UI refreshes the catalog even after a failed request.
- Local Compose uses a dedicated named volume for product image bytes. The existing signed upload and image completion flow is reused. Local URLs expire after five minutes and are scoped to an operation and object. Uploads are capped at 5 MiB and checked for the declared size, media type and image signature. The API publishes a new immutable object only after writing it completely.
- The dashboard displays unavailable counts on request failure, the product page surfaces category-loading failures with a retry, and an admin thumbnail indicates when an image cannot load. The browser reuses unexpired image links by product revision, which avoids spending the catalog request budget on the same thumbnails after each edit.

## How it works

The browser checks roles to decide which navigation and routes to show. Express verifies the access token and checks the `ecommerce-api` client role again before any protected request reaches a catalog controller. A missing or invalid token receives 401. A valid customer token without catalog permission receives 403. Catalog managers can write catalog data, and the admin role also grants order administration. The public storefront publishes active products only.

React sends the entered price as integer paise, so ₹12.34 becomes 1234. That keeps the stored amount exact. The service checks price, stock and category IDs before asking a repository to persist a product. Both database implementations use the same API. PostgreSQL uses its existing foreign key to protect category references. For the local standalone MongoDB API, assignments and category deletions for the same category are serialized within the API process. Deletion hides a MongoDB category document and releases its slug while retaining its ID in storage. No schema migration is needed for existing records.

The database stores an image reference and revision. The image bytes live in the local volume or configured cloud bucket. Only a catalog manager or admin can request an upload URL and attach the uploaded image to a product. The storefront can request a read link for an active product.

## Reproduction

Run the API and web services with the existing local Compose file and Node 24. From `apps/web`, run `node test/e2e/local-admin.mjs` with Playwright Chromium installed, or set `CHROMIUM_EXECUTABLE` to an installed Chromium binary. The script uses existing local Keycloak bootstrap configuration, creates an ephemeral staff account and a separate customer, assigns the client admin role only to staff, and deletes its temporary accounts. It exercises the fixed local URLs and deletes owned catalog fixtures through their APIs. To run the same checks on MongoDB, recreate the API with `ORDER_STORAGE=mongodb` and refresh the web proxy. Restore the original backend after the check.

Run API typecheck, build and fast tests from `apps/api`. From the repository root, `node scripts/local/verify-integration.mjs` runs the existing local integration suite with PostgreSQL and MongoDB test databases. No external email or real payment is needed.

## Remaining limitations

- The standalone MongoDB write guard coordinates one API process. Multi-instance catalog writes would require a database-level transaction or another shared coordination strategy.
- Local images are for the development Compose stack. Old revisions and abandoned uploads remain in the image volume. A previously issued read URL can continue working until it expires. Restarting the API invalidates local URLs already issued. Signed cloud storage configuration is unchanged.

## Verification

Chromium ran the same workflow independently against the PostgreSQL and MongoDB API configurations. It exercised the actual local Keycloak login, Operations navigation and product dashboard count. A distinct customer account was denied access to each admin route. Direct HTTP calls confirmed 401 without a token and 403 with the customer token for catalog reads and writes, CSV import, image upload and completion, and the staff order listing.

The browser created a category, edited its name and status, assigned it to a new product, uploaded an image, edited price and stock, deactivated and reactivated the product, and deleted the product and category. The customer storefront decoded the uploaded image and reflected the edited price, zero stock, deactivation and deletion. CSV import reported one successful row and one rejected row. The API returned 409 on a duplicate category slug and on deleting an assigned category, 400 on invalid stock and invalid image bytes, and 403 on a tampered upload link.

| Check | PostgreSQL | MongoDB |
| --- | --- | --- |
| Keycloak administrator login, navigation and dashboard in Chromium | PASS | PASS |
| Customer route denial and protected API 401/403 | PASS | PASS |
| Category CRUD, uniqueness and assigned-category protection | PASS | PASS |
| Product CRUD, activation, prices and stock | PASS | PASS |
| Signed local image upload, validation and storefront display | PASS | PASS |
| Partial CSV import and browser feedback | PASS | PASS |
| Live cloud image upload or rendering | NOT TESTED | NOT TESTED |
| Multi-instance MongoDB category write coordination | — | NOT TESTED |

| Regression check | Result | Evidence |
| --- | --- | --- |
| API typecheck, build and fast tests | PASS | 224 passed, zero failed. |
| Web typecheck, build and fast tests | PASS | 4 passed, zero failed. |
| Reported Milestone 2C PostgreSQL order runtime startup failure | PASS | The PostgreSQL and MongoDB order runtime cases passed in three targeted runs and in the complete integration run. The prior startup failure did not reproduce. |
| Complete local API integration | FAIL | 106 passed, 1 failed, 7 opt-in skips. The PostgreSQL outbox runtime expected one failed publish attempt after an unreachable Kafka attempt and observed zero. Both adapter cases passed on an isolated rerun. The original full-run failure remains recorded. |
| Live AWS, GCS and Pub/Sub integration | NOT TESTED | The seven opt-in cloud integration cases were skipped. |

Integration used `ecommerce_test`. Browser verification used owned fixtures in the local development stores. The local API was restored to PostgreSQL after verification. Existing database records and volumes were preserved. Only API and web images were rebuilt. No external email or real payment was executed.
