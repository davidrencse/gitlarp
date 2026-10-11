// Express web framework.
import express from 'express';
// Cookie-based session middleware.
import session from 'express-session';
// helmet sets secure HTTP headers.
import helmet from 'helmet';
// Crypto helpers: hashing, random tokens/ids, constant-time compare.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
// Path utilities (for serving the built UI).
import path from 'node:path';
// zod validates all request input.
import { z } from 'zod';
// Custom in-memory session store.
import { ExpiringStore } from './session';
// GitHub API helpers and the HttpError class.
import { github, HttpError, inspectProject, readFile, repoPath } from './github';
// Generates the documentation files for a project.
import { generateFiles } from '../shared/generator';
// Publishing logic (commits/branches/PRs) and its input schema.
import { publish, publishSchema } from './publish';
// Shared types.
import type { Plan, Repo, User } from '../shared/types';
// Store for generated plans awaiting publish.
import { PlanStore } from './plans';
// Per-IP rate limiting middleware.
import { rateLimit } from './rate-limit';
// Repo-name validation.
import { validRepoName } from '../shared/validation';
// Helpers for signing in through the local GitHub CLI.
import { isLoopback, localGitHub } from './local-github';
// Type of the local GitHub helper (for dependency injection).
import type { LocalGitHub } from './local-github';
// Groq AI helpers.
import { aiSettings, askAI, generateAI } from './groq';
// Collects source excerpts for AI analysis.
import { collectEvidence } from './evidence';
// Store for AI reports.
import { IntelligenceStore } from './intelligence';
// Short-lived, session-bound project inspections for repeat requests.
import { ProjectSnapshotStore } from './project-snapshots';

