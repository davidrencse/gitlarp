// Store short-lived repository inspections so generation can reuse the
// reviewed tree after confirming the branch HEAD is still current.
import { randomUUID } from 'node:crypto';
import type { ProjectContext } from '../shared/types';

type Entry = { owner: string; context: ProjectContext; bytes: number; expires: number };

export class ProjectSnapshotStore {
  private entries = new Map<string, Entry>();
  private bytes = 0;

  constructor(private now = Date.now, private byteBudget = 16 * 1024 * 1024, private maxEntries = 32, private ttlMs = 10 * 60_000) {}

  private remove(id: string) {
    const entry = this.entries.get(id);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(id);
  }

  private prune() {
    for (const [id, entry] of this.entries) if (entry.expires <= this.now()) this.remove(id);
  }

  put(owner: string, context: ProjectContext, id: string = randomUUID()) {
    this.prune();
    const bytes = Buffer.byteLength(JSON.stringify(context));
    if (bytes > this.byteBudget) return undefined;
    this.remove(id);
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.byteBudget) this.remove(this.entries.keys().next().value!);
    this.entries.set(id, { owner, context, bytes, expires: this.now() + this.ttlMs });
    this.bytes += bytes;
    return id;
  }

  get(owner: string, id: string | undefined, repo: string) {
    this.prune();
    if (!id) return undefined;
    const entry = this.entries.get(id);
    if (!entry || entry.owner !== owner || entry.context.repo.full_name.toLowerCase() !== repo.toLowerCase()) return undefined;
    return entry.context;
  }

  delete(id: string | undefined) { if (id) this.remove(id); }

  clearOwner(owner: string) {
    for (const [id, entry] of this.entries) if (entry.owner === owner) this.remove(id);
  }
}
