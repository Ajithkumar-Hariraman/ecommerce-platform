# Phase 1 foundation archive

Historical learning material moved intact from README. Some setup instructions are superseded; see [current README](../README.md).

## Phase 1 foundation

Backend foundation only. Existing services/ content is preserved. No database, frontend, domain features, or deployment infrastructure is added.

## Run in WSL

```sh
cd /home/ak_soft_2017/projects/ecommerce-platform
nvm use
cd apps/api
npm ci
npm run dev
```

If nvm is not loaded, run `source ~/.nvm/nvm.sh` first.
Development binds to 127.0.0.1:3000. Configuration comes from exported shell variables; .env.example is a reference, not an automatically loaded file.

```sh
PORT=3001 HOST=127.0.0.1 NODE_ENV=development npm run dev
npm run typecheck
npm run build
npm start
npm test
```

Stop servers with Ctrl+C. `npm start` requires a successful build first.
`npm test` rebuilds and runs HTTP/lifecycle tests. Its watcher cleanup uses POSIX process groups: run tests in WSL/Linux.
Node 24 is pinned by .nvmrc and declared in engines; npm engines is advisory rather than a hard runtime gate.
package-lock.json locks the dependency graph; use npm ci for repeatable installs.

## Runtime flow

PROCESS START
→ server.ts
→ env validation
→ Express app
→ middleware
→ route
→ response

REQUEST FAILURE
→ route/application
→ error
→ centralized error handler
→ safe HTTP response

The startup chain creates the app once and opens a listening socket. The middleware-to-response portion runs for each request.
Express 5 forwards thrown synchronous errors and rejected async handlers to error middleware.
A startup error goes to main().catch(), logs, and sets exit status 1; it is not an HTTP response.
AppError identifies deliberately expected failures. Its message must be safe for public use.
Unknown errors receive a generic 500. Debug stacks remain in server logs; do not put secrets in error messages.
404 uses the same AppError path. JSON parser failures return safe 400/413 messages.
Error middleware is last and has four parameters so Express recognizes it. If headers were already sent, it delegates to Express's default handler.

Shutdown stops accepting connections and waits for active HTTP requests. After 10 seconds it forcibly closes connections and exits 1.
Repeated signals do not restart the deadline. Successful shutdown lets the event loop exit naturally.
There are no workers, upgraded sockets, or external resources to drain in Phase 1.
The health endpoint reports only that HTTP handling is alive; it makes no dependency-readiness claims.

## Dependencies

- express: routing and HTTP middleware; sole direct runtime dependency.
- typescript: strict checking and compiling src into dist.
- tsx: runs TypeScript during development and tests; watch restarts on edits.
- @types/node: compile-time Node 24 API definitions.
- @types/express: compile-time Express definitions.

No dotenv, validation package, test framework, or async-error wrapper is needed at this size.
TypeScript 5 is deliberately selected as a stable compiler line, not an assertion about the latest compiler version.

## File guide

FILE: .gitignore
WHY: Keep installed packages, compiled output, secrets, and logs out of Git.
WHO CALLS IT: Git.
INPUT: File paths.
OUTPUT: Ignore decisions.
WHAT CAN FAIL: Ignoring does not untrack previously committed files. Add new generated paths here.

FILE: .nvmrc
WHY: Select the Node 24 runtime used for verification.
WHO CALLS IT: nvm use.
INPUT: Major version 24.
OUTPUT: Selected shell runtime.
WHAT CAN FAIL: nvm or Node 24 may be missing. Change this together with engines and Node type definitions.

FILE: README.md
WHY: Explain operation and manual changes.
WHO CALLS IT: Developers.
INPUT: This Phase 1 design.
OUTPUT: Setup and learning instructions.
WHAT CAN FAIL: Documentation drifts if behavior changes without updates.

FILE: apps/api/package.json
WHY: Declare ESM, scripts, dependencies, and runtime requirements.
WHO CALLS IT: npm, Node, development tools.
INPUT: npm command and dependency declarations.
OUTPUT: Development process, checked types, compiled code, or running server.
WHAT CAN FAIL: Missing dependencies, wrong runtime, compiler errors, or absent dist for start. Edit scripts here.

FILE: apps/api/package-lock.json
WHY: Record the complete resolved dependency graph.
WHO CALLS IT: npm install / npm ci.
INPUT: Dependency resolution.
OUTPUT: Repeatable installations.
WHAT CAN FAIL: Manifest mismatch or registry/network failures. Update through npm, not manual edits.

FILE: apps/api/tsconfig.json
WHY: Strict ESM compilation with src as input and dist as output.
WHO CALLS IT: tsc.
INPUT: src/\*_/_.ts.
OUTPUT: JavaScript and source maps, or diagnostics.
WHAT CAN FAIL: Type errors and invalid imports. NodeNext models Node ESM; imports use .js even in source.
ES2022 supplies a conservative modern target. strict enables core correctness checks.
noUncheckedIndexedAccess exposes missing indexed values; exactOptionalPropertyTypes distinguishes absent properties from explicit undefined.
verbatimModuleSyntax makes type-only imports explicit; forceConsistentCasingInFileNames prevents case mistakes.
noEmitOnError avoids emitting a failing compilation. sourceMap supports original TypeScript stack locations.
skipLibCheck skips dependency declaration internals while still checking our use of their types.
Tests run through tsx, outside the production source build.

