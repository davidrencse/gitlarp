// Hash tokens so queues and caches are keyed without storing raw credentials.
import { createHash } from 'node:crypto';

// Error carrying an HTTP status code (and optional retry delay).
export class HttpError extends Error {
  // Store status and retryAfter on the error.
  constructor(public status: number, message: string, public retryAfter?: number) { super(message); }
}
// Optional dependencies, overridable for tests.
type ClientOptions = { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number; writeDelayMs?: number };
// Per-credential request queue state.
type Queue = { tail: Promise<unknown>; pending: number; activeReads: number; waitingWrites: number; writing: boolean; waiters: (() => void)[]; lastWrite: number; blockedUntil: number; touched: number };
// Cached GET response with its ETag.
type Cached = { etag: string; data: unknown; bytes: number; saved: number };

// Bound concurrent reads per credential and serialize/pacing writes. Do not
// automatically retry POSTs: a timed-out write may already have succeeded.
// Create a GitHub API client.
export function createGithubClient(options: ClientOptions = {}) {
  // Clock (injectable).
  const now = options.now || Date.now;
  // Sleep function (injectable).
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  // One queue per credential.
  const queues = new Map<string, Queue>();
  // ETag response cache.
  const cache = new Map<string, Cached>();
  // Current cache size in bytes.
  let cacheBytes = 0;
  // Cache cap: 8 MB.
  const maxCacheBytes = 8 * 1024 * 1024;
  // Minimum delay between write requests (1 s default).
  const writeDelay = options.writeDelayMs ?? 1000;
  // Remove one cache entry and update the size total.
  function evict(key: string) { const saved = cache.get(key); if (saved) cacheBytes -= saved.bytes; cache.delete(key); }

  // Perform one API request, queued and rate-aware.
  async function request<T = any>(token: string, path: string, method = 'GET', body?: unknown): Promise<T> {
    // Only accept absolute API paths.
    if (!path.startsWith('/') || path.startsWith('//')) throw new HttpError(400, 'Invalid GitHub API path.');
    // Identify the credential by hash.
    const identity = createHash('sha256').update(token).digest('hex');
    // Current time.
    const time = now();
    // Discard idle queues.
    for (const [key, entry] of queues) if (!entry.pending && entry.blockedUntil <= time && time - entry.touched > 60_000) queues.delete(key);
    // Refuse if too many queues exist.
    if (!queues.has(identity) && queues.size >= 1000) throw new HttpError(503, 'GitHub request capacity reached. Try again shortly.');
    // Get this credential's queue.
    let queue = queues.get(identity);
    // Create it if it does not exist.
    if (!queue) { queue = { tail: Promise.resolve(), pending: 0, activeReads: 0, waitingWrites: 0, writing: false, waiters: [], lastWrite: -Infinity, blockedUntil: 0, touched: time }; queues.set(identity, queue); }
    // Limit waiting requests to 40.
    if (queue.pending >= 40) throw new HttpError(429, 'Too many GitHub requests are waiting. Try again shortly.', 5);
    // Count this request as pending.
    queue.pending++;
    // Capture the queue for use in closures.
    const state = queue;
    // Execute one call after acquiring the read or write lane.
    const execute = async () => {
      // If GitHub rate-limited us recently, fail fast.
      if (state.blockedUntil > now()) throw new HttpError(429, 'GitHub rate limit reached. Wait before trying again.', Math.max(1, Math.ceil((state.blockedUntil - now()) / 1000)));
      // Is this a write (not GET/HEAD)?
      const mutating = method !== 'GET' && method !== 'HEAD';
      // Space writes at least writeDelay apart.
      if (mutating) {
        // Compute how long to wait.
        const wait = Math.max(0, state.lastWrite + writeDelay - now());
        // Wait if needed.
        if (wait) await sleep(wait);
        // Remember when this write happened.
        state.lastWrite = now();
      }
      // Cache key per credential and path.
      const key = `${identity}:${path}`;
      // Look up a cached response.
      let cached = cache.get(key);
      // Drop cache entries older than 60 s.
      if (cached && now() - cached.saved > 60_000) { evict(key); cached = undefined; }
      // Holds the fetch response.
      let response: Response;
      // Make the network call.
      try {
        // Send to the GitHub API with a 25 s timeout.
        response = await (options.fetch || globalThis.fetch)(`https://api.github.com${path}`, {
          // Request method and abort signal.
          method, signal: AbortSignal.timeout(25_000),
          // Auth and API headers; send If-None-Match when a cached ETag exists.
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'Content-Type': 'application/json', 'User-Agent': 'GitLarp', ...(method === 'GET' && cached ? { 'If-None-Match': cached.etag } : {}) },
          // Include a JSON body when provided.
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
      // Network failure -> 502 with a message that warns writes may have succeeded.
      } catch { throw new HttpError(502, mutating ? 'GitHub did not confirm this write. Check the repository before retrying; the change may have succeeded.' : 'GitHub could not be reached. Check your connection and try again.'); }
      // 304 Not Modified: return the cached data.
      if (response.status === 304 && cached) return structuredClone(cached.data) as T;
      // Handle error responses.
      if (!response.ok) {
        // Read the error JSON if any.
        const data = await response.json().catch(() => ({})) as { message?: string };
        // Pick GitHub's message or a fallback.
        const message = data.message || `GitHub returned ${response.status}. Please try again.`;
        // Retry-After header.
        const retry = response.headers.get('retry-after');
        // Detect primary or secondary rate limiting.
        const rateLimited = response.status === 429 || response.status === 403 && (retry !== null || response.headers.get('x-ratelimit-remaining') === '0' || /(?:secondary )?rate limit/i.test(message));
        // On rate limit, remember until when requests are blocked.
        if (rateLimited) {
          // Seconds from Retry-After.
          const seconds = retry !== null ? Number(retry) : NaN;
          // Reset time from the rate-limit header.
          const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
          // Block until Retry-After, reset time, or 60 s from now.
          state.blockedUntil = Number.isFinite(seconds) && seconds >= 0 ? now() + Math.max(1, seconds) * 1000 : response.headers.get('x-ratelimit-remaining') === '0' && reset > now() ? reset : now() + 60_000;
          // Throw a 429 with a retry hint.
          throw new HttpError(429, 'GitHub rate limit reached. Wait before trying again.', Math.max(1, Math.ceil((state.blockedUntil - now()) / 1000)));
        }
        // Other errors: 401 becomes a "reconnect" message.
        throw new HttpError(response.status, response.status === 401 ? 'Your GitHub session has expired. Connect GitHub again.' : message);
      }
      // 204 No Content: nothing to return.
      if (response.status === 204) return undefined as T;
      // Parse the JSON body.
      const data: unknown = await response.json();
      // Cache successful GET responses.
      if (method === 'GET') {
        // ETag from the response.
        const etag = response.headers.get('etag');
        // Size of the data.
        const bytes = Buffer.byteLength(JSON.stringify(data));
        // Cache only when an ETag exists and the data is small enough.
        if (etag && bytes <= 1_000_000) {
          // Replace any existing entry.
          evict(key);
          // Evict oldest entries until within limits.
          while (cache.size >= 100 || cacheBytes + bytes > maxCacheBytes) evict(cache.keys().next().value!);
          // Store the entry and add to the size total.
          cache.set(key, { data, etag, bytes, saved: now() }); cacheBytes += bytes;
        }
      }
      // Return a copy so callers can't mutate the cache.
      return structuredClone(data) as T;
    };
    // Reads overlap (up to four per account); writes stay ordered and wait
    // for active reads. This cuts repository inspection latency while keeping
    // publishing paced and avoiding stale reads racing a write.
    const wake = () => { for (const waiter of state.waiters.splice(0)) waiter(); };
    const wait = () => new Promise<void>(resolve => state.waiters.push(resolve));
    const mutating = method !== 'GET' && method !== 'HEAD';
    let run: Promise<T>;
    if (mutating) {
      state.waitingWrites++;
      run = state.tail.catch(() => undefined).then(async () => {
        while (state.activeReads || state.writing) await wait();
        state.waitingWrites--;
        state.writing = true;
        try { return await execute(); } finally { state.writing = false; wake(); }
      });
    } else {
      run = (async () => {
        while (state.writing || state.waitingWrites || state.activeReads >= 4) await wait();
        state.activeReads++;
        try { return await execute(); } finally { state.activeReads--; wake(); }
      })();
    }
    // The queue only needs completion, not the last potentially large response.
    // Only a later write waits for this one (success or failure).
    if (mutating) state.tail = run.then(() => undefined, () => undefined);
    // Await the result and always update pending count and activity time.
    try { return await run; } finally { state.pending--; state.touched = now(); }
  }
  // Expose only the request function.
  return { request };
}

// Default shared client used by the app.
export const github = createGithubClient().request;