// Build and return the whole API app (also used by tests).
export function createApp(options: { localGitHub?: LocalGitHub } = {}) {
  // Create the Express app.
  const app = express();
  // True when running in production.
  const production = process.env.NODE_ENV === 'production';
  // The Electron shell serves the built UI from this same loopback server.
  // True when launched by the Electron desktop shell.
  const desktop = process.env.GITLARP_DESKTOP === '1';
  // Public URL of the app (the allowed origin).
  const url = new URL(process.env.APP_URL || 'http://localhost:5173');
  // Reject an APP_URL that is not a plain HTTP(S) origin.
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('APP_URL must be an HTTP(S) origin, without credentials or a path.');
  // Normalized origin string.
  const appUrl = url.origin;
  // Local gh-CLI login is dev-only and requires a localhost APP_URL.
  const localEnabled = !production && process.env.GITHUB_LOCAL_AUTH === '1' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  // Use an injected helper (tests) or the real one.
  const local = options.localGitHub ?? localGitHub();
  // Production demands a strong session secret and HTTPS.
  if (production && (Buffer.byteLength(process.env.SESSION_SECRET || '') < 32 || url.protocol !== 'https:')) throw new Error('Production requires a SESSION_SECRET of at least 32 bytes and an HTTPS APP_URL.');
  // Session store.
  const store = new ExpiringStore();
  // Store of generated plans.
  const plans = new PlanStore();
  // Store of AI analysis results.
  const intelligence = new IntelligenceStore();
  // Repository context reuse avoids a second tree walk during analysis/preview.
  const snapshots = new ProjectSnapshotStore();
  // Drop a user's plans, AI reports, and inspected snapshots (logout/re-login).
  const clearOwner = (owner: string) => { plans.clearOwner(owner); intelligence.clearOwner(owner); snapshots.clearOwner(owner); };
  // Validates the owner and repo fields.
  const projectSchema = z.object({ owner: z.string().regex(/^[a-zA-Z0-9-]+$/).max(100), repo: z.string().regex(/^[a-zA-Z0-9._-]+$/).max(100) });
  // Reuse a recent inspection only after checking that the repository identity,
  // default branch, and current HEAD still match the stored snapshot.
  async function projectContext(ownerId: string, token: string, owner: string, repo: string, inspectionId?: string) {
    const cached = snapshots.get(ownerId, inspectionId, `${owner}/${repo}`);
    if (!cached) return inspectProject(token, owner, repo);
    const base = repoPath(owner, repo);
    try {
      const [currentRepo, currentBranch] = await Promise.all([
        github<Repo>(token, base),
        github<any>(token, `${base}/git/ref/heads/${encodeURIComponent(cached.repo.default_branch)}`),
      ]);
      if (currentRepo.id === cached.repo.id && currentRepo.default_branch === cached.repo.default_branch && currentBranch.object.sha === cached.head) {
        const fresh = { ...cached, repo: currentRepo };
        snapshots.put(ownerId, fresh, inspectionId);
        return fresh;
      }
    } catch (error) {
      if (!(error instanceof HttpError && (error.status === 404 || error.status === 409))) throw error;
    }
    snapshots.delete(inspectionId);
    const fresh = await inspectProject(token, owner, repo);
    if (cached && inspectionId) snapshots.put(ownerId, fresh, inspectionId);
    return fresh;
  }
  // Run an AI task that is cancelled when the client disconnects.
  async function withAI<T>(req: express.Request, res: express.Response, work: (signal: AbortSignal) => Promise<T>) {
    // Register this task and get an AbortController.
    const owner = req.sessionID; const controller = intelligence.begin(owner);
    // Abort when the response closes before it finished.
    const closed = () => { if (!res.writableEnded) controller.abort(); }; res.on('close', closed);
    // Run the work, honoring cancellation.
    try { const result = await work(controller.signal); controller.signal.throwIfAborted(); return result; }
    // Always remove the listener and mark the task finished.
    finally { res.off('close', closed); intelligence.finish(owner); }
  }
  // Reject unexpected Host headers so DNS-rebinding pages cannot reach the loopback server.
  // Hostnames considered local in development.
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  // Host-check middleware.
  app.use((req, res, next) => {
    // Raw Host header.
    const host = req.get('host') || '';
    // Parse the hostname safely (ignore malformed values).
    let hostname = ''; try { hostname = new URL(`http://${host}`).hostname; } catch {}
    // Allow the configured host, or loopback names outside production.
    if (host === url.host || !production && loopbackHosts.has(hostname)) return next();
    // Otherwise respond 421 Misdirected Request.
    res.status(421).json({ error: 'Unexpected host.' });
  });
  // Trust a reverse proxy only when explicitly configured.
  if (production && process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
  // Security headers; strict CSP in production/desktop.
  app.use(helmet({ contentSecurityPolicy: production || desktop ? {
    // Content-Security-Policy: only same-origin resources plus GitHub avatars.
    directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'https://avatars.githubusercontent.com', 'https://github.com'], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'"], connectSrc: ["'self'"], fontSrc: ["'self'"], frameAncestors: ["'none'"] },
  // Disable CSP and HSTS in development.
  } : false, hsts: production ? undefined : false }));
  // Never cache API or auth responses.
  app.use(['/api', '/auth'], (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // General API rate limit: 180 requests per minute per IP.
  app.use('/api', rateLimit(180, 60_000));
  // Stricter limit for auth routes: 20 per minute.
  app.use('/auth', rateLimit(20, 60_000));
  // Parse JSON bodies up to 2 MB.
  app.use(express.json({ limit: '2mb' }));
  // Configure sessions: cookie name, secret, store, no empty sessions.
  app.use(session({ name: 'gitlarp.sid', secret: process.env.SESSION_SECRET || randomBytes(48).toString('hex'), store, resave: false, saveUninitialized: false,
    // Session cookie: HTTP-only, secure in production, SameSite=Lax, 8 hour life.
    cookie: { httpOnly: true, secure: production, sameSite: 'lax', maxAge: 8 * 60 * 60_000 } }));
  // OAuth is available only when both client id and secret are set.
  const configured = () => !!process.env.GITHUB_CLIENT_ID && !!process.env.GITHUB_CLIENT_SECRET;
  // Validates the OAuth callback query (code and state).
  const authSchema = z.object({ code: z.string().min(1).max(300), state: z.string().min(1).max(200) });

  // GET /api/session: report current user, config flags, and a CSRF token.
  app.get('/api/session', async (req, res) => {
    // Clear an expired token and the user's cached data.
    if (req.session.tokenExpiresAt && req.session.tokenExpiresAt <= Date.now()) { delete req.session.token; delete req.session.user; delete req.session.tokenExpiresAt; clearOwner(req.sessionID); }
    // Create a CSRF token if the session has none.
    req.session.csrf ??= randomBytes(32).toString('hex');
    // Detect a local gh-CLI account (dev only, loopback clients only).
    const localAccount = localEnabled && isLoopback(req.socket.remoteAddress) ? await local.status() : null;
    // Reply with everything the UI needs at startup.
    res.json({ user: req.session.user || null, configured: configured(), localLogin: localAccount?.login || null, ai: aiSettings(), csrf: req.session.csrf, authMethod: req.session.authMethod || null });
  });
  // GET /auth/github: start the OAuth flow.
  app.get('/auth/github', (req, res) => {
    // Without OAuth credentials, redirect with an error.
    if (!configured()) return res.redirect('/?auth_error=not_configured');
    // Random state to prevent CSRF on the callback.
    const state = randomBytes(32).toString('hex');
    // PKCE code verifier.
    const verifier = randomBytes(32).toString('base64url');
    // Remember them (with a timestamp) in the session.
    req.session.oauth = { state, verifier, createdAt: Date.now() };
    // Build the GitHub authorization URL parameters, including the PKCE challenge.
    const params = new URLSearchParams({ client_id: process.env.GITHUB_CLIENT_ID!, redirect_uri: `${appUrl}/auth/github/callback`, scope: 'repo read:user workflow', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    // Save the session, then redirect the browser to GitHub.
    req.session.save(error => { if (error) return res.redirect('/?auth_error=session'); res.redirect(`https://github.com/login/oauth/authorize?${params}`); });
  });
  // GET /auth/github/callback: finish the OAuth flow.
  app.get('/auth/github/callback', async (req, res) => {
    try {
      // Validate the query parameters.
      const { code, state } = authSchema.parse(req.query);
      // Fetch the saved OAuth state.
      const oauth = req.session.oauth;
      // Make it single-use.
      delete req.session.oauth;
      // Verify the state (constant-time) and that it is under 10 minutes old.
      if (!oauth || oauth.state.length !== state.length || !timingSafeEqual(Buffer.from(oauth.state), Buffer.from(state)) || Date.now() - oauth.createdAt > 10 * 60_000) throw new Error('Invalid authorization state');
      // Exchange the code for an access token (with PKCE verifier).
      const response = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${appUrl}/auth/github/callback`, code_verifier: oauth.verifier }) });
      // Parse the token response.
      const data = await response.json() as { access_token?: string; error?: string; expires_in?: number };
      // Fail if GitHub returned no token.
      if (!response.ok || !data.access_token || data.error) throw new Error('Token exchange failed');
      // Look up the user the token belongs to.
      const user = await github<User>(data.access_token, '/user');
      // Regenerate the session id to prevent session fixation.
      await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
      // Store the token, user, a fresh CSRF token, and the auth method.
      req.session.token = data.access_token; req.session.user = user; req.session.csrf = randomBytes(32).toString('hex'); req.session.authMethod = 'oauth';
      // Remember when an expiring token stops working.
      if (typeof data.expires_in === 'number' && data.expires_in > 0) req.session.tokenExpiresAt = Date.now() + Math.max(0, data.expires_in - 30) * 1000;
      // Persist the session.
      await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
      // Return to the app, signaling success.
      res.redirect('/?connected=1');
    // Any failure redirects with a generic error.
    } catch { res.redirect('/?auth_error=authorization_failed'); }
  });
  // Every browser write needs a session-specific token, even sign-out.
  // CSRF/origin protection middleware for /api.
  app.use('/api', (req, _res, next) => {
    // Only state-changing methods are checked.
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      // Origin header, when present.
      const origin = req.get('origin');
      // Reject requests from another origin.
      if (origin && origin !== appUrl) return next(new HttpError(403, 'This request came from a different origin.'));
      // Require the matching CSRF token header.
      if (!req.session.csrf || req.get('x-csrf-token') !== req.session.csrf) return next(new HttpError(403, 'Refresh the page before trying again.'));
    }
    // Safe request: continue.
    next();
  });
  // Tighter limit for sign-in attempts: 10 per minute.
  const connections = rateLimit(10, 60_000);
  // Shared sign-in logic for personal tokens and the local gh CLI.
  async function connect(req: express.Request, res: express.Response, token: string, method: 'token' | 'local', expectedLogin?: string) {
    // Ask GitHub who the token belongs to.
    const profile = await github<User>(token, '/user');
    // Validate the profile shape.
    const user = z.object({ login: z.string().min(1).max(100), id: z.number().int().positive(), name: z.string().nullable(), avatar_url: z.string() }).parse(profile);
    // For local sign-in, ensure the account is still the one the user chose.
    if (expectedLogin && user.login.toLowerCase() !== expectedLogin.toLowerCase()) throw new HttpError(409, 'Your local GitHub account changed. Refresh the page to choose that account.');
    // Drop data from any previous session.
    clearOwner(req.sessionID);
    // Regenerate the session id (prevents fixation).
    await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    // Store the credentials and a new CSRF token.
    req.session.token = token; req.session.user = user; req.session.authMethod = method; req.session.csrf = randomBytes(32).toString('hex');
    // Persist the session.
    await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
    // Send the user and CSRF token to the browser.
    res.json({ user, csrf: req.session.csrf });
  }
  // POST /api/connect: sign in with a personal access token.
  app.post('/api/connect', connections, async (req, res) => {
    // Validate the token input.
    const { token } = z.object({ token: z.string().trim().min(20, 'Enter a GitHub personal access token.').max(512) }).parse(req.body);
    // Verify the token with GitHub and create the session.
    await connect(req, res, token, 'token');
  });
  // POST /api/connect/local: sign in via local gh CLI (dev, same machine only).
  app.post('/api/connect/local', connections, async (req, res) => {
    // Refuse outside development or from non-loopback clients.
    if (!localEnabled || !isLoopback(req.socket.remoteAddress)) throw new HttpError(403, 'Local GitHub connections are available only on this computer in development mode.');
    // The login the user selected.
    const { login } = z.object({ login: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/) }).parse(req.body);
    // Get a token from the CLI and connect.
    await connect(req, res, await local.token(), 'local', login);
  });
  // POST /api/logout: destroy the session.
  app.post('/api/logout', (req, res, next) => {
    // Clear cached plans and reports.
    clearOwner(req.sessionID);
    // Destroy the session and clear the cookie.
    req.session.destroy(error => { if (error) return next(error); res.clearCookie('gitlarp.sid', { httpOnly: true, secure: production, sameSite: 'lax', path: '/' }); res.json({ ok: true }); });
  });
  // Everything below requires a signed-in, unexpired session.
  app.use('/api', (req, _res, next) => { if (!req.session.token || req.session.tokenExpiresAt && req.session.tokenExpiresAt <= Date.now()) return next(new HttpError(401, 'Connect your GitHub account to use live projects.')); next(); });
  // Write limit: 20 POST requests per minute.
  const writes = rateLimit(20, 60_000);
  // Apply the write limit to every POST.
  app.use('/api', (req, res, next) => req.method === 'POST' ? writes(req, res, next) : next());
  // GET /api/repos: list the user's repositories (100 per page).
  app.get('/api/repos', async (req, res) => {
    // Validate the page number.
    const page = z.coerce.number().int().min(1).max(10000).parse(req.query.page || 1);
    // Fetch the repositories from GitHub.
    const repos = await github<Repo[]>(req.session.token!, `/user/repos?per_page=100&page=${page}&sort=full_name&direction=asc&affiliation=owner,collaborator,organization_member`);
    // Return them with a flag saying whether more pages exist.
    res.json({ repos, hasMore: repos.length === 100 });
  });
  // GET /api/projects/:owner/:repo: inspect one repository and retain a bounded snapshot.
  app.get('/api/projects/:owner/:repo', async (req, res) => {
    const context = await inspectProject(req.session.token!, req.params.owner, req.params.repo);
    const inspectionId = snapshots.put(req.sessionID, context);
    res.json({ ...context, ...(inspectionId ? { inspectionId } : {}) });
  });
  // AI limit: 6 requests per minute.
  const aiLimit = rateLimit(6, 60_000);
  // POST /api/ai/analyze: AI analysis of a repository.
  app.post('/api/ai/analyze', aiLimit, async (req, res) => {
    // Validate input, with optional user instructions.
    const input = projectSchema.extend({ instructions: z.string().max(2500).default(''), inspectionId: z.string().uuid().optional() }).parse(req.body);
    // Fail clearly if Groq is not configured.
    if (!aiSettings().configured) throw new HttpError(503, 'Groq is not configured on the server.');
    // Run under cancellation support.
    const report = await withAI(req, res, async signal => {
      // Read the repository context.
      const context = await projectContext(req.sessionID, req.session.token!, input.owner, input.repo, input.inspectionId);
      // Reuse a previous analysis for the same commit and instructions.
      const cached = intelligence.find(req.sessionID, context.repo.id, context.head, input.instructions);
      // Return the cached report flagged as reused.
      if (cached) return { ...cached.report, reused: true };
      // Gather source excerpts for the model.
      const evidence = await collectEvidence(req.session.token!, context, signal);
      // Ask the model to analyze them.
      const result = await generateAI(evidence, [], [], input.instructions, signal);
      // Store and return the report.
      signal.throwIfAborted(); return intelligence.put(req.sessionID, evidence, result.analysis, result.usage, result.model, input.instructions);
    });
    // Send the AI report.
    res.json(report);
  });
  // POST /api/ai/ask: ask a follow-up question about an analysis.
  app.post('/api/ai/ask', aiLimit, async (req, res) => {
    // Validate the analysis id, question, and short chat history.
    const input = z.object({ analysisId: z.string().uuid(), question: z.string().trim().min(3).max(2500), history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(12000) })).max(6).default([]) }).parse(req.body);
    // Load the stored analysis and evidence for this session.
    const { evidence, report } = intelligence.get(req.sessionID, input.analysisId);
    // Ask the model and send the answer.
    res.json(await withAI(req, res, signal => askAI(evidence, report, input.question, signal, input.history)));
  });
  // POST /api/repositories: create a new repository.
  app.post('/api/repositories', async (req, res) => {
    // Validate name, description, and visibility.
    const input = z.object({ name: z.string().refine(validRepoName, 'Invalid repository name'), description: z.string().max(350), private: z.boolean() }).parse(req.body);
    // Create it on GitHub with an initial commit.
    const repo = await github<Repo>(req.session.token!, '/user/repos', 'POST', { ...input, auto_init: true });
    // Return it with status 201.
    res.status(201).json(repo);
  });
  // POST /api/plans: generate files for a repo, optionally AI-enhanced.
  app.post('/api/plans', async (req, res) => {
    // Validate modules, AI flag, instructions, and optional analysis id.
    const input = projectSchema.extend({ modules: z.array(z.enum(['readme', 'docs', 'contributing', 'changelog', 'templates', 'editorconfig', 'ci'])).min(1).max(7), ai: z.boolean().default(false), instructions: z.string().max(2500).default(''), analysisId: z.string().uuid().optional(), inspectionId: z.string().uuid().optional() }).parse(req.body);
    // Read the repository context.
    const context = await projectContext(req.sessionID, req.session.token!, input.owner, input.repo, input.inspectionId);
    // Generate the files deterministically from templates.
    const generated = generateFiles(context, input.modules);
    // Fail if nothing would be generated.
    if (!generated.files.length) throw new HttpError(422, 'No files can be generated for the selected modules. Choose documentation or README.');
    // Base API path of the repo.
    const base = repoPath(input.owner, input.repo);
    // Read originals concurrently for a much quicker review preview; a tree
    // alone cannot prove a path is new, so every generated path is checked.
    const originals = await Promise.all(generated.files.map(file => file.path === (context.readmePath || 'README.md') && context.readme !== null ? context.readme : readFile(req.session.token!, base, file.path, context.head)));
    generated.files.forEach((file, index) => { file.original = originals[index]; });
    // Holds the AI report, if any.
    let aiReport;
    // Configuration/CI and the history-based changelog are deterministic.
    // Skip the provider entirely when the selection has no editable Markdown.
    // Use AI only when some generated Markdown is editable (not the changelog).
    if (input.ai && generated.files.some(file => file.module !== 'changelog' && file.path.endsWith('.md'))) {
      // Run the AI step with cancellation.
      const result = await withAI(req, res, async signal => {
        // Fail clearly if Groq is not configured.
        if (!aiSettings().configured) throw new HttpError(503, 'Groq is not configured on the server.');
        // An existing analysis matching this commit and instructions.
        const matching = intelligence.find(req.sessionID, context.repo.id, context.head, input.instructions);
        // Use the requested analysis, or the matching one.
        const cached = input.analysisId ? intelligence.get(req.sessionID, input.analysisId) : matching;
        // Refuse analyses made for an older commit of the repo.
        if (cached && (cached.evidence.context.repo.id !== context.repo.id || cached.report.head !== context.head)) throw new HttpError(409, 'The repository changed since analysis. Analyze it again or generate without the previous analysis.');
        // Reuse the cached evidence or gather new evidence.
        const evidence = cached?.evidence ?? await collectEvidence(req.session.token!, context, signal);
        // Have the model rewrite the generated files and commit messages.
        const result = await generateAI(evidence, generated.files, generated.commits, input.instructions, signal, matching?.report.id === cached?.report.id ? cached?.report.analysis : undefined);
        // Store the report and return both the result and the report.
        signal.throwIfAborted(); return { ...result, report: intelligence.put(req.sessionID, evidence, result.analysis, result.usage, result.model, input.instructions) };
      });
      // Replace the files and commits with the AI-improved ones.
      generated.files = result.files; generated.commits = result.commits; aiReport = result.report;
    }
    // Assemble the plan with a new id and timestamp.
    const plan: Plan = { id: randomUUID(), repo: context.repo, head: context.head, createdAt: new Date().toISOString(), ...generated, ...(aiReport ? { ai: aiReport } : {}) };
    // Store it for this session.
    plans.put(req.sessionID, plan);
    // Return it to the browser.
    res.json(plan);
  });
  // POST /api/publish: write the reviewed plan to GitHub.
  app.post('/api/publish', async (req, res) => {
    // Validate the publish payload.
    const input = publishSchema.parse(req.body);
    // Fingerprint the request so retries are recognized.
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    // Start the attempt (rejects unknown, expired, or conflicting plans).
    const attempt = plans.begin(req.sessionID, input.planId, fingerprint);
    // An identical retry gets the previous result instead of publishing again.
    if (attempt.result) { res.json(attempt.result); return; }
    // Publish and record the result.
    try {
      // Create branches, commits, and pull requests on GitHub.
      const result = await publish(req.session.token!, attempt.plan, input);
      // Remember the result for idempotent retries.
      plans.finish(input.planId, result);
      // Return the result.
      res.json(result);
    // On failure, release the plan so it can be retried, then rethrow.
    } catch (error) { plans.finish(input.planId); throw error; }
  });
  // Unknown /api routes return 404.
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Endpoint not found.')));
  // In production or desktop mode, serve the built UI.
  if (production || desktop) {
    // Static assets from ./dist.
    app.use(express.static(path.resolve('dist')));
    // Any other route returns index.html (single-page-app routing).
    app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
  }
  // Central error handler: convert errors into JSON responses.
  app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // Validation errors -> 400 with all messages.
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(issue => issue.message).join('. ') });
    // Known HTTP errors.
    if (error instanceof HttpError) {
      // A 401 from GitHub means the token is no longer valid: clear it.
      if (error.status === 401 && req.session) { delete req.session.token; delete req.session.user; delete req.session.tokenExpiresAt; clearOwner(req.sessionID); }
      // Forward the retry hint to the client.
      if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
      // Return the status and message (and retryAfter if any).
      return res.status(error.status).json({ error: error.message, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) });
    }
    // Request body too large -> 413.
    if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') return res.status(413).json({ error: 'This request is too large. Keep the complete preview below 1 MB.' });
    // Malformed JSON -> 400.
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'The request body is not valid JSON.' });
    // Anything else -> generic 502 (no internal details leaked).
    res.status(502).json({ error: 'The request could not be completed. Check your connection and try again.' });
  });
  // Return the app and its stores (tests and index.ts use them).
  return { app, store, plans, intelligence };
}
