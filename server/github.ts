// Shared types for project and repo data.
import type { ProjectContext, Repo } from '../shared/types';
// zod validates untrusted JSON (package.json).
import { z } from 'zod';
// Maximum allowed file size.
import { MAX_FILE_BYTES } from '../shared/validation';
// Low-level GitHub API client and error class.
import { github, HttpError } from './github-client';
// Re-export so other modules can import them from here.
export { github, HttpError } from './github-client';

// Build the API path for a repo; owner and name are URL-encoded.
export const repoPath = (owner: string, name: string) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
// Read one file's text from a repo at a given ref; null when the file doesn't exist.
export async function readFile(token: string, base: string, path: string, ref: string): Promise<string | null> {
  // Wrap in try so a 404 can be turned into null.
  try {
    // Call the GitHub "contents" endpoint with every path segment encoded.
    const data = await github(token, `${base}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`);
    // Refuse non-base64 or oversized files (so they are never overwritten blindly).
    if (data.encoding !== 'base64' || typeof data.content !== 'string' || data.size > MAX_FILE_BYTES) throw new HttpError(422, `The original ${path} is too large or has an unsupported format. It will not be overwritten.`);
    // Decode the base64 content.
    const decoded = Buffer.from(data.content, 'base64');
    // Double-check the decoded size against the limit.
    if (decoded.length > MAX_FILE_BYTES) throw new HttpError(422, `The original ${path} exceeds the file size limit. It will not be overwritten.`);
    // Return the file as UTF-8 text.
    return decoded.toString('utf8');
  // Missing file (404) -> null; any other error propagates.
  } catch (error) { if (error instanceof HttpError && error.status === 404) return null; throw error; }
}
// Gather everything needed to analyze a repo: files, README, package.json, commits.
export async function inspectProject(token: string, owner: string, name: string): Promise<ProjectContext> {
  // Base API path for the repo.
  const base = repoPath(owner, name);
  // Fetch repo metadata.
  const repo = await github<Repo>(token, base);
  // Look up the default branch reference.
  const branch = await github(token, `${base}/git/ref/heads/${encodeURIComponent(repo.default_branch)}`).catch(error => {
    // A 404/409 means the repository has no commits yet.
    if (error instanceof HttpError && (error.status === 404 || error.status === 409)) throw new HttpError(422, 'This repository has no commits yet. Add an initial file on GitHub, then refresh.');
    // Give a clear, actionable error message.
    throw error;
  // Rethrow anything else.
  });
  // HEAD commit SHA of the default branch.
  const head = branch.object.sha;
  // Fetch the full recursive file tree at HEAD.
  const tree = await github(token, `${base}/git/trees/${head}?recursive=1`);
  // Keep only file entries (blobs) and take their paths.
  const paths: string[] = tree.tree.filter((entry: any) => entry.type === 'blob').map((entry: any) => entry.path);
  // Locate the README (case-insensitive), defaulting to README.md.
  const readmePath = paths.includes('README.md') ? 'README.md' : paths.find(path => /^readme\.md$/i.test(path)) || 'README.md';
  // Fetch README, package.json, and recent commits in parallel.
  const [readme, manifestText, history] = await Promise.all([
    // README text; ignore too-large/unsupported files.
    readFile(token, base, readmePath, head).catch(error => { if (error instanceof HttpError && error.status === 422) return null; throw error; }),
    // package.json text; ignore too-large/unsupported files.
    readFile(token, base, 'package.json', head).catch(error => { if (error instanceof HttpError && error.status === 422) return null; throw error; }),
    // Latest 20 commits.
    github<any[]>(token, `${base}/commits?sha=${head}&per_page=20`),
  ]);
  // Parsed package.json starts empty.
  let manifest: ProjectContext['manifest'] = null;
  // Validate package.json shape with zod; ignore invalid JSON or shapes.
  if (manifestText) { try { manifest = z.object({ name: z.string().optional(), scripts: z.record(z.string(), z.string()).optional(), dependencies: z.record(z.string(), z.string()).optional(), devDependencies: z.record(z.string(), z.string()).optional(), engines: z.object({ node: z.string().optional() }).optional() }).parse(JSON.parse(manifestText)); } catch { /* Invalid manifests do not prevent documentation review. */ } }
  // Return the assembled project context.
  return {
    // Repo, HEAD, file paths, README, manifest, and whether the tree was truncated.
    repo, head, paths, readme, readmePath, manifest, truncated: !!tree.truncated,
    // Simplify each commit to sha, message, date, and author.
    commits: history.map((entry: any) => ({ sha: entry.sha, message: entry.commit.message, date: entry.commit.author.date, author: entry.commit.author.name })),
  };
}
