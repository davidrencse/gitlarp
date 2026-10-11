// zod validates the publish request.
import { z } from 'zod';
// GitHub API client (injectable for tests), error class, and repo path helper.
import { github as defaultGithub, HttpError, repoPath } from './github';
// Shared types.
import type { Plan, PublishResult } from '../shared/types';
// Limits and validators shared with the UI.
import { MAX_FILE_BYTES, MAX_PLAN_BYTES, PLAN_TTL_MS, validBranch, validRepoName } from '../shared/validation';

// A date string that parses and is not in the future.
const pastDate = z.string().refine(value => Number.isFinite(Date.parse(value)), 'Invalid commit date').refine(value => Date.parse(value) <= Date.now(), 'Commit dates must be in the past');
// Schema for the publish request body.
export const publishSchema = z.object({
  // Plan id, and the target: existing repo branch, fork, or new repo.
  planId: z.string().uuid(), target: z.enum(['branch', 'fork', 'new']),
  // Branch name must be valid.
  branch: z.string().refine(validBranch, 'Invalid branch name'),
  // Name for a new repo, if used.
  name: z.string().refine(validRepoName, 'Invalid repository name').optional(),
  // Visibility, whether to open pull requests, and whether to use one branch per commit.
  private: z.boolean().optional(), createPr: z.boolean(), splitBranches: z.boolean().optional(),
  // Final files (up to 20, each 250 KB max).
  files: z.array(z.object({ path: z.string().max(250), content: z.string().max(MAX_FILE_BYTES).refine(value => Buffer.byteLength(value) <= MAX_FILE_BYTES, 'File exceeds 250 KB in UTF-8') })).min(1).max(20),
  // One commit message per commit group.
  messages: z.array(z.string().trim().min(5).max(200)).min(1).max(10),
  // Optional history settings for dating commits.
  history: z.object({
    // Author name.
    authorName: z.string().trim().min(1).max(100).refine(value => !/[\u0000-\u001f\u007f]/.test(value), 'Author name cannot contain control characters'),
    // Author email, validated.
    authorEmail: z.string().trim().min(3).max(200).refine(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), 'Invalid author email'),
    // Earliest and latest commit dates.
    from: pastDate, to: pastDate,
  // The earliest date must not be after the latest.
  }).refine(value => Date.parse(value.from) <= Date.parse(value.to), 'The latest commit date must not be before the earliest').optional(),
// All files together must fit in 1 MB.
}).refine(value => value.files.reduce((size, file) => size + Buffer.byteLength(file.content), 0) <= MAX_PLAN_BYTES, 'Combined file contents exceed 1 MB');
// TypeScript type of a validated request.
export type ValidPublish = z.infer<typeof publishSchema>;

// Spread commit dates evenly between two dates.
function spreadDates(from: string, to: string, count: number): string[] {
  // Start time in ms.
  const start = Date.parse(from);
  // End time in ms.
  const end = Date.parse(to);
  // With a single commit or identical bounds, use the start date for all.
  if (count <= 1 || start === end) return Array.from({ length: count }, () => new Date(start).toISOString());
  // Time between consecutive commits.
  const step = (end - start) / (count - 1);
  // Evenly spaced ISO timestamps.
  return Array.from({ length: count }, (_, i) => new Date(start + Math.round(step * i)).toISOString());
}

