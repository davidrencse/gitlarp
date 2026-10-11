// React state hook.
import { useState } from 'react';
// Icons.
import { ArrowRight, Check, Eye, EyeOff, FileText, GitBranch, Github, LockKeyhole, ShieldCheck } from 'lucide-react';
// API helper and a setter for the CSRF token.
import { api, setCsrf } from './api';
// User type.
import type { User } from '../shared/types';
// Loading spinner.
import { Spinner } from './components';

// Sign-in screen: connect with a personal access token, OAuth, or the local GitHub CLI.
export default function AuthGate({ ready, configured, localLogin, sessionError, retry, onConnected }: { ready: boolean; configured: boolean; localLogin: string | null; sessionError: string; retry: () => void; onConnected: (user: User) => void }) {
  // State: token text, whether it is shown, busy flag, and error message.
  const [token, setToken] = useState(''); const [shown, setShown] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  // Handle the token form submit.
  async function connect(event: React.FormEvent) {
    // Prevent a page reload; ignore when busy or the session is not ready.
    event.preventDefault(); if (busy || !ready) return;
    // Show busy and clear errors.
    setBusy(true); setError('');
    // Send the token to the server.
    try {
      // POST the token to /api/connect.
      const result = await api<{ user: User; csrf: string }>('/api/connect', { token });
      // Clear the token from memory, save the CSRF token, and notify the parent.
      setToken(''); setCsrf(result.csrf); onConnected(result.user);
    // Show errors and clear busy.
    } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  // Handle the "Continue with GitHub" button.
  async function continueWithGitHub() {
    // With OAuth configured, redirect the browser to the OAuth start route.
    if (configured) { window.location.assign('/auth/github'); return; }
    // Otherwise require a local gh-CLI login and an idle form.
    if (!localLogin || busy) return;
    // Show busy and clear errors.
    setBusy(true); setError('');
    // Connect through the local CLI.
    try {
      // POST the login to /api/connect/local.
      const result = await api<{ user: User; csrf: string }>('/api/connect/local', { login: localLogin });
      // Clear the token, save the CSRF token, and notify the parent.
      setToken(''); setCsrf(result.csrf); onConnected(result.user);
    // Show errors and clear busy.
    } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  // Render the sign-in page.
  return <main id="main-content" className="connection-layout">
    {/* Left side: the product pitch. */}
    <section className="connection-story">
      {/* Headline. */}
      <h1>Your code.<br />Ready for the world.</h1>
      {/* Description. */}
      <p className="connection-description">Give your GitHub projects the documentation, structure, and thoughtful commits they deserve.</p>
      {/* Three-step workflow illustration. */}
      <div className="connection-path" aria-label="Project workflow">
        {/* Steps: choose, review, publish. */}
        <div><GitBranch size={18} /><span>Choose a repository</span></div><span className="path-line" /><div><FileText size={18} /><span>Review the changes</span></div><span className="path-line" /><div><Check size={18} /><span>Publish with intention</span></div>
      </div>
      {/* Reassurance about preserved history. */}
      <p className="connection-promise"><ShieldCheck size={16} />Your original history stays intact. Every change is yours to review.</p>
    </section>
    {/* Right side: the connection card. */}
    <section className="connection-panel glass" aria-labelledby="connect-heading">
      {/* GitHub icon. */}
      <span className="connection-github"><Github size={28} strokeWidth={1.5} /></span>
      {/* Card heading. */}
      <h2 id="connect-heading">Connect your GitHub</h2>
      {/* Subheading. */}
      <p>One connection. Your real repositories.</p>
      {/* Session error with a retry button. */}
      {sessionError && <div className="error-banner" role="alert">{sessionError}<button className="text-button" onClick={retry}>Retry connection</button></div>}
            {/* Token form. */}
            <form onSubmit={connect}>
        {/* Label for the token field. */}
        <label className="field" htmlFor="github-token">Fine-grained personal access token (recommended)</label>
        {/* Token input with a show/hide button. */}
        <div className="token-input"><input id="github-token" name="github-token" type={shown ? 'text' : 'password'} value={token} onChange={event => setToken(event.target.value)} required minLength={20} maxLength={512} placeholder="Paste your access token" autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy} /><button type="button" className="icon-button" aria-label={shown ? 'Hide token' : 'Show token'} aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
        {/* Error from the last attempt. */}
        {error && <div className="error-banner" role="alert">{error}</div>}
        {/* Submit button (disabled until the token is long enough). */}
        <button type="submit" className="button primary token-submit" disabled={!ready || busy || token.trim().length < 20}>{busy ? <Spinner label="Connecting to GitHub…" /> : <>Connect with token<ArrowRight size={16} /></>}</button>
      </form>
      {/* Divider between the two methods. */}
      <div className="auth-divider"><span />or<span /></div>
      {/* OAuth / local GitHub button. */}
      <button className="button secondary oauth-button" disabled={!ready || (!configured && !localLogin) || busy} onClick={() => void continueWithGitHub()}><Github size={17} />Continue with GitHub<ArrowRight size={16} /></button>
      {/* Note explaining how one-click connection works. */}
      {!configured && <p className="oauth-note">{localLogin ? <>Continue as <strong>{localLogin}</strong> using your GitHub connection on this computer.</> : <>Connect with a personal access token below, or sign in with GitHub CLI and refresh to enable one-click connection.</>}</p>}
      {/* Help on how to create a token. */}
      <details className="token-guidance"><summary>Where do I get a token?</summary><p><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Create a fine-grained token on GitHub.</a> Select your repositories and allow Contents and Pull requests read/write. CI files also need Workflows write access. Available actions depend on those permissions.</p><p>A <a href="https://github.com/settings/tokens/new?scopes=repo,read:user,workflow&description=GitLarp" target="_blank" rel="noreferrer">classic token</a> with <code>repo</code>, <code>read:user</code>, and <code>workflow</code> scopes supports the full workflow. Choose an expiration.</p></details>
      {/* Privacy note: the token stays on the server. */}
      <p className="token-privacy"><LockKeyhole size={13} />Your token stays in server memory, never browser storage.</p>
    </section>
    {/* Footer tagline. */}
    <footer className="connection-footer"><span>A better repository starts with the work.</span><span>Connect. Review. Publish.</span></footer>
  </main>;
}
