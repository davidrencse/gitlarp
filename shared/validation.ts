// Largest single file (in bytes) the app will read or write.
export const MAX_FILE_BYTES = 250_000;
// Largest total payload (in bytes) of one generated plan.
export const MAX_PLAN_BYTES = 1_000_000;
// How long a stored plan stays valid: 30 minutes in milliseconds.
export const PLAN_TTL_MS = 30 * 60_000;

// Check that a git branch name is safe: bounded length and limited characters.
export function validBranch(value: string) {
  // Length 1-120, starts alphanumeric, only letters, digits, / _ -.
  return value.length >= 1 && value.length <= 120 && /^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(value)
    // Reject double slashes and a trailing slash.
    && !value.includes('//') && !value.endsWith('/');
}
// Check that a GitHub repository name is valid and safe.
export function validRepoName(value: string) {
  // Allowed characters only, not "." or "..", and must not end in .git.
  return /^[a-zA-Z0-9._-]{1,100}$/.test(value) && value !== '.' && value !== '..' && !value.toLowerCase().endsWith('.git');
}
// Byte length of a string when encoded as UTF-8.
export function utf8Bytes(value: string) { return new TextEncoder().encode(value).byteLength; }
