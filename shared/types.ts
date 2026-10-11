// GitHub user shown in the UI after sign-in.
export interface User { login: string; name: string | null; avatar_url: string; id: number }
// GitHub repository metadata (subset of the GitHub REST API response).
export interface Repo {
  // Identity and display fields.
  id: number; name: string; full_name: string; description: string | null;
  // Visibility, language, and popularity counters.
  private: boolean; language: string | null; stargazers_count: number; forks_count: number;
  // Timestamps and the default branch name.
  updated_at: string; pushed_at: string; default_branch: string;
  // Owner login, web URL, and archive flag.
  owner: { login: string }; html_url: string; archived?: boolean;
  // What the signed-in user may do (push/admin) plus topic tags.
  permissions?: { push: boolean; admin: boolean }; topics?: string[];
}
// One git commit summarized for the changelog.
export interface Commit { sha: string; message: string; date: string; author: string }
// Everything the app learns about a repo before generating docs.
export interface ProjectContext {
  // Repo metadata, HEAD commit SHA, list of file paths, README text and path.
  repo: Repo; head: string; paths: string[]; readme: string | null; readmePath?: string;
  // Opaque, session-bound server snapshot handle for fast follow-up requests.
  inspectionId?: string;
  // Parsed package.json (null when absent or invalid).
  manifest: { name?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; engines?: { node?: string } } | null;
  // Recent commits and whether GitHub truncated the file tree.
  commits: Commit[]; truncated?: boolean;
}
// Identifiers of the documentation modules the user can select.
export type ModuleId = 'readme' | 'docs' | 'contributing' | 'changelog' | 'templates' | 'editorconfig' | 'ci';
// A selectable module: title, description, and files it generates.
export interface Module { id: ModuleId; title: string; description: string; files: string[] }
// One generated file: its path, new content, original content (for diffs), and owning module.
export interface GeneratedFile { path: string; content: string; original: string | null; module: ModuleId }
// A group of files committed together with one message.
export interface CommitGroup { message: string; files: string[] }
// A single AI finding with supporting evidence (file paths).
export interface SourceFact { title: string; detail: string; evidence: string[] }
// Structured AI analysis of the project.
export interface ProjectAnalysis {
  // Summary, purpose, and fact lists for stack, capabilities, architecture.
  summary: string; purpose: string; stack: SourceFact[]; capabilities: SourceFact[]; architecture: SourceFact[];
  // Prioritized recommendations plus honest limitations.
  recommendations: (SourceFact & { priority: 'high' | 'medium' | 'low' })[]; limitations: string[];
}
// A saved AI report (provider, model, the commit analyzed, and the analysis).
export interface AIReport {
  // Report metadata: ids, model, head SHA, analysis.
  id: string; provider: 'Groq'; model: string; head: string; analysis: ProjectAnalysis;
  // Source accounting: which files were read, which omitted, size, time, token usage.
  sourceFiles: string[]; omitted: string[]; sourceCharacters: number; createdAt: string; usage?: AIUsage; reused?: boolean;
}
// Token usage reported by the AI provider.
export interface AIUsage { inputTokens: number; outputTokens: number; cachedTokens: number }
// A generated plan stored server-side until it is published or expires.
export interface Plan { id: string; repo: Repo; head: string; files: GeneratedFile[]; commits: CommitGroup[]; createdAt: string; ai?: AIReport }
// Author details used when rewriting history.
export interface PublishHistory { authorName: string; authorEmail: string; from: string; to: string }
// Payload the browser sends to publish a plan.
export interface PublishInput {
  // Which plan, where to publish (existing branch, fork, or new repo), and branch name.
  planId: string; target: 'branch' | 'fork' | 'new'; branch: string;
  // Options for a new repo and for opening a pull request.
  name?: string; private?: boolean; createPr: boolean; splitBranches?: boolean;
  // Final file contents and commit messages (user may have edited them).
  files: { path: string; content: string }[]; messages: string[];
  // Optional history-rewrite settings.
  history?: PublishHistory;
}
// One published branch with its URL and optional pull request info.
export interface PublishedBranch { name: string; url: string; prUrl?: string; prError?: string }
// Overall publish outcome returned to the UI.
export interface PublishResult { url: string; repoUrl: string; branch: string; branches?: PublishedBranch[]; commits: number; files: number; prUrl?: string; prUrls?: string[]; prError?: string }
