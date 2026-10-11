// Run external programs (the `gh` CLI) without a shell.
import { execFile } from 'node:child_process';
// Turn callback-style functions into promises.
import { promisify } from 'node:util';
// Shared HTTP error class.
import { HttpError } from './github';

// Promise version of execFile.
const execute = promisify(execFile);
// Interface for using the user's locally signed-in GitHub CLI.
export interface LocalGitHub {
  // Report who is signed in (or null).
  status(): Promise<{ login: string } | null>;
  // Return an access token from the CLI.
  token(): Promise<string>;
}
// Safe execution options: 10 s timeout, small output buffer, hidden window.
const options = { timeout: 10_000, maxBuffer: 32_768, windowsHide: true,
  // Disable interactive prompts and update notices from gh.
  env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' } };

// Create a local GitHub CLI helper.
export function localGitHub(): LocalGitHub {
  // Last known login (cached).
  let cached: { login: string } | null = null;
  // Cache expiry timestamp.
  let expires = 0;
  // In-flight lookup shared by concurrent callers.
  let pending: Promise<{ login: string } | null> | null = null;
  // Return the helper object.
  return {
    // Check which GitHub account the CLI is signed in as.
    async status() {
      // Use the cached answer if it is still fresh.
      if (Date.now() < expires) return cached;
      // Start `gh auth status` once and share the promise.
      pending ??= execute('gh', ['auth', 'status', '--hostname', 'github.com', '--active', '--json', 'hosts'], options)
        // Parse the command output once it succeeds.
        .then(({ stdout }) => {
          // Parse the JSON.
          const data = JSON.parse(stdout);
          // Find the active, successful github.com entry.
          const active = data.hosts?.['github.com']?.find((entry: { active?: boolean; state?: string }) => entry.active && entry.state === 'success');
          // Accept only a login that matches GitHub's allowed characters.
          return typeof active?.login === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(active.login) ? { login: active.login as string } : null;
        // On failure return null, cache for 15 s, and clear the pending flag.
        }).catch(() => null).then(result => { cached = result; expires = Date.now() + 15_000; return result; }).finally(() => { pending = null; });
      // Return the shared pending lookup.
      return pending;
    },
    // Obtain the CLI's token for API calls.
    async token() {
      // Run `gh auth token`.
      try {
        // Capture its output.
        const { stdout } = await execute('gh', ['auth', 'token', '--hostname', 'github.com'], options);
        // Trim whitespace.
        const token = stdout.trim();
        // Reject implausibly short/long tokens.
        if (token.length < 20 || token.length > 512) throw new Error('Unavailable');
        // Return the valid token.
        return token;
      // Any failure becomes a helpful 409 error.
      } catch { throw new HttpError(409, 'Your local GitHub connection is unavailable. Sign in with GitHub CLI and refresh, or connect with a personal access token.'); }
    },
  };
}

// True only for loopback addresses (the local machine).
export function isLoopback(address?: string) {
  // Compare against IPv4, IPv6 and IPv4-mapped IPv6 loopback.
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
