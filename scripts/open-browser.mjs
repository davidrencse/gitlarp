// Run a child process.
import { spawn } from 'node:child_process';

// App address in development.
const url = 'http://localhost:5173';
// Check whether both the web and API servers are running.
async function ready() {
  // Wrap in try so any failure means not ready.
  try {
    // Request both servers at once.
    const [web, api] = await Promise.all([
      // The web server (1.5 s timeout).
      fetch(url, { signal: AbortSignal.timeout(1500) }),
      // The API server's session endpoint.
      fetch('http://127.0.0.1:3001/api/session', { signal: AbortSignal.timeout(1500) }),
    ]);
    // Both must respond OK.
    if (!web.ok || !api.ok) return false;
    // Read the HTML and the session JSON.
    const [html, session] = await Promise.all([web.text(), api.json()]);
    // Confirm it is GitLarp and the session shape is valid.
    return /<title>GitLarp\b/i.test(html) && typeof session.csrf === 'string' && typeof session.configured === 'boolean';
  // Any error means not ready.
  } catch { return false; }
}

// With --check, just report readiness through the exit code.
if (process.argv.includes('--check')) {
  // Exit code 0 when ready, otherwise 1.
  process.exitCode = await ready() ? 0 : 1;
} else {
  // Otherwise wait for readiness, then open the browser.
  let available = false;
  // Wait up to 45 seconds.
  const deadline = Date.now() + 45_000;
  // Poll until the deadline.
  while (Date.now() < deadline) {
    // Stop as soon as the servers are ready.
    if (await ready()) { available = true; break; }
    // Wait 750 ms between checks.
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  if (available) {
    // This is a fixed local URL; keep CMD's empty window-title quoting intact.
    // Open the URL using the Windows shell.
    const browser = spawn('cmd.exe', ['/d', '/c', `start "" "${url}"`], { windowsHide: true, windowsVerbatimArguments: true, stdio: 'ignore' });
    // If starting fails, tell the user the URL.
    browser.on('error', () => console.log(`Open ${url} in your browser.`));
    // Same if the command exits with an error.
    browser.on('exit', code => { if (code) console.log(`Open ${url} in your browser.`); });
  } else {
    // Not ready in time: show a hint.
    console.log(`The app did not become ready. Check the server messages above; once it starts, open ${url}.`);
    // Exit with an error code.
    process.exitCode = 1;
  }
}
