// express-session provides the Store base class and types.
import session from 'express-session';
// User type for session data.
import type { User } from '../shared/types';

// Extend express-session's SessionData with this app's fields.
declare module 'express-session' {
  // Declare the extra session fields.
  interface SessionData {
    // GitHub access token (kept only in server memory).
    token?: string;
    // The signed-in GitHub user.
    user?: User;
    // CSRF token that mutating requests must echo back.
    csrf?: string;
    // In-flight OAuth login: state, PKCE verifier, and start time.
    oauth?: { state: string; verifier: string; createdAt: number };
    // Epoch ms when the stored token expires.
    tokenExpiresAt?: number;
    // How the user signed in: OAuth, personal token, or local gh CLI.
    authMethod?: 'oauth' | 'token' | 'local';
  }
}

// Bounded, expiring, single-process sessions. Credentials are never persisted.
// In-memory session store with idle and absolute expiry and size limits.
export class ExpiringStore extends session.Store {
  // Map of session id -> serialized data, expiry, creation time, and size.
  private sessions = new Map<string, { value: string; expires: number; created: number; bytes: number }>();
  // Total bytes held across all sessions.
  private bytes = 0;
  // Injectable clock plus idle (30 min) and absolute (8 h) lifetimes.
  constructor(private now = Date.now, private idleMs = 30 * 60_000, private absoluteMs = 8 * 60 * 60_000) { super(); }
  // Background timer that sweeps expired sessions every minute.
  private timer = setInterval(() => {
    // Remove every session whose expiry has passed.
    for (const [key, data] of this.sessions) if (data.expires <= this.now()) this.remove(key);
  }, 60_000).unref();
  // Delete a session and subtract its size from the running total.
  private remove(id: string) { const entry = this.sessions.get(id); if (entry) this.bytes -= entry.bytes; this.sessions.delete(id); }
  // Load a session by id (express-session Store API).
  get(id: string, callback: (error: unknown, session?: session.SessionData | null) => void) {
    // Look up the stored entry.
    const entry = this.sessions.get(id);
    // Missing or expired: clean up and return no session.
    if (!entry || entry.expires <= this.now()) { this.remove(id); callback(null, null); return; }
    // Otherwise return a fresh deserialized copy.
    callback(null, JSON.parse(entry.value));
  }
  // Save a session (Store API) enforcing capacity limits.
  set(id: string, value: session.SessionData, callback?: (error?: unknown) => void) {
    // Existing entry for this id, if any.
    const previous = this.sessions.get(id);
    // Serialize the session to JSON.
    const serialized = JSON.stringify(value);
    // Measure its size in bytes.
    const bytes = Buffer.byteLength(serialized);
    // Reject if too big per session, too much total memory, or too many sessions.
    if (bytes > 16_384 || this.bytes - (previous?.bytes || 0) + bytes > 16 * 1024 * 1024 || this.sessions.size >= 1000 && !previous) { callback?.(new Error('Session capacity reached. Please try later.')); return; }
    // Keep the original creation time so the absolute lifetime cannot be extended.
    const created = previous?.created ?? this.now();
    // Drop the old entry before replacing it.
    this.remove(id);
    // Store with expiry = idle timeout, capped by the absolute lifetime.
    this.sessions.set(id, { value: serialized, bytes, created, expires: Math.min(this.now() + this.idleMs, created + this.absoluteMs) });
    // Add to the byte total.
    this.bytes += bytes;
    // Signal success.
    callback?.();
  }
  // Refresh the idle timeout on activity (Store API).
  touch(id: string, _value: session.SessionData, callback?: (error?: unknown) => void) {
    // Look up the entry.
    const entry = this.sessions.get(id);
    // If still valid, extend its expiry (never past the absolute limit).
    if (entry && entry.expires > this.now()) entry.expires = Math.min(this.now() + this.idleMs, entry.created + this.absoluteMs);
    // Otherwise remove it.
    else this.remove(id);
    // Signal completion.
    callback?.();
  }
  // Delete a session (e.g. on logout).
  destroy(id: string, callback?: (error?: unknown) => void) { this.remove(id); callback?.(); }
  // Stop the timer and clear all data.
  close() { clearInterval(this.timer); this.sessions.clear(); this.bytes = 0; }
}
