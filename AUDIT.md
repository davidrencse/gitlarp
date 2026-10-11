# Code audit — 2026-09-29

This audit records the implementation before the real-account liquid-glass redesign. The current app removes demo mode, adds personal access token sign-in alongside OAuth, and includes additional API and browser coverage. See [README.md](README.md) for current behavior and verification commands.

## Current codebase review — 2026-10-02

The current workspace was checked after the changes below. `npm ci`, `npm run check`, `npm run build`, `npm test` (50 tests), `npm run test:e2e` (15 tests), `npm run test:production`, `npm audit --audit-level=high` (zero advisories), and `run.bat --check` all passed. The full live Groq analysis, Q&A, and README-generation smoke test was also verified with cooldowns between calls to stay within provider rate limits. GitHub Actions itself has not run for this workspace, and live GitHub publishing was not attempted.

### Findings fixed

| Priority | Finding | Fix and verification |
| --- | --- | --- |
| Medium | `run.bat` forced `GITHUB_LOCAL_AUTH=0`, making the documented `.env` opt-in ineffective in the normal Windows launcher. | Removed the override so the checked-in default remains off while a user's explicit `.env` setting is respected. Added a regression test for the launcher configuration. |
| Medium | A custom Git commit author name accepted control characters, including line breaks. | Reject control characters before sending author metadata to GitHub. Added a publish-schema regression test. |
| Low | `.env.example` still described the retired Llama/Pro model split after the Groq model switch. | Updated the comments to match the GPT-OSS defaults. |
| Low | Groq 429 errors discarded the provider's `Retry-After` guidance. | Preserve a bounded retry delay (numeric or HTTP-date form) in the API error and user-facing message; a regression test confirms the app does not retry automatically. |
| Medium | GitHub reads were serialized, the repository grid waited for every page, and repeat project actions refetched the same tree. Source evidence and preview originals were fetched serially too. | Allow up to four concurrent reads per account while keeping writes ordered, paced, and behind active reads. Read evidence/originals concurrently; stream repository pages; warm Markdown/workbench chunks; reuse session-bound snapshots after verifying repository identity, default branch, and HEAD. Unit, browser, and production checks pass. |

### Remaining risks and validation limits

- **History integrity:** publishing can assign a user-provided author and past commit dates. The UI labels this as fabricated, but the resulting Git metadata does not independently identify the author or date as fictional. A repository visitor may read it as a real work timeline. Treat this as a significant trust and reputation risk; the feature is off unless explicitly enabled.
- **Live GitHub paths:** OAuth credentials and live repository writes were not used in this audit. Auth, branch, fork, repository creation, and pull-request behavior is covered with mocked GitHub responses; organization policies, branch protection, and live asynchronous fork/repository readiness remain unverified.
- **Deployment scope:** sessions, previews, request queues, and publish replay state are in memory for one server process. Restarting loses them, and multi-instance deployment is not safe without coordinated shared state.
- **CI execution:** the workflow's commands passed locally after a clean lockfile install, but the workflow has not run on GitHub for this workspace.
- **Linting:** there is no lint script. CI runs type checking/build, unit tests, browser tests, production smoke, and the dependency advisory scan.

The reviewed app now passes 30 unit/API regression tests, five Chromium browser workflows, its TypeScript/production build, and an isolated runtime-only production smoke check. The npm advisory scan reports zero known vulnerabilities. This is a verified single-process implementation; live GitHub credentials and a multi-instance deployment were not available for verification.

## Findings and fixes

Severity describes the potential effect on this app, not a published vulnerability rating.

