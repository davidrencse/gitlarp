// Shared types.
import type { ProjectContext, Repo } from '../../shared/types';

// Descriptions for six fake repositories.
const descriptions = [
  // orbit-ui.
  'A thoughtfully crafted component library for building interfaces that feel a little more human.',
  // folio.
  'A minimal portfolio starter for developers. Your work, front and center.',
  // pulse-api.
  'A lightweight REST API for tracking habits, building streaks, and finding your rhythm.',
  // devnotes.
  'Your second brain for code snippets, quick notes, and things you’ll definitely forget.',
  // tiny-auth.
  'Simple authentication for your next side project. Small footprint, sensible defaults.',
  // palette.
  'Find the right colors for whatever you’re making. A playground for palettes.',
];
// Repository names.
const names = ['orbit-ui', 'folio', 'pulse-api', 'devnotes', 'tiny-auth', 'palette'];
// Build the fake repositories from names, with realistic metadata.
export const fixtureRepos: Repo[] = names.map((name, index) => ({
  // Id, name, full name, and description.
  id: index + 1, name, full_name: `alexmorgan/${name}`, description: descriptions[index],
  // Private flag and language per repository.
  private: index === 3 || index === 4, language: ['TypeScript', 'TypeScript', 'Python', 'JavaScript', 'TypeScript', 'JavaScript'][index],
  // Star and fork counts.
  stargazers_count: [128, 42, 16, 0, 8, 24][index], forks_count: [12, 6, 2, 0, 1, 4][index],
  // Push and update times, in the recent past.
  pushed_at: new Date(Date.now() - (index + 1) * 86400000).toISOString(), updated_at: new Date(Date.now() - (index + 1) * 86400000).toISOString(),
  // Owner, default branch, and URL.
  owner: { login: 'alexmorgan' }, default_branch: 'main', html_url: `https://github.com/alexmorgan/${name}`,
  // Write access and topics.
  permissions: { push: true, admin: true }, topics: index === 0 ? ['react', 'components', 'design-system'] : [],
}));

// Build a fake project context for a repository.
export function fixtureContext(repo: Repo): ProjectContext {
  // Repository 2 (folio) is the one with rich existing documentation.
  const rich = repo.id === 2;
  // Python projects have no package scripts; others have dev, build, test, and lint.
  const scripts = repo.language === 'Python' ? undefined : { dev: 'vite', build: 'tsc && vite build', test: 'vitest run', lint: 'eslint .' };
  // Return the context.
  return {
    // Repository and HEAD commit.
    repo, head: '2e7ac8d127a9e1d624e3971b7b8287bdd2bb93e1',
    // File paths (Node or Python files, plus docs and CI for the rich repo).
    paths: ['README.md', 'src/index.ts', 'src/components/Button.tsx', 'src/styles.css', '.gitignore', ...(scripts ? ['package.json', 'package-lock.json', 'tsconfig.json'] : ['requirements.txt', 'app/main.py']), ...(rich ? ['docs/SETUP.md', 'CONTRIBUTING.md', '.editorconfig', '.github/workflows/ci.yml'] : []), ...(repo.id === 1 ? ['LICENSE', 'docs/components.md'] : [])],
    // README text: a longer one for the rich repo.
    readme: rich ? `# ${repo.name}\n\n${repo.description}\n\n## Getting started\n\nClone the repository, install dependencies with npm install, and run npm run dev.\n\n## Contributing\n\nSee CONTRIBUTING.md for the development workflow and docs/SETUP.md for additional setup details.\n` : `# ${repo.name}\n\n${repo.description}\n`,
    // Manifest (package.json) for Node projects, null for Python.
    manifest: scripts ? { name: repo.name, scripts, dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' }, devDependencies: { vite: '^7.0.0', typescript: '^5.9.0', vitest: '^3.0.0' } } : null,
    // Three recent commits.
    commits: [
      // First commit.
      { sha: '2e7ac8d127a9e1d624e3971b7b8287bdd2bb93e1', message: 'feat: add keyboard navigation', date: new Date(Date.now() - 86400000).toISOString(), author: 'Alex Morgan' },
      // Second commit.
      { sha: '4a8fd3c127a9e1d624e3971b7b8287bdd2bb93e1', message: 'fix: handle empty search results', date: new Date(Date.now() - 3 * 86400000).toISOString(), author: 'Alex Morgan' },
      // Third commit.
      { sha: '6bc12ec127a9e1d624e3971b7b8287bdd2bb93e1', message: 'feat: create initial project structure', date: new Date(Date.now() - 5 * 86400000).toISOString(), author: 'Alex Morgan' },
    ],
  };
}
// Color names for project cards.
export const projectColors = ['violet', 'mint', 'orange', 'blue', 'rose', 'yellow'];