// Check the request matches the stored plan, throwing a clear error otherwise.
export function validatePlan(plan: Plan, input: ValidPublish) {
  // Plan age in ms.
  const age = Date.now() - new Date(plan.createdAt).getTime();
  // Reject expired or invalid-age plans.
  if (!Number.isFinite(age) || age < 0 || age >= PLAN_TTL_MS) throw new HttpError(409, 'This preview expired. Generate a fresh preview before publishing.');
  // Paths in the stored plan.
  const expected = new Set(plan.files.map(f => f.path));
  // Paths in the request.
  const actual = new Set(input.files.map(f => f.path));
  // The sets of paths must match exactly (no extra, missing, or duplicate).
  if (actual.size !== input.files.length || actual.size !== expected.size || [...actual].some(p => !expected.has(p))) throw new HttpError(400, 'The files do not match the reviewed plan. Generate a new preview.');
  // One message per commit group.
  if (input.messages.length !== plan.commits.length) throw new HttpError(400, 'Commit messages do not match the reviewed plan.');
  // A new repo needs a name.
  if (input.target === 'new' && !input.name) throw new HttpError(400, 'Choose a name for the new documentation repository.');
  // Reject a publish with no actual changes.
  if (input.target !== 'new' && input.files.every(f => f.content === plan.files.find(p => p.path === f.path)?.original)) throw new HttpError(400, 'There are no file changes to publish.');
  // CI workflows can't be published to a new docs-only repo.
  if (input.target === 'new' && input.files.some(f => f.path.startsWith('.github/workflows/'))) throw new HttpError(400, 'CI checks require the original source code. Publish this plan to a branch or fork, or regenerate without CI.');
}