| Priority | Finding | Change | Evidence |
| --- | --- | --- | --- |
| High | Production startup invoked `tsx`, which is a development dependency and unavailable after a runtime-only install. | Compile the backend into `server-dist/`; `npm start` invokes Node directly. The backend stays outside the public frontend directory. | `scripts/smoke-production.mjs` installs with `npm ci --omit=dev` in an isolated directory and starts the compiled server. |
| High | Large previews lived inside session objects. Repeated serialization was expensive, and concurrent requests could overwrite publish state with an older session copy. | Separate bounded preview storage from sessions. Enforce ownership, an atomic per-preview publish lock, and replay of identical completed input within the preview lifetime. | `tests/state.test.ts` covers ownership, concurrent attempts, expiry, duplicate IDs, memory limits, and successful result replay. |
| High | Existing files could be treated as absent when the recursive tree was truncated or the contents response was too large to read. | Query original contents for every generated path; refuse oversized/unsupported originals. Reuse a README already read during inspection. | `tests/github-files.test.ts`; original comparisons in `server/app.ts`. |
| High | Sessions renewed without a firm creation-based lifetime; production configuration could accept a short secret or the wrong proxy assumptions. | Server-enforced 30-minute idle and eight-hour absolute expiry; secure HttpOnly SameSite cookies; production HTTPS and secret-length validation; explicit proxy IP/subnet configuration. | Session/config regression tests and the production secure-cookie smoke check. |
| Medium | GitHub writes were concurrent and unpaced, and all HTTP 403 responses were described as rate limits. | Serialize requests per credential, space writes by one second, distinguish permission failures from actual rate limits, and respect Retry-After/reset cooldowns. Never automatically retry writes with an unknown outcome. | `tests/github-client.test.ts`. |
| Medium | Uploading each file required an additional Git blob request. | Include file contents directly in each Git tree request and preserve `base_tree`. Each commit group needs one tree and one commit write instead of an extra blob write per file. | Publish tests verify tree content and absence of blob uploads. For F changed files in G nonempty groups, Git-object writes decrease from F + 2G to 2G, before ref/PR writes. |
| Medium | Fork preparation and new repository initialization could race immediate ref reads. | Use bounded backoff for expected 404/409 responses and include the created destination URL in subsequent errors. | Mocked branch/fork/new-repository tests cover destination history and failure handling structure. Delayed readiness still needs live-account validation. |
| Medium | React StrictMode could initialize two sessions simultaneously, producing competing cookie/CSRF pairs. | Share the in-flight session request. Add read/write timeouts and reject malformed successful HTTP responses. | API initialization unit test and browser assertion that startup sends one session request. |
| Medium | Superseded repository/project requests kept running. Late preview responses could populate a workspace after session expiry. | Abort obsolete read requests, guard asynchronous callbacks against account changes, and refresh state on authentication failure. | Browser workflow simulates session expiry while preview generation is pending. |
| Medium | Result counts included unchanged files, and draft PR failures discarded their specific reason. | Skip unchanged files/groups, report actual counts, retain the PR failure reason, and continue linking the successfully published branch. | Publishing regression test covers an unchanged README and a rejected draft PR. |
| Medium | Stored activity data was trusted without checking its shape; invalid data could crash rendering. | Validate saved values, restrict activity links to GitHub, fall back safely, and bound browser previews to ten entries. | Saved-state unit tests and corrupt-storage browser workflow. |
| Medium | JSON/body errors were reported inaccurately; public endpoints had no application throttling. | Return 400 for malformed JSON and 413 for oversized bodies; validate UTF-8 byte budgets; add bounded API, auth, and write rate limits. | Body, multibyte-content, and spoofed-IP retry-window tests. |
| Low | Mixed npm/Yarn/pnpm lockfiles could produce npm CI for a differently detected package manager. Existing `readme.md` could lead to a second README. | Require npm detection for generated npm CI; preserve observed Markdown README casing and omit empty documentation link sections. | Generator and GitHub inspection regression tests. |
| Low | Preview code loaded at startup; repository sorting and document lists recalculated on unrelated renders. Directory generation repeatedly scanned paths. | Lazy-load Workbench and Markdown, remove manual chunking that hoisted shared dependencies into the eager Markdown chunk, memoize derived UI lists, and index root directories in one pass. Keep preference validation small instead of importing Zod into the browser entry. | Production browser smoke check asserts that startup downloads only the entry script, then renders a preview and downloads a ZIP. |
| Low | Checks and dependency maintenance were manual; generated Actions used movable version tags. | Add a read-only CI workflow, verified full-SHA Action pins, and weekly Dependabot configuration. Pin generated CI Actions as well. | Every workflow command has passed locally; execution on GitHub has not occurred because this workspace is not a pushed repository. |

The unused `cookie-parser` dependency and its types were removed. Repository pagination now uses stable alphabetical API ordering, deduplicates IDs, and cancels superseded pagination. The UI still sorts the resulting collection by the user's choice.

## Performance evidence

These are Vite build sizes, not measured network latency or a Lighthouse score. Decimal kB values include JavaScript only and exclude fonts/CSS.

| Asset | Before audit | After audit | Loading behavior |
| --- | --- | --- | --- |
| Browser entry | 279.88 kB / 87.49 kB gzip | 277.77 kB / 87.84 kB gzip | Startup |
| Markdown renderer and its shared utilities | 166.20 kB / 51.07 kB gzip, eagerly loaded | 158.68 kB / 49.41 kB gzip across three chunks | Deferred until a Markdown preview is opened |
| Workbench | Part of browser entry | 14.96 kB / 5.10 kB gzip | Deferred until a project is opened |
| ZIP library | 97.30 kB / 30.15 kB gzip | 97.30 kB / 30.15 kB gzip | Deferred until downloading a bundle |

