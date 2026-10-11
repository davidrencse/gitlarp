// Project context type.
import type { ProjectContext } from '../shared/types';
// GitHub file reader and repo path helper.
import { readFile, repoPath } from './github';

// A file excerpt sent to the AI.
export interface EvidenceFile { path: string; content: string; truncated: boolean }
// All evidence collected for an analysis.
export interface RepositoryEvidence {
  // Context, sampled files, omitted notes, and total character count.
  context: ProjectContext; files: EvidenceFile[]; omitted: string[]; sourceCharacters: number;
}
// Regex: manifest/config files that are always useful (package.json, Dockerfile, LICENSE, etc.).
const manifests = /(?:^|\/)(?:package\.json|pyproject\.toml|requirements\.txt|Cargo\.toml|go\.mod|pom\.xml|build\.gradle(?:\.kts)?|Gemfile|composer\.json|pubspec\.yaml|Dockerfile|docker-compose\.ya?ml|compose\.ya?ml|Makefile|\.nvmrc|\.node-version|\.env\.(?:example|sample|template)|LICENSE(?:\.[a-z]+)?)$/i;
// Regex: source code file extensions worth reading.
const code = /\.(?:tsx?|jsx?|mjs|cjs|py|rs|go|java|kt|cs|cpp|c|h|rb|php|swift|vue|svelte)$/i;
// Regex: paths never to read (dependencies, build output, keys, secrets, lockfiles).
const excluded = /(?:^|\/)(?:node_modules|vendor|dist|build|coverage|\.git|\.next|\.venv|venv|target|secrets?|credentials?)(?:\/|\.|$)|(?:^|\/)(?:id_rsa|id_ed25519)(?:\.|$)|\.(?:pem|key|p12|pfx|min\.js|map|lock)$/i;
// Decide whether a path is safe and useful to send to the AI.
export function safeSourcePath(path: string) {
  // Reject traversal, backslashes, and excluded paths.
  if (path.includes('..') || path.includes('\\') || excluded.test(path)) return false;
  // Block real .env files; only example/sample/template env files are allowed.
  if (/(?:^|\/)\.env(?:\.|$)/i.test(path) && !/\.env\.(?:example|sample|template)$/i.test(path)) return false;
  // Allow manifests, code, and documentation Markdown.
  return manifests.test(path) || code.test(path) || /^(?:docs\/.*|README|CONTRIBUTING).*\.md$/i.test(path);
}
// Remove secrets (private keys, API tokens, passwords) from text before sending it anywhere.
export function redactSecrets(text: string) {
  // Replace PEM private key blocks.
  return text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    // Replace well-known token formats (OpenAI, Groq, Slack, Stripe, Google, npm, GitLab, GitHub, AWS).
    .replace(/\b(?:sk-[a-zA-Z0-9_-]{16,}|gsk_[a-zA-Z0-9]{20,}|xox[abprs]-[a-zA-Z0-9-]{10,}|(?:sk|rk|pk)_(?:live|test)_[a-zA-Z0-9]{16,}|AIza[0-9A-Za-z_-]{35}|npm_[a-zA-Z0-9]{36}|glpat-[a-zA-Z0-9_-]{20,}|gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED TOKEN]')
    // Redact quoted values of keys like password/secret/api_key.
    .replace(/(\b[\w.-]*(?:secret|password|passwd|api[_-]?key|access[_-]?token|private[_-]?key)[\w.-]*\b["']?\s*[:=]\s*)(["'])([^\r\n]*?)\2/gi, '$1$2[REDACTED]$2')
    // Redact unquoted name=value assignments for the same keys.
    .replace(/(\b[\w.-]*(?:secret|password|passwd|api[_-]?key|access[_-]?token|private[_-]?key)[\w.-]*\b\s*=\s*)([^\s"'\r\n]+)/gi, '$1[REDACTED]');
}
// Score a path by how informative it is for understanding a project.
function rank(path: string) {
  // Manifests rank highest.
  if (manifests.test(path)) return 100;
  // README/architecture/setup docs next.
  if (/(?:^|\/)(?:readme|architecture|setup|getting-started).*\.md$/i.test(path)) return 90;
  // Entry points and server/route files.
  if (/(?:^|\/)(?:app|main|index|server|api|workbench|routes?|router|controllers?|services?)(?:\.|\/)/i.test(path)) return 80;
  // Domain files such as routes, models, schema, auth.
  if (/routes?|controllers?|services?|models?|schema|auth|database/i.test(path)) return 65;
  // Tests rank lowest.
  if (/test|spec/i.test(path)) return 40;
  // Everything else is in the middle.
  return 50;
}
// Select and read the most informative files within a character budget.
export async function collectEvidence(token: string, context: ProjectContext, signal?: AbortSignal): Promise<RepositoryEvidence> {
  // Budget from GROQ_CONTEXT_CHARS, clamped to 16k-160k (default 48k).
  const budget = Math.min(160_000, Math.max(16_000, Number(process.env.GROQ_CONTEXT_CHARS) || 48_000));
  // Output lists and the remaining budget.
  const files: EvidenceFile[] = []; const omitted: string[] = []; let remaining = budget;
  // Safe files, highest rank first, then alphabetical.
  const candidates = context.paths.filter(safeSourcePath).sort((a, b) => rank(b) - rank(a) || a.localeCompare(b));
  // Select up to 12 files in rank order, preserving directory diversity.
  const counts = new Map<string, number>(); const selected: string[] = [];
  for (const path of candidates) {
    const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (directory && (counts.get(directory) || 0) >= 6) continue;
    selected.push(path); counts.set(directory, (counts.get(directory) || 0) + 1);
    if (selected.length >= 12) break;
  }
  // Fetch selected source in parallel; the GitHub client caps per-account
  // read concurrency. Process results in rank order to keep evidence stable.
  const base = repoPath(context.repo.owner.login, context.repo.name);
  const results = await Promise.all(selected.map(async path => {
    signal?.throwIfAborted();
    try { return { path, content: path === (context.readmePath || 'README.md') && context.readme !== null ? context.readme : await readFile(token, base, path, context.head) }; }
    catch (error) { return { path, error }; }
  }));
  for (const result of results) {
    signal?.throwIfAborted();
    if ('error' in result) {
      const error = result.error;
      if ((error as { status?: number }).status === 422 || (error as { status?: number }).status === 404) { omitted.push(`${result.path}: too large or unavailable`); continue; }
      throw error;
    }
    const { path, content } = result;
    if (content === null || content.includes('\0')) { omitted.push(`${path}: unavailable or binary`); continue; }
    let cleaned = /(?:^|\/)\.env\./i.test(path) ? content.split('\n').map(line => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line) ? `${line.split('=')[0]}=[VALUE OMITTED]` : line.startsWith('#') ? line : '').join('\n') : redactSecrets(content);
    const limit = Math.min(8000, remaining); const truncated = cleaned.length > limit;
    cleaned = cleaned.slice(0, limit); remaining -= cleaned.length;
    files.push({ path, content: cleaned, truncated });
    if (truncated) omitted.push(`${path}: excerpt only`);
  }
  // Record that not every eligible file was read.
  if (candidates.length > files.length) omitted.push(`${candidates.length - files.length} eligible files were not fully sampled; analysis is not a complete audit.`);
  // Record when GitHub truncated the file tree.
  if (context.truncated) omitted.push('GitHub returned an incomplete file tree.');
  // Return the evidence.
  return { context, files, omitted, sourceCharacters: budget - remaining };
}
// Build the JSON text sent to the AI describing the repository.
export function evidencePayload(evidence: RepositoryEvidence) {
  // Take context and files.
  const { context, files } = evidence;
  // Set of sampled file paths.
  const sampled = new Set(files.map(file => file.path));
  // Eligible files that were not sampled.
  const uninspected = context.paths.filter(path => safeSourcePath(path) && !sampled.has(path));
  // Whether package.json is already fully included.
  const manifestSampled = files.some(file => file.path === 'package.json' && !file.truncated);
  // Include a manifest summary only when the file was not sampled.
  const manifest = manifestSampled || !context.manifest ? undefined : {
    // Name, scripts, and Node engine.
    name: context.manifest.name, scripts: context.manifest.scripts, engines: context.manifest.engines,
    // Up to 30 dependency names.
    dependencies: Object.keys(context.manifest.dependencies || {}).slice(0, 30),
    // Up to 30 devDependency names.
    devDependencies: Object.keys(context.manifest.devDependencies || {}).slice(0, 30),
  };
  // Serialize repository info, then redact any secrets in the output.
  return redactSecrets(JSON.stringify({ repository: { name: context.repo.full_name, description: context.repo.description, language: context.repo.language, branch: context.repo.default_branch, url: context.repo.html_url },
    // Head commit, files, a sample of unread paths, and the total count.
    head: context.head, files, otherPaths: uninspected.slice(0, 80), otherPathCount: uninspected.length,
    // Add the manifest summary if present.
    ...(manifest ? { manifest } : {}),
    // Six recent commit subjects plus coverage notes.
    recentCommits: context.commits.slice(0, 6).map(commit => ({ date: commit.date.slice(0, 10), subject: commit.message.split('\n')[0].slice(0, 180) })), coverage: evidence.omitted }));
}

// Retrieve local excerpts without spending an extra model call. The analysis
// maps concepts to source files; lexical windows narrow those files further.
// Pick the most relevant excerpts of the evidence for a user's question.
export function questionEvidence(evidence: RepositoryEvidence, question: string, hints: string[] = []) {
  // Extract unique keywords of 4+ characters, ignoring common words.
  const words = [...new Set(question.toLowerCase().split(/[^a-z0-9_]+/).filter(word => word.length >= 4 && !['what', 'which', 'does', 'about', 'this', 'that', 'with', 'from', 'explain', 'project', 'would', 'have', 'code'].includes(word)))];
  // Score each file by hints, keyword in path, and keyword frequency.
  const ranked = evidence.files.map(file => ({ file, score: (hints.includes(file.path) ? 20 : 0) + words.reduce((score, word) => score + (file.path.toLowerCase().includes(word) ? 8 : 0) + Math.min(6, file.content.toLowerCase().split(word).length - 1), 0) })).sort((a, b) => b.score - a.score);
  // Take the top 4 files.
  const files = ranked.slice(0, 4).map(({ file }) => {
    // Start positions of excerpts: the file start plus keyword matches.
    const starts = [0]; const lower = file.content.toLowerCase();
    // Add windows around up to 4 keyword matches that are not too close together.
    for (const word of words) { const position = lower.indexOf(word); if (position >= 0 && !starts.some(start => Math.abs(start - position) < 500)) starts.push(Math.max(0, position - 350)); if (starts.length >= 4) break; }
    // Join the excerpts (max 1800 chars), marking gaps.
    const content = starts.sort((a, b) => a - b).map(start => file.content.slice(start, start + 520)).join('\n[…excerpt gap…]\n').slice(0, 1800);
    // Return the file with trimmed content.
    return { ...file, content, truncated: true };
  });
  // Return the evidence with the narrowed files and recalculated size.
  return { ...evidence, files, sourceCharacters: files.reduce((sum, file) => sum + file.content.length, 0) };
}
