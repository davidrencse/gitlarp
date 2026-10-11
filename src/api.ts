// CSRF token sent with every POST.
let csrf = '';
// Update the CSRF token (called after sign-in or session load).
export function setCsrf(value: string) { csrf = value; }
// Error with an HTTP status and an optional retry delay.
export class ApiError extends Error {
  // Store the status and retryAfter.
  constructor(message: string, public status: number, public retryAfter?: number) { super(message); }
}
// Send a JSON API request (GET without a body, POST with one).
export async function api<T>(path: string, body?: unknown, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
  // Default timeout: 30 s for GET, 120 s for POST.
  const timeout = AbortSignal.timeout(options.timeoutMs ?? (body === undefined ? 30_000 : 120_000));
  // Holds the response.
  let response: Response;
  // Make the request.
  try { response = await fetch(path, {
    // Method and same-origin cookies.
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    // Abort on the caller's signal or the timeout.
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    // Headers: JSON, plus Content-Type and the CSRF token for POST.
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }) },
    // Add the JSON body if there is one.
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  // Network errors:
  }); } catch (error) {
    // Rethrow cancellations unchanged.
    if (options.signal?.aborted) throw error;
    // Otherwise throw a friendly error; POSTs warn that the change may have happened.
    throw new ApiError(body === undefined ? 'The server could not be reached. Check your connection and try again.' : 'The server did not confirm this action. Check the repository before retrying; a change may have succeeded.', 0);
  }
  // Parse the response as JSON.
  const data = await response.json().catch(() => { throw new ApiError('The server returned an invalid response. Check the server and try again.', response.status); });
  // Handle HTTP errors.
  if (!response.ok) {
    // A 401 tells the app that the session expired.
    if (response.status === 401) window.dispatchEvent(new Event('gitlarp:session-expired'));
    // Throw with the server's message and a Retry-After value.
    throw new ApiError(typeof data?.error === 'string' ? data.error : 'The request failed. Please try again.', response.status, Number(response.headers.get('retry-after')) || undefined);
  }
  // Return the data.
  return data as T;
}
// Shape of the /api/session response.
type Session = { user: import('../shared/types').User | null; configured: boolean; localLogin?: string | null; ai?: { configured: boolean; model: string }; csrf: string };
// Shared in-flight session request.
let sessionRequest: Promise<Session> | null = null;
// StrictMode mount effects share one cookie/CSRF pair.
// Fetch the session, validating its shape and saving the CSRF token.
export function getSession() {
  // Start a request if none is pending.
  if (!sessionRequest) sessionRequest = api<Session>('/api/session').then(data => {
    // Reject an invalid response.
    if (typeof data.csrf !== 'string' || typeof data.configured !== 'boolean' || !('user' in data)) throw new ApiError('Invalid session response.', 502);
    // Save the CSRF token and return the data.
    setCsrf(data.csrf); return data;
  // Clear the shared request when done.
  }).finally(() => { sessionRequest = null; });
  // Return the shared promise.
  return sessionRequest;
}
