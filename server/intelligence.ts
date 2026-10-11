// Hashing and random ids.
import { createHash, randomUUID } from 'node:crypto';
// AI-related shared types.
import type { AIReport, AIUsage, ProjectAnalysis } from '../shared/types';
// Evidence type.
import type { RepositoryEvidence } from './evidence';
// Used for default model name.
import { aiSettings } from './groq';
// HTTP error class.
import { HttpError } from './github';

// One stored analysis: owner session, evidence, report, instructions hash, size, and expiry.
type Entry = { owner: string; evidence: RepositoryEvidence; report: AIReport; brief: string; bytes: number; expires: number };
// In-memory store of AI analyses, bounded by count, bytes, and time.
export class IntelligenceStore {
  // Entries by report id.
  private entries = new Map<string, Entry>();
  // Total bytes stored.
  private bytes = 0;
  // Currently running AI task per owner (for cancellation).
  private active = new Map<string, AbortController>();
  // Injectable clock and a byte budget (8 MB).
  constructor(private now = Date.now, private budget = 8 * 1024 * 1024) {}
  // Remove an entry and update the byte total.
  private remove(id: string) { const value = this.entries.get(id); if (value) this.bytes -= value.bytes; this.entries.delete(id); }
  // Remove all expired entries.
  private prune() { for (const [id, entry] of this.entries) if (entry.expires <= this.now()) this.remove(id); }
  // Store a new analysis and return its report.
  put(owner: string, evidence: RepositoryEvidence, analysis: ProjectAnalysis, usage?: AIUsage, model = aiSettings().model, instructions = ''): AIReport {
    // Clear expired entries first.
    this.prune();
    // Build the report with a new id and metadata.
    const report: AIReport = { id: randomUUID(), provider: 'Groq', model, head: evidence.context.head, analysis, ...(usage ? { usage } : {}),
      // Source file list, omitted notes, size, and creation time.
      sourceFiles: evidence.files.map(file => file.path), omitted: evidence.omitted, sourceCharacters: evidence.sourceCharacters, createdAt: new Date(this.now()).toISOString() };
    // Size of the stored data in bytes.
    const bytes = Buffer.byteLength(JSON.stringify({ evidence, report }));
    // This owner's existing entries.
    const own = [...this.entries].filter(([, entry]) => entry.owner === owner);
    // Keep at most 3 per owner by removing the oldest.
    if (own.length >= 3) this.remove(own[0][0]);
    // Reject an entry larger than the whole budget.
    if (bytes > this.budget) throw new HttpError(413, 'This repository context is too large.');
    // Evict the oldest entries until under 50 entries and the byte budget.
    while (this.entries.size >= 50 || this.bytes + bytes > this.budget) this.remove(this.entries.keys().next().value!);
    // Hash the user instructions so identical requests can reuse the analysis.
    const brief = createHash('sha256').update(instructions.trim()).digest('hex');
    // Save the entry with a 20-minute expiry.
    this.entries.set(report.id, { owner, evidence, report, brief, bytes, expires: this.now() + 20 * 60_000 }); this.bytes += bytes;
    // Return the report.
    return report;
  }
  // Find a cached analysis for the same owner, repo, commit, and instructions.
  find(owner: string, repo: number, head: string, instructions: string) {
    // Prune, then hash the instructions.
    this.prune(); const brief = createHash('sha256').update(instructions.trim()).digest('hex');
    // Search newest first.
    return [...this.entries.values()].reverse().find(entry => entry.owner === owner && entry.evidence.context.repo.id === repo && entry.report.head === head && entry.brief === brief);
  }
  // Fetch an analysis by id (only for its owner).
  get(owner: string, id: string) {
    // Prune, then look up.
    this.prune(); const entry = this.entries.get(id);
    // Not found or not owned -> 404.
    if (!entry || entry.owner !== owner) throw new HttpError(404, 'Project analysis expired. Analyze this project again.');
    // Return the entry.
    return entry;
  }
  // Mark the start of an AI task for an owner.
  begin(owner: string) {
    // Only one task at a time per owner.
    if (this.active.has(owner)) throw new HttpError(409, 'Groq is already working on this connection. Wait for it to finish.');
    // At most 4 tasks across all owners.
    if (this.active.size >= 4) throw new HttpError(429, 'All AI request slots are busy. Please try again shortly.');
    // Create and register an AbortController.
    const controller = new AbortController(); this.active.set(owner, controller); return controller;
  }
  // Mark the task as finished.
  finish(owner: string) { this.active.delete(owner); }
  // Cancel the owner's task and delete all of their analyses.
  clearOwner(owner: string) { this.active.get(owner)?.abort(); for (const [id, entry] of this.entries) if (entry.owner === owner) this.remove(id); }
}