FILE: apps/api/.env.example
WHY: List supported settings without secrets.
WHO CALLS IT: The developer; it is not loaded automatically.
INPUT: PORT, HOST, NODE_ENV examples.
OUTPUT: Values to export in the shell.
WHAT CAN FAIL: Copying to .env alone does not configure this application.

FILE: apps/api/src/config/env.ts
WHY: One place reads and validates application environment.
WHO CALLS IT: server.ts inside main().
INPUT: process.env.PORT, HOST, NODE_ENV.
OUTPUT: Frozen typed configuration; defaults 3000, 127.0.0.1, development.
WHAT CAN FAIL: Invalid ports, empty/invalid bind addresses, unknown environment names.
HOST intentionally permits an IP literal or localhost. Use 0.0.0.0 when external binding is needed.
Add future application settings here and pass them to consumers rather than reading process.env elsewhere.
The lifecycle test uses process.env only to construct child-process test environments.

FILE: apps/api/src/app.ts
WHY: Assemble HTTP handling independently of process startup.
WHO CALLS IT: server.ts and HTTP tests.
INPUT: createApp() takes no arguments.
OUTPUT: Express app, without listening.
WHAT CAN FAIL: JSON parsing or request handlers; forwarded to error middleware.
Register future routers before the 404 handler; future business logic belongs in services, not routes.
The simple health response needs no service layer.

FILE: apps/api/src/server.ts
WHY: Own configuration, listening, startup failures, signals, and shutdown.
WHO CALLS IT: tsx in dev or Node through start.
INPUT: Validated configuration, OS signals, HTTP server events.
OUTPUT: Listening server, lifecycle logs, and process exit status.
WHAT CAN FAIL: Invalid environment, occupied/unavailable bind address, or shutdown deadline.
Change the fixed shutdown deadline here; add resource cleanup here when real resources exist.

FILE: apps/api/src/errors/app-error.ts
WHY: Distinguish expected application failures from programming errors.
WHO CALLS IT: 404 middleware; future application services; isolated tests.
INPUT: Integer HTTP status 400–599 and a safe message.
OUTPUT: AppError instance carrying statusCode.
WHAT CAN FAIL: Invalid status throws RangeError. Do not put internal diagnostics in its public message.
An additional operational flag would duplicate this type distinction at this stage.

FILE: apps/api/src/middleware/error-handler.ts
WHY: Consistent JSON errors and private diagnostic logging.
WHO CALLS IT: Express after next(error), throw, or rejected async handler.
INPUT: Unknown error, request, response, next.
OUTPUT: Intended AppError status, safe parser error, generic 500, or delegation after headers.
WHAT CAN FAIL: A disconnected client cannot receive a response; already-sent headers require delegation.
Extend known safe mappings deliberately; never blindly return arbitrary error.message.

FILE: apps/api/test/api.test.ts
WHY: Exercise actual HTTP responses and async error propagation.
WHO CALLS IT: npm test / Node test runner.
INPUT: Ephemeral HTTP ports and controlled requests.
OUTPUT: Assertions for health, 404, invalid/oversized JSON, expected 409, and unexpected 500.
WHAT CAN FAIL: Response regressions, binding errors, leaked connections.
Error-demo routes exist only in an isolated test app and are never exposed by createApp().

FILE: apps/api/test/lifecycle.test.ts
WHY: Verify the real process lifecycle.
WHO CALLS IT: npm test after build.
INPUT: Child-process config, signals, occupied ports, and an incomplete request body.
OUTPUT: Assertions for startup failures, dev HTTP behavior, and draining on both signals.
WHAT CAN FAIL: Runtime/tool absence, port race, process timeout, or shutdown regression.
WSL/POSIX process groups clean up npm and the development watcher.

## Verification record

Verified in WSL with Node v24.18.0:

- npm install express@5; npm install -D typescript@5 tsx @types/node@20 @types/express@5 (initial installed Node 20 checks).
- npm install -D @types/node@24 after selecting the installed Node 24 runtime.
- npm run typecheck: passed.
- npm run build: passed.
- npm test: five groups passed; no failures.
- npm run dev: started by lifecycle verification; health 200 and unknown route JSON 404 passed.
- Compiled server: health passed; SIGINT and SIGTERM both drained an in-flight request and exited 0.
- Invalid PORT (text, zero, out of range), HOST, NODE_ENV: exit 1 before listening.
- Occupied port: EADDRINUSE logged; exit 1.
- Expected error: 409 with safe message; unexpected async error: generic 500, diagnostic stack logged.
- JSON parsing: malformed 400, oversized 413.
- npm reported zero vulnerabilities at install time.

The forced 10-second shutdown deadline is implemented but was not exercised by these tests.
Tests shut down their own servers; no API process is intentionally left running.

Tool/environment issues: sandbox process initialization and direct patching failed before file creation. Authorized WSL commands created the files.
An unquoted inherited Windows PATH caused one runtime-selection command to fail; an explicit Linux PATH fixed it.
npm emitted an esbuild install-script advisory. tsx development and test execution succeeded; no blanket script approval was enabled.
No application typecheck/build/test failures occurred.

## References

- [Express 5 error handling](https://expressjs.com/en/5x/guide/error-handling/)
- [Node HTTP server lifecycle](https://nodejs.org/api/http.html)

Stop here. Phase 2 requires approval.