// Publish the reviewed plan to GitHub; returns the branches and PR links.
export async function publish(token: string, plan: Plan, input: ValidPublish, github = defaultGithub): Promise<PublishResult> {
  // Validate the request against the plan.
  validatePlan(plan, input);
  // Repo that will receive the commits.
  let destination = plan.repo;
  // API base path for that repo.
  let base = repoPath(destination.owner.login, destination.name);
  // Commit to build on.
  let parent = plan.head;
  // Tree to build on.
  let treeSha: string;
  // URL of a repo created during this publish (for error messages).
  let createdUrl: string | undefined;
  // Number of files changed.
  let filesChanged = 0;
  // For existing repos, confirm that HEAD has not moved.
  if (input.target !== 'new') {
    // Read the current default branch ref.
    const current = await github(token, `${base}/git/ref/heads/${encodeURIComponent(plan.repo.default_branch)}`);
    // If it changed, ask the user to regenerate the preview.
    if (current.object.sha !== plan.head) throw new HttpError(409, 'The project changed since this preview. Refresh the project and generate a new preview.');
  }
  // Reject known permission problems before generating any remote objects.
  // Branch publishing needs push access and a non-archived repo.
  if (input.target === 'branch' && (plan.repo.archived || !plan.repo.permissions?.push)) throw new HttpError(403, 'You do not have write access. Choose a fork or a new documentation repository.');
  // Wrap remote work so errors can mention a repo created along the way.
  try {
    // Fork flow.
    if (input.target === 'fork') {
      // Look up the signed-in user.
      const user = await github(token, '/user');
      // Owners should publish to a branch, not fork their own repo.
      if (user.login.toLowerCase() === plan.repo.owner.login.toLowerCase()) throw new HttpError(422, 'You own this repository. Publish to a new branch instead.');
      // Create a fork (default branch only).
      destination = await github(token, `${base}/forks`, 'POST', { default_branch_only: true });
      // Remember its URL.
      createdUrl = destination.html_url;
      // Switch the base path to the fork.
      base = repoPath(destination.owner.login, destination.name);
      // Track whether the fork is ready.
      let ready = false;
      // Poll up to 12 times while GitHub prepares it.
      for (let attempt = 0; attempt < 12; attempt++) {
        // Try to read the fork's branch.
        try {
          // Get the fork's default branch ref.
          const ref = await github(token, `${base}/git/ref/heads/${encodeURIComponent(destination.default_branch)}`);
          // Use that commit as the parent.
          parent = ref.object.sha;
          // The fork must match the reviewed commit.
          if (parent !== plan.head) throw new HttpError(409, 'Your fork has a different base commit. Refresh and select the fork to generate its preview.');
          // Fork is ready; stop polling.
          ready = true; break;
        // Retry on 404/409 (still preparing); rethrow other errors and base mismatches.
        } catch (error) { if (!(error instanceof HttpError) || (error.status !== 404 && error.status !== 409)) throw error; if (error.status === 409 && error.message.includes('different base')) throw error; }
        // Wait with exponential backoff (max 5 s).
        if (attempt < 11) await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 5000)));
      }
      // Fail if the fork never became ready.
      if (!ready) throw new HttpError(503, `Your fork is still being prepared. Wait a moment, refresh projects, and select ${destination.full_name}.`);
    }
    // New-repo flow.
    if (input.target === 'new') {
      // Create the repo with an initial commit.
      destination = await github(token, '/user/repos', 'POST', { name: input.name, description: `Documentation for ${plan.repo.full_name}`, private: input.private ?? true, auto_init: true });
      // Remember its URL.
      createdUrl = destination.html_url;
      // Switch the base path to the new repo.
      base = repoPath(destination.owner.login, destination.name);
      // GitHub can return before auto_init has created the default ref.
      // Holds the new repo's ref.
      let ref: { object: { sha: string } } | undefined;
      // Poll up to 6 times.
      for (let attempt = 0; attempt < 6; attempt++) {
        // Try to read the default branch ref.
        try { ref = await github(token, `${base}/git/ref/heads/${encodeURIComponent(destination.default_branch)}`); break; }
        // Retry on 404/409; rethrow other errors.
        catch (error) { if (!(error instanceof HttpError) || ![404, 409].includes(error.status)) throw error; }
        // Wait with backoff (max 4 s).
        if (attempt < 5) await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 4000)));
      }
      // Fail if it never appeared.
      if (!ref) throw new HttpError(503, 'GitHub is still initializing the repository.');
      // Build on the new repo's initial commit.
      parent = ref.object.sha;
    } else {
      // Existing repo (not a fork): re-check write access.
      if (destination.archived || !destination.permissions?.push && input.target === 'branch') throw new HttpError(403, 'You do not have write access. Choose a fork or a new documentation repository.');
    }
    // Prepare one group per commit, keeping only files that actually changed.
    const groups = plan.commits.map((group, index) => {
      // Files in this group that differ from the original (or all, for a new repo).
      const changes = group.files.map(path => input.files.find(f => f.path === path)!).filter(f => input.target === 'new' || f.content !== plan.files.find(p => p.path === f.path)?.original);
      // Make a short branch-name slug from the commit message.
      const slug = group.message.toLowerCase().replace(/^[a-z]+:\s*/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 35).replace(/-$/g, '') || 'changes';
      // Suffix with the commit number and slug.
      const suffix = `-${String(index + 1).padStart(2, '0')}-${slug}`;
      // Shorten the base branch name so the total stays within 120 characters.
      const prefix = input.branch.slice(0, Math.max(1, 120 - suffix.length)).replace(/[/-]+$/g, '') || 'docs';
      // Group data: message, changes, and branch (one per commit if split, otherwise the single branch).
      return { index, message: input.messages[index], changes, branch: input.splitBranches ? `${prefix}${suffix}` : input.branch };
    // Skip groups with no changes.
    }).filter(group => group.changes.length);
    // Ensure none of the target branches already exist.
    for (const group of groups) {
      // Reject invalid generated branch names.
      if (!validBranch(group.branch)) throw new HttpError(400, `Generated branch name is invalid: ${group.branch}`);
      // Check for an existing branch.
      try {
        // Read the branch ref.
        await github(token, `${base}/git/ref/heads/${encodeURIComponent(group.branch)}`);
        // If found, refuse so nothing is overwritten.
        throw new HttpError(409, `Branch ${group.branch} already exists. Choose a different starting name.`);
      // A 404 means the branch is free; other errors are rethrown.
      } catch (error) { if (!(error instanceof HttpError && error.status === 404)) throw error; }
    }
    // Read the parent commit to find its tree.
    const commit = await github(token, `${base}/git/commits/${parent}`);
    // Base tree for the first commit.
    treeSha = commit.tree.sha;
    // Number of commits created.
    let commitCount = 0;
    // Created commits and the branch each belongs to.
    const outputs: { name: string; sha: string }[] = [];
    // Parent used by every commit when split into branches.
    const initialParent = parent;
    // Optional spread of commit dates.
    const dates = input.history ? spreadDates(input.history.from, input.history.to, groups.length) : null;
    // Create one commit per group.
    for (const [groupIndex, group] of groups.entries()) {
      // Author and committer identity when history is customized.
      const identity = input.history ? { name: input.history.authorName, email: input.history.authorEmail, date: dates![groupIndex] } : undefined;
      // Create a tree with the changed files.
      const tree = await github(token, `${base}/git/trees`, 'POST', { base_tree: treeSha, tree: group.changes.map(file => ({ path: file.path, mode: '100644', type: 'blob', content: file.content })) });
      // Create the commit (chained, or each based on the original when split).
      const next = await github(token, `${base}/git/commits`, 'POST', { message: group.message, tree: tree.sha, parents: [input.splitBranches ? initialParent : parent], ...(identity ? { author: identity, committer: identity } : {}) });
      // Chain the next commit on the previous one (single-branch mode).
      if (!input.splitBranches) { treeSha = tree.sha; parent = next.sha; }
      // Record the commit and update counters.
      outputs.push({ name: group.branch, sha: next.sha }); commitCount++; filesChanged += group.changes.length;
    }
    // Create refs only after every reviewed commit exists. The default branch is never updated.
    // Branches created so far.
    const branches: NonNullable<PublishResult['branches']> = [];
    // Publish every commit's branch, or only the last one in single-branch mode.
    const publishedOutputs = input.splitBranches ? outputs : outputs.slice(-1);
    // Create each branch.
    for (const output of publishedOutputs) {
      // Create the branch ref pointing to the commit.
      try { await github(token, `${base}/git/refs`, 'POST', { ref: `refs/heads/${output.name}`, sha: output.sha }); }
      // On failure after some branches exist, report which ones.
      catch (error) {
        // Throw an error naming the created branches.
        if (branches.length) throw new HttpError(error instanceof HttpError ? error.status : 502, `Publishing stopped after these branches were created: ${branches.map(branch => branch.name).join(', ')}. Check them on GitHub before retrying.`, error instanceof HttpError ? error.retryAfter : undefined);
        // Otherwise rethrow.
        throw error;
      }
      // Record the branch and its GitHub URL.
      branches.push({ name: output.name, url: `${destination.html_url}/tree/${output.name.split('/').map(encodeURIComponent).join('/')}` });
    }
    // Build the publish result.
    const result: PublishResult = { url: branches.at(-1)?.url || destination.html_url, repoUrl: destination.html_url, branch: branches.at(-1)?.name || input.branch, ...(input.splitBranches ? { branches } : {}), commits: commitCount, files: filesChanged };
    // Optionally open draft pull requests.
    if (input.createPr) {
      // Collected pull request URLs.
      const prUrls: string[] = [];
      // One PR per branch.
      for (const [index, branch] of branches.entries()) {
        // Pull request failures should not fail the publish.
        try {
          // Matching commit group.
          const group = groups[index];
          // Create a draft PR with a descriptive body.
          const pr = await github(token, `${base}/pulls`, 'POST', { title: input.splitBranches ? group?.message || branch.name : 'Improve project documentation and repository setup', head: branch.name, base: destination.default_branch, draft: true, body: `## Changes\n\n${input.splitBranches ? group?.message || '' : input.messages.map(message => `- ${message}`).join('\n')}\n\nGenerated and reviewed with GitLarp.\n\n## Review\n\nCheck the generated instructions against the project's runtime and review all file changes before merging.` });
          // Record the PR URL.
          branch.prUrl = pr.html_url; prUrls.push(pr.html_url);
        // Record PR errors on the branch.
        } catch (error) { branch.prError = error instanceof HttpError ? error.message : 'GitHub could not confirm draft pull request creation.'; }
      }
      // Expose the PR URLs.
      if (prUrls.length) { result.prUrls = prUrls; result.prUrl = prUrls[0]; }
      // Collect any PR errors.
      const errors = branches.map(branch => branch.prError).filter(Boolean);
      // Combine them into one message.
      if (errors.length) result.prError = errors.join(' ');
    }
    // Return the result.
    return result;
  // On any error:
  } catch (error) {
    // Mention a repo created during this publish so the user can check it.
    if (createdUrl) throw new HttpError(error instanceof HttpError ? error.status : 502, `${error instanceof Error ? error.message : 'Publishing failed.'} The destination repository is at ${createdUrl}; check it before retrying.`, error instanceof HttpError ? error.retryAfter : undefined);
    // Otherwise rethrow.
    throw error;
  }
}
