# GitLarp

A GitHub project workspace with a black-and-white liquid-glass UI and a native WebGL visual. Connect your account, browse your repositories, generate useful improvements, review files and commit messages, and publish a new branch, fork, or documentation repository.

Every repository and publish result comes from the authenticated GitHub API. Signed-out users see the connection screen. Synthetic repositories are confined to automated test fixtures.

## Run locally

Requires Node.js 22.13 or later.

**On Windows, double-click `run.bat`.** It prepares `.env` with a random session secret when that file is missing, installs dependencies on the first run, starts both servers, and opens your browser once the app is ready. Existing `.env` settings are preserved. Keep the terminal window open while using the app; press **Ctrl+C** to stop. If the app is already running, the launcher opens it without starting duplicate servers.

If GitHub CLI is signed in on this computer, **Continue with GitHub** connects that account directly. Otherwise, connect with a personal access token or configure browser OAuth below.

To start manually:

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open **http://localhost:5173**. Vite serves the interface on port 5173 and proxies `/api` and `/auth` to Express on port 3001. A GitHub connection is required to access projects. The development server fails clearly if port 5173 is occupied so OAuth does not silently switch to another origin.

## Connect GitHub

### One-click local connection

With [GitHub CLI](https://cli.github.com/manual/gh_auth_login) installed and signed in, the opening screen shows the account that **Continue with GitHub** will connect. If needed, run `gh auth login --hostname github.com --web --scopes repo,workflow`, then refresh the app. No OAuth app registration or pasted token is needed for this local method.

The backend reads the existing CLI credential only when you click, validates the selected account with GitHub, and creates an expiring app session. The credential stays server-side; the existing CLI credential store is managed by GitHub CLI. Disconnecting the app clears its session without signing GitHub CLI out. This option is off by default. Set `GITHUB_LOCAL_AUTH=1` in `.env` to opt in; `run.bat` respects that setting. It is disabled in production and on non-loopback app origins, and the endpoint accepts only loopback connections with valid CSRF/origin checks. Any local process could then use that login, so a fine-grained token is the recommended path.

### Personal access token

Paste a token into the opening screen and choose **Connect with token**. The server validates it with GitHub, regenerates the session, and keeps the token in expiring server memory. The token is not returned to the browser or persisted in `.env`, localStorage, or a database. Disconnecting removes the session.

Prefer a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with access to the repositories you need, Contents read/write and Pull requests read/write. Adding CI also requires Workflows write permission. Some repository creation/fork operations depend on token type, organization policies, and additional endpoint permissions. A classic token with `repo`, `read:user`, and `workflow` supports the broad workflow. GitHub's [token documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) explains restrictions and expiration. Choose an expiration and grant only the permissions you need.

### Browser OAuth

1. [Register a GitHub OAuth app](https://github.com/settings/applications/new).
2. Set the homepage URL to `http://localhost:5173`.
3. Set the authorization callback URL to `http://localhost:5173/auth/github/callback`.
4. Add the client ID and secret to `.env`:

```dotenv
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
SESSION_SECRET=your-long-random-secret
APP_URL=http://localhost:5173
PORT=3001
```

Generate a session secret:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Restart `npm run dev`, then click **Continue with GitHub**. Sessions expire after 30 minutes without activity or eight hours from creation, whichever comes first. If GitHub returns an expiring token, the app requires sign-in again before token expiry; automatic token refresh is not implemented.

The OAuth flow uses random state, PKCE, session regeneration, and an HttpOnly SameSite cookie. Access tokens stay in expiring server memory. Browser writes require a session-specific CSRF token and same-origin validation.

Requested scopes are `read:user`, `repo`, and `workflow`. These allow identity lookup, listing accessible public/private repositories, repository creation, forks, branches, pull requests, and writing reviewed CI files. OAuth app access can be restricted by organization policies. A GitHub App with repository-level installation permissions is a sensible later deployment option.

See GitHub's [OAuth authorization documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) and [Git commit API](https://docs.github.com/en/rest/git/commits#create-a-commit) for the underlying flow.

## What it generates

| Improvement | Files |
| --- | --- |
| README | `README.md` |
| Setup and architecture | `docs/SETUP.md`, `docs/ARCHITECTURE.md` |
| Contributor guide | `CONTRIBUTING.md` |
| Recent changes | `docs/CHANGELOG.md` |
| Issue and pull request templates | `.github/ISSUE_TEMPLATE/*.md`, `.github/pull_request_template.md` |
| Editor configuration | `.editorconfig` |
| CI for compatible npm projects | `.github/workflows/ci.yml` |

With Groq configured, the workspace analyzes selected source excerpts, explains capabilities and architecture with file citations, answers project questions, and drafts complete Markdown for the selected paths. Both technical depth and clear project presentation are the default focus; change the direction before generating. Generated claims need review. CI, editor configuration, and the changelog remain deterministic; the changelog preserves actual source commit subjects and dates.

Without a key, or with **Use Groq for generated documentation** unchecked, the existing repository-aware generator remains available. It uses metadata, the file tree, `package.json`, the current README and recent commits. Existing Markdown README filename casing is preserved. CI is offered only when npm is detected, an npm lockfile exists and check scripts are declared. Generated CI honors detected Node requirements, pins Actions to verified commits and uses read-only repository permissions.

## Groq setup and token efficiency

Set these server-only values in `.env`, then restart `run.bat`:

```dotenv
GROQ_API_KEY=your-key
GROQ_MODEL=openai/gpt-oss-120b
GROQ_ANALYSIS_MODEL=openai/gpt-oss-120b
GROQ_CONTEXT_CHARS=48000
```

The key never goes to the browser. Selected source excerpts, including excerpts from private repositories, go to Groq when you request analysis, answers or AI generation. Private environment files, credential directories, keys and generated/vendor files are excluded; recognized credential patterns are redacted. Example environment values are omitted. Filtering cannot guarantee that every possible secret in arbitrary source is recognized, so use repositories whose selected source may be shared with the provider.

Token controls:

- Source collection samples at most 12 files, 8,000 characters per file and 48,000 source characters by default. `GROQ_CONTEXT_CHARS` is configurable from 16,000 to 160,000. Coverage and truncation are visible.
- GPT-OSS 120B handles analysis, Q&A and final Markdown by default. Set `GROQ_ANALYSIS_MODEL` to another available GPT-OSS model to use a separate analysis model. Output budgets depend on the requested files and stop at 12,000 tokens.
- An unchanged repository snapshot and identical instructions reuse analysis for 20 minutes within the same session, with no new model call. Changing the snapshot or instructions invalidates reuse. Document generation reuses a matching stored analysis rather than asking the model to write it again.
- Q&A retrieves at most four relevant excerpts of 1,800 characters each using local matching and analysis citations. It sends four short relevant facts and at most four bounded conversation turns, excluding the full file tree, manifest and commit inventory.
- Prompts omit duplicate sampled paths, a duplicate full package manifest, excess commit details, and generic document templates. File-specific directions reduce repeated prose. Groq prompt caching is automatic on supported models and best effort. Actual input, output and cached-input usage is shown when returned by the provider. Cached-input tokens are included in input totals.
- Selections containing only deterministic changelog, CI or editor configuration files make no model call. One AI job may run per session, with four jobs across the process. Leaving the project, disconnecting or closing the request cancels outstanding work. Citation mistakes get one bounded repair attempt; other failed requests are not automatically retried, and invalid or incomplete results never become publishable previews.

Analysis and source context use bounded server memory (8 MB, up to three entries per session). Disconnecting clears that session's context. Expired context requires a fresh analysis. Neither analysis nor generation publishes anything.

Groq's [chat completion API](https://console.groq.com/docs/api-reference) documents JSON output and model selection. Its [prompt caching guide](https://console.groq.com/docs/prompt-caching) describes automatic prefix caching.

No code or scripts from selected repositories are executed by the server. Individual files are limited to 250 KB in UTF-8, and the combined published contents to 1 MB. Oversized or unsupported existing files are refused for replacement. Truncated GitHub trees are marked as incomplete; originals are checked directly before generating a publishable preview.

## Publishing

1. Choose a project and the improvements it needs.
2. Generate a preview, inspect the original file, edit source, and adjust commit messages.
3. Download the complete ZIP or choose a publishing destination.
4. Publish real file changes in cohesive commit groups on a **new branch**, or publish each changed group to its own branch. Optionally open a draft pull request for each branch.

Destinations:

- **New branch:** the selected repository; write access is required.
- **Fork:** the user's account; GitHub prepares the fork, then GitLarp publishes a branch. If an existing fork has diverged, select that fork and generate a fresh preview.
- **New documentation repository:** only the reviewed documentation/configuration files are copied. The original project's source code is not duplicated. CI must be omitted because it needs the source code.

Original history is preserved. By default GitLarp uses the authenticated user's identity and the actual commit creation time. You can optionally backdate commits and set a fabricated author: turn on **Backdate commits with a fabricated author** on the publish step, choose a name, email, and an earliest/latest date, and the reviewed commits are spaced evenly across that range under the chosen identity. Separate branches contain their own reviewed change group and start from the selected repository head. Empty or archived repositories need initial commits or appropriate access before they can be improved.

Plans expire after 30 minutes, and publishing fails if the default branch has changed since preview generation. The server validates the exact generated file set, rejects duplicate paths, and creates the branch ref only after all commit objects are ready. Concurrent publishing of the same preview is rejected. Repeating identical successful input returns the saved result while that preview remains in memory and has not expired. Existing branches are not overwritten. If a new repository was created but publishing fails, the error identifies the created repository. Draft PR creation may fail independently; the UI shows the reason and links the published branch. Result counts reflect only files actually changed.

GitHub requests are serialized per credential. Writes are paced at least one second apart, and rate-limit responses establish a cooldown with a retry time. GET responses use a bounded, account-isolated ETag cache. Writes are never automatically retried; after a network timeout, check GitHub before trying again because an action may already have succeeded.

## Check the app

```powershell
npm run build
npm test
npx playwright install chromium
npm run test:e2e
npm run test:production
npm audit
```

Unit and API tests cover generation, commit grouping, stale previews, path validation, original-file limits, CSRF, OAuth state, session expiry, plan locking, rate limits, conditional caching, and browser request initialization. Browser tests cover repository search/filtering, mobile layout, editing, ZIP contents, the authenticated publish workflow, malformed saved state, and session changes during pending previews. The production smoke check installs only runtime dependencies into a temporary directory and verifies compiled-server startup, static assets, security headers, secure cookies, and authentication boundaries. It then opens Chromium to verify deferred script loading, the real-account connection screen, its token controls, and the WebGL canvas against the built app. Run the build and install Chromium before that smoke check; the test runner uses workspace development dependencies while the temporary server runs without them. AI tests cover source filtering, request budgets, cache isolation, analysis reuse, retrieved Q&A, invalid output and provider errors. Browser tests cover source citations, actual usage display, mobile AI controls, AI previews and failure recovery. Automated GitHub integration tests simulate responses. A separate read-only live check verified local CLI connection and repository listing; OAuth app credentials and live publishing still require validation.

An optional paid live-provider check uses local source excerpts in an explicitly synthetic repository context, makes no GitHub requests, and checks analysis, Q&A and README generation:

```powershell
npx tsx scripts/smoke-ai.ts
```

A live run verified both configured model routes and source-cited results. This check is excluded from normal tests and CI because it requires your API key and spends provider tokens.

The GitHub Actions workflow runs these checks on pushes and pull requests. Dependabot checks npm dependencies and pinned Actions weekly. See [AUDIT.md](AUDIT.md) for the code review, research sources, and remaining deployment work.

## Production

```powershell
npm ci
npm run build
$env:NODE_ENV = 'production'
$env:APP_URL = 'https://your-domain.example'
# Only if the HTTPS reverse proxy runs on this same host:
$env:TRUST_PROXY = 'loopback'
npm start
```

Configure a stable, randomly generated `SESSION_SECRET` of at least 32 bytes, real OAuth credentials, the production callback URL, and an HTTPS reverse proxy forwarding to port 3001. `APP_URL` must be an HTTPS origin without a path. Express serves the compiled frontend in production, and `npm start` runs compiled JavaScript from `server-dist/`; development packages are not needed after building. Keep `server-dist/` outside the public `dist/` directory. If the process runs in a container, set `HOST=0.0.0.0`; the default binds to `127.0.0.1` for local use. Set `TRUST_PROXY` only to the controlled proxy's IP/subnet; `loopback` applies to a proxy on the same host. The proxy must overwrite forwarded headers and prevent public access to the backend port.

This version runs as **one server process** with bounded in-memory sessions, preview storage, API request queues, and rate limiters. Restarting signs users out and discards server previews and completed publish results. For multiple instances, use shared session/preview storage, atomic shared publish locks and result records, shared rate limits/queues, token protection, and operational monitoring. These must be replaced together; adding a shared session store alone does not make publishing safe across servers. No durable database is needed for the local app.

Generated document contents remain in browser memory for the current session; the workspace keeps the ten most recent previews. Returning to a repository resumes its latest unexpired, unpublished preview, including edited files and commit messages. Refreshing the page discards those drafts. Only validated activity metadata, the draft-PR preference, and the visual-effects preference are stored in localStorage. Nothing is published simply by generating a preview.

## Structure

```text
src/             React interface, WebGL visual, API client, styles
shared/          Domain types and repository-aware generators
server/          Express, GitHub auth, source sampling, Groq, preview/publishing
tests/           Unit/API tests and Playwright browser workflows
PRODUCT.md       Product context and constraints
DESIGN.md        Design tokens and interface conventions
```
"# gitlarp" 