The startup path no longer imports or preloads the Markdown renderer. Startup JavaScript decreases from 446.08 kB to 277.77 kB, about 38%, or from 138.56 kB to 87.84 kB gzip, about 37%. The entry's gzip size by itself is slightly larger; the improvement comes from deferring preview functionality. No request-throughput benchmark or large-account render benchmark was performed.

## Research applied

Primary documentation was read during this audit; recommendations below explain the corresponding changes.

- [GitHub REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api): serial requests, pauses between mutations, conditional GETs, and rate-limit handling informed `server/github-client.ts`. Stable pagination ordering avoids reshuffling repositories while traversing pages.
- [GitHub create-tree API](https://docs.github.com/en/rest/git/trees#create-a-tree): tree entries support inline `content`, allowing removal of separate blob uploads while retaining the base tree.
- [GitHub fork API](https://docs.github.com/en/rest/repos/forks#create-a-fork): fork creation is asynchronous. Bounded readiness polling is this app's implementation choice based on that behavior.
- [GitHub OAuth authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps): token lifetime information informs reauthentication. Tokens remain server-side; no refresh token support was added.
- [GitHub API versions](https://docs.github.com/en/rest/overview/api-versions): confirmed the explicit `2026-03-10` REST version is supported.
- [Express production security](https://expressjs.com/en/advanced/best-practice-security.html) and [proxy configuration](https://expressjs.com/en/guide/behind-proxies.html): HTTPS, secure cookies, input validation, throttling, and topology-specific proxy trust informed configuration hardening.
- [express-session documentation](https://github.com/expressjs/session): the custom store implements `touch` for `resave: false`, keeps large previews out of serialized sessions, and requires a sufficiently long production secret. Length checks do not establish entropy; use the random-secret command in the README.
- [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html): idle and absolute timeouts are enforced by the server, independent of browser cookie lifetime.
- [React effect documentation](https://react.dev/reference/react/useEffect): development effect repetition and asynchronous cleanup informed in-flight session sharing and read-request cancellation.
- [Vite dynamic imports and preload behavior](https://vite.dev/guide/features.html): inspected the built import graph and removed manual chunk configuration that made preview dependencies eager. The production browser check verifies actual request timing.
- [esbuild bundling documentation](https://esbuild.github.io/api/#packages): bundle local backend modules and leave runtime packages external so deployed startup does not need the TypeScript runner.
- [GitHub Actions security hardening](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions): read-only token permissions, disabled checkout credential persistence, ordinary pull-request triggers, and verified full commit SHAs inform both app and generated CI. The checkout/setup-node pins were resolved from the official Actions repositories.

## Remaining work, in order

1. **Validate a real GitHub account.** Configure OAuth credentials and test public/private and organization repositories, restricted OAuth permissions, workflow scopes, branch protection, an existing diverged fork, and asynchronous initialization. Current integration tests use mocked GitHub responses. No external repository was changed during this audit.
2. **Make state durable before multiple instances or resilient deployment.** Replace sessions, plans, publish locks/result records, rate limits, and per-account queues with coordinated shared storage. Add durable progress/recovery for a process crash after a remote mutation. Current completed-result replay lasts only while the unexpired preview remains in this process. A network timeout cannot establish whether GitHub committed a write.
3. **Add deployment observability.** Introduce structured logs with request IDs, latency/error metrics, and health/readiness endpoints. Redact tokens and document reverse-proxy behavior and recovery. The current generic error handler intentionally sends limited detail to the browser, but operational diagnostics are still basic.
4. **Improve maintainability and large-account performance.** Split the large App and Workbench JSX into feature components, add lint/format checks, replace GitHub boundary `any` types with narrow schemas, follow pagination Link headers, and consider progressive repository rendering or virtualization when account sizes justify it. Stable sorting and cancellation do not provide a snapshot while GitHub repositories are being renamed or added.
5. **Expand repository-language support from evidence.** Current CI generation supports compatible npm projects. Add package-manager version detection before supporting pnpm/Yarn CI. Non-Markdown READMEs, unusual manifests, and monorepo-specific commands need explicit support rather than invented documentation.

## Reproduce verification

```powershell
npm test
npm run build
npm run test:e2e
npm run test:production
npm audit
```

Install Chromium with `npx playwright install chromium` first if it is missing. The production check uses a temporary dependency install; it does not prune workspace development packages. CI additionally installs the Linux dependencies needed by Chromium. The advisory scan is a point-in-time dependency check, not proof of absence of application vulnerabilities.
