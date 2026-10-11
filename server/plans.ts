// Plan and result types.
import type { Plan, PublishResult } from '../shared/types';
// Size and time limits.
import { MAX_PLAN_BYTES, PLAN_TTL_MS } from '../shared/validation';
// HTTP error class.
import { HttpError } from './github-client';

// A stored plan: owner, content, expiry, size, publish state, request fingerprint, and result.
type Entry = { owner: string; plan: Plan; expires: number; bytes: number; state: 'draft' | 'publishing' | 'published'; fingerprint?: string; result?: PublishResult };
// Keep large previews out of express-session. Per-plan mutation state is atomic
// inside this one process and cannot be resurrected by an older HTTP session.
// In-memory store of plans waiting to be published.
export class PlanStore {
  // Entries by plan id.
  private entries = new Map<string, Entry>();
  // Total bytes stored.
  private bytes = 0;
  // Injectable clock and a 32 MB budget.
  constructor(private now = Date.now, private budget = 32 * 1024 * 1024) {}
  // Remove an entry and update the byte total.
  private remove(id: string) { const entry = this.entries.get(id); if (entry) this.bytes -= entry.bytes; this.entries.delete(id); }
  // Remove expired plans (never one that is being published).
  private prune() { for (const [id, entry] of this.entries) if (entry.state !== 'publishing' && entry.expires <= this.now()) this.remove(id); }
  // Store a new plan for an owner.
  put(owner: string, plan: Plan) {
    // Prune expired plans first.
    this.prune();
    // Reject duplicate ids.
    if (this.entries.has(plan.id)) throw new HttpError(409, 'This preview already exists. Generate a fresh preview.');
    // Measure the plan size.
    const bytes = Buffer.byteLength(JSON.stringify(plan));
    // Reject oversized plans.
    if (bytes > MAX_PLAN_BYTES * 2 + 100_000) throw new HttpError(413, 'This preview is too large. Choose fewer improvements.');
    // This owner's plans.
    const own = [...this.entries.values()].filter(entry => entry.owner === owner);
    // Allow at most 10 plans per owner.
    if (own.length >= 10) {
      // Find the oldest plan that is not being published.
      const oldest = [...this.entries].find(([, entry]) => entry.owner === owner && entry.state !== 'publishing');
      // If none can be removed, refuse.
      if (!oldest) throw new HttpError(429, 'Too many previews are being published.');
      // Remove it to make room.
      this.remove(oldest[0]);
    }
    // Reject if total storage would overflow.
    if (this.bytes + bytes > this.budget) throw new HttpError(503, 'Preview storage is full. Try again after older previews expire.');
    // Save the plan as a draft with an expiry.
    this.entries.set(plan.id, { owner, plan, bytes, expires: this.now() + PLAN_TTL_MS, state: 'draft' }); this.bytes += bytes;
  }
  // Start publishing a plan; returns the plan or a previous result.
  begin(owner: string, id: string, fingerprint: string): { plan: Plan; result?: PublishResult } {
    // Prune first.
    this.prune();
    // Look up the plan.
    const entry = this.entries.get(id);
    // Missing or not owned -> 404.
    if (!entry || entry.owner !== owner) throw new HttpError(404, 'Preview not found or expired. Generate a fresh preview.');
    // Already being published -> conflict.
    if (entry.state === 'publishing') throw new HttpError(409, 'This preview is already being published.');
    // Already published: allow an identical retry.
    if (entry.state === 'published') {
      // Different options than the first publish -> conflict.
      if (entry.fingerprint !== fingerprint) throw new HttpError(409, 'This preview was already published with different options.');
      // Return the saved result (idempotent).
      return { plan: entry.plan, result: entry.result };
    }
    // Mark the plan as publishing and remember the request fingerprint.
    entry.state = 'publishing'; entry.fingerprint = fingerprint;
    // Return the plan to publish.
    return { plan: entry.plan };
  }
  // Finish publishing: record the result, or return to draft on failure.
  finish(id: string, result?: PublishResult) {
    // Look up the plan.
    const entry = this.entries.get(id);
    // Ignore if it no longer exists.
    if (!entry) return;
    // Published with a result, otherwise back to draft.
    entry.state = result ? 'published' : 'draft'; entry.result = result;
  }
  // Delete all plans for an owner.
  clearOwner(owner: string) { for (const [id, entry] of this.entries) if (entry.owner === owner) this.remove(id); }
}
