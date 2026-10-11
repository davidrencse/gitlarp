// Import the shared type definitions used by the generator.
import type { CommitGroup, GeneratedFile, Module, ModuleId, ProjectContext } from './types';

// Catalog of documentation modules the user can pick; each lists the files it would create.
export const modules: Module[] = [
  // README module: rewrites the project README.
  { id: 'readme', title: 'Project README', description: 'A clear introduction, setup guide, and useful project links.', files: ['README.md'] },
  // Docs module: setup guide plus architecture overview.
  { id: 'docs', title: 'Project documentation', description: 'Document the actual structure and available commands.', files: ['docs/SETUP.md', 'docs/ARCHITECTURE.md'] },
  // Contributing module: CONTRIBUTING.md.
  { id: 'contributing', title: 'Contributor guide', description: 'Make it easy for someone else to get involved.', files: ['CONTRIBUTING.md'] },
  // Changelog module: built from the real recent commits.
  { id: 'changelog', title: 'Changelog', description: 'A readable record of your real recent commits.', files: ['docs/CHANGELOG.md'] },
  // Templates module: issue and pull request templates.
  { id: 'templates', title: 'Issue & PR templates', description: 'Thoughtful bug reports, feature requests, and pull requests.', files: ['.github/ISSUE_TEMPLATE/bug_report.md', '.github/ISSUE_TEMPLATE/feature_request.md', '.github/pull_request_template.md'] },
  // Editorconfig module: consistent whitespace settings.
  { id: 'editorconfig', title: 'Editor configuration', description: 'Consistent whitespace across editors and contributors.', files: ['.editorconfig'] },
  // CI module: GitHub Actions workflow (only offered when checks exist).
  { id: 'ci', title: 'Continuous integration', description: 'Run existing test and build commands on GitHub Actions.', files: ['.github/workflows/ci.yml'] },
];

// Wrap text in a Markdown code fence (default language: bash).
const fence = (text: string, language = 'bash') => `\`\`\`${language}\n${text}\n\`\`\``;
// Strip characters that could break Markdown links/HTML from untrusted text.
const escapeMarkdown = (value: string) => value.replace(/[\[\]<>]/g, '');
// Detect the project's package manager from lockfiles; returns install and run commands.
export function packageManager(ctx: ProjectContext) {
  // pnpm lockfile found -> use pnpm with a frozen lockfile.
  if (ctx.paths.includes('pnpm-lock.yaml')) return { name: 'pnpm', install: 'pnpm install --frozen-lockfile', run: 'pnpm run' };
  // yarn lockfile found -> use yarn.
  if (ctx.paths.includes('yarn.lock')) return { name: 'yarn', install: 'yarn install', run: 'yarn' };
  // Default to npm; use reproducible `npm ci` only when package-lock.json exists.
  return { name: 'npm', install: ctx.paths.includes('package-lock.json') ? 'npm ci' : 'npm install', run: 'npm run' };
}
// Decide whether a CI workflow can safely be generated for this project.
export function ciAvailable(ctx: ProjectContext) {
  // npm lockfiles make an automated install reproducible. Other package managers
  // need version information, so those projects receive documentation only.
  // CI requires npm + lockfile + at least one test/build/lint/check script.
  return packageManager(ctx).name === 'npm' && ctx.paths.includes('package-lock.json') && !!ctx.manifest?.scripts && ['test', 'build', 'lint', 'check'].some(s => ctx.manifest?.scripts?.[s]);
}
// Compute a documentation "health" score from a list of present/missing files.
export function health(ctx: ProjectContext) {
  // Each check is one documentation artifact and whether the repo already has it.
  const checks = [
    // README exists and is more than 200 characters.
    { label: 'README', ok: !!ctx.readme && ctx.readme.length > 200 },
    // Some Markdown file exists under docs/.
    { label: 'Documentation', ok: ctx.paths.some(p => /^docs\/.+\.md$/i.test(p)) },
    // A CONTRIBUTING.md exists (case-insensitive).
    { label: 'Contributor guide', ok: ctx.paths.some(p => /^contributing\.md$/i.test(p)) },
    // At least one issue template exists.
    { label: 'Issue templates', ok: ctx.paths.some(p => p.startsWith('.github/ISSUE_TEMPLATE/')) },
    // An .editorconfig exists.
    { label: 'Editor config', ok: ctx.paths.includes('.editorconfig') },
    // At least one GitHub Actions workflow exists.
    { label: 'CI workflow', ok: ctx.paths.some(p => p.startsWith('.github/workflows/')) },
  ];
  // Score = percentage of checks that pass, rounded.
  return { checks, score: Math.round(checks.filter(c => c.ok).length / checks.length * 100) };
}

// Main entry: build the files and commit groups for the selected modules.
export function generateFiles(ctx: ProjectContext, selected: ModuleId[]): { files: GeneratedFile[]; commits: CommitGroup[] } {
  // Pull the repo metadata, parsed package.json, and file path list from the context.
  const { repo, manifest, paths } = ctx;
  // Detect the package manager.
  const pm = packageManager(ctx);
  // List the package.json scripts as [name, command] pairs.
  const scripts = Object.entries(manifest?.scripts ?? {});
  // Format how to invoke a script (npm test / npm start are shortened).
  const runCommand = (name: string) => pm.name === 'npm' && ['test', 'start'].includes(name) ? `npm ${name}` : `${pm.run} ${name}`;
  // Markdown table rows of the available commands (or a fallback sentence).
  const commands = scripts.length ? scripts.map(([name, command]) => `| \`${runCommand(name)}\` | \`${command.replace(/\|/g, '\\|')}\` |`).join('\n') : 'No package scripts were found. Review the source for its entry point and runtime requirements.';
  // Human-readable Node.js version requirement from package.json engines.
  const nodeRequirement = manifest?.engines?.node ? `Node.js \`${manifest.engines.node.replace(/`/g, '')}\`` : 'Node.js';
  // Setup text used when there is no package.json: Python or unknown.
  const fallbackSetup = paths.includes('requirements.txt')
    // Python project with requirements.txt.
    ? `This is a ${repo.language || 'Python'} project with a \`requirements.txt\`. Install the dependencies in a virtual environment:\n\n${fence('python -m venv .venv\npython -m pip install -r requirements.txt')}\n\nNo run or test commands were detected, so check the source for the entry point.`
    // Unknown project type.
    : `This project is written mainly in ${repo.language || 'an unspecified language'}. No package manifest was detected, so its dependencies and run commands could not be determined automatically. Check the source for build and run instructions.`;
  // Final setup section: install command and command table, or the fallback.
  const setup = manifest ? `You need ${nodeRequirement} and \`${pm.name}\`.\n\n${fence(pm.install)}\n\n### Available commands\n\n| Command | What it runs |\n| --- | --- |\n${commands}` : fallbackSetup;
  // Map of top-level entries -> whether each is a directory.
  const roots = new Map<string, boolean>();
  // Walk every file path in the repo.
  for (const path of paths) {
    // Ignore git internals.
    if (path.startsWith('.git/')) continue;
    // Find the first slash to separate the top-level name.
    const slash = path.indexOf('/');
    // Top-level name is the whole path (a file) or the part before the slash.
    const root = slash === -1 ? path : path.slice(0, slash);
    // Mark as a directory if any path beneath it contains a slash.
    roots.set(root, roots.get(root) || slash !== -1);
  }
  // Render up to 40 sorted top-level entries as a text tree.
  const structure = fence([...roots.keys()].sort().slice(0, 40).map(p => `${p}${roots.get(p) ? '/' : ''}`).join('\n'), 'text');
  // Markdown links to the repo and its issue tracker.
  const links = `[Report a bug](${repo.html_url}/issues) · [Repository](${repo.html_url})`;
  // Links to generated docs, depending on which modules were selected.
  const documentLinks = [
    // Link setup and architecture docs when the docs module is selected.
    ...(selected.includes('docs') ? ['- [Setup guide](docs/SETUP.md)', '- [Architecture overview](docs/ARCHITECTURE.md)'] : []),
    // Link CONTRIBUTING when selected.
    ...(selected.includes('contributing') ? ['- [Contributing](CONTRIBUTING.md)'] : []),
    // Link the changelog when selected.
    ...(selected.includes('changelog') ? ['- [Changelog](docs/CHANGELOG.md)'] : []),
  ];
  // README "Documentation" section (empty when no docs are linked).
  const documentation = documentLinks.length ? `## Documentation\n\n${documentLinks.join('\n')}\n\n` : '';
  // File contents per module, keyed by module id then file path.
  const templates: Partial<Record<ModuleId, Record<string, string>>> = {
    // README content: title, description, links, getting started, structure, license note.
    readme: { [ctx.readmePath || 'README.md']: `# ${repo.name}\n\n${escapeMarkdown(repo.description || 'No description is set for this repository yet.') }\n\n${links}\n\n## Getting started\n\n${fence(`git clone ${repo.html_url}.git\ncd ${repo.name}`)}\n\n${setup}\n\n## Project structure\n\n${structure}\n\n${documentation}## License\n\n${paths.some(p => /^license(?:\.|$)/i.test(p)) ? 'See the license file in this repository for the applicable terms.' : 'No license file was detected. Contact the repository owner about permissions before using or distributing the source.'}\n` },
    // Docs module group.
    docs: {
      // docs/SETUP.md: clone, install/run, environment variables, troubleshooting.
      'docs/SETUP.md': `# Setup guide\n\n## Clone the repository\n\n${fence(`git clone ${repo.html_url}.git\ncd ${repo.name}`)}\n\n## Install and run\n\n${setup}\n\n## Environment variables\n\n${paths.some(p => /^\.env\.(example|sample|template)$/.test(p)) ? 'Copy the example environment file to your local environment file and provide the required values. Keep local secrets out of Git.' : 'No example environment file was detected. Check the source for required environment variables; do not commit secrets.'}\n\n## Troubleshooting\n\n- Confirm that dependencies installed successfully.\n- Check that your runtime matches the project requirements.\n- Include the failing command, error output, and runtime version when opening an issue.\n`,
      // docs/ARCHITECTURE.md: structure, technology, and honesty note about generated content.
      'docs/ARCHITECTURE.md': `# Architecture overview\n\n${escapeMarkdown(repo.description || 'This overview describes the files observed in the repository.')}\n\n## Repository structure\n\n${structure}\n\n## Technology\n\n- Primary language reported by GitHub: ${repo.language || 'Not specified'}\n${manifest?.dependencies ? `- Declared dependencies: ${Object.keys(manifest.dependencies).sort().map(d => `\`${d}\``).join(', ') || 'None'}\n` : ''}\n## Design decisions\n\nThis inventory lists files and directories only; it does not describe how the parts interact. Add a short note on each major module's responsibility and how data flows between them.\n\n## Keeping this guide accurate\n\nUpdate this document alongside structural changes. This inventory was generated from branch \`${repo.default_branch}\` at commit \`${ctx.head.slice(0, 7)}\`.${ctx.truncated ? ' GitHub returned a truncated tree; this inventory may be incomplete.' : ''}\n`,
    },
    // CONTRIBUTING.md content.
    contributing: { 'CONTRIBUTING.md': `# Contributing to ${repo.name}\n\nThanks for your interest in contributing. Bug reports, fixes, and documentation improvements are all welcome.\n\n## Before you start\n\nCheck existing issues and pull requests. For a larger change, open an issue to discuss the approach with the maintainers.\n\n## Development\n\n1. Fork the repository and clone your fork.\n2. Create a focused branch: \`git checkout -b feat/your-change\`.\n3. Install dependencies and run the project using the available commands below.\n\n${setup}\n\n## Pull requests\n\n- Keep each pull request focused on one change.\n- Explain what changed and why.\n- Update documentation when behavior changes.\n- Run the relevant existing checks and report the results.\n- Add a regression test when fixing behavior that can be tested.\n\n## Commit messages\n\nUse a short, descriptive subject with a type such as \`feat:\`, \`fix:\`, \`docs:\`, or \`chore:\`. Commit real, cohesive changes; preserve the existing project history.\n\n## Reporting bugs\n\nInclude reproduction steps, expected and actual behavior, and relevant logs. Remove tokens, passwords, and personal information from logs before sharing them.\n` },
    // docs/CHANGELOG.md listing recent commits with dates and short SHAs.
    changelog: { 'docs/CHANGELOG.md': `# Recent changes\n\nThe latest ${ctx.commits.length} commit${ctx.commits.length === 1 ? '' : 's'} on \`${repo.default_branch}\`, newest first, with each message and date taken directly from the git history.\n\n${ctx.commits.length ? ctx.commits.map(c => `- **${c.date.slice(0, 10)}** ${escapeMarkdown(c.message.split('\n')[0])} ([\`${c.sha.slice(0, 7)}\`](${repo.html_url}/commit/${c.sha}))`).join('\n') : 'No commits were found.'}\n` },
    // Templates module group.
    templates: {
      // Bug report issue template.
      '.github/ISSUE_TEMPLATE/bug_report.md': '---\nname: Bug report\nabout: Report a reproducible problem\ntitle: ""\nlabels: ""\nassignees: ""\n---\n\n## What happened?\n\nDescribe the actual behavior.\n\n## Expected behavior\n\nWhat should have happened?\n\n## Steps to reproduce\n\n1.\n2.\n3.\n\n## Environment\n\n- Operating system:\n- Runtime / browser version:\n- Project version / commit:\n\n## Logs or screenshots\n\nRemove any secrets before sharing.\n',
      // Feature request issue template.
      '.github/ISSUE_TEMPLATE/feature_request.md': '---\nname: Feature request\nabout: Suggest an improvement\ntitle: ""\nlabels: ""\nassignees: ""\n---\n\n## Problem\n\nWhat problem would this solve, and for whom?\n\n## Proposed solution\n\nDescribe your idea and the expected behavior.\n\n## Alternatives\n\nWhat other approaches have you considered?\n',
      // Pull request template.
      '.github/pull_request_template.md': '## What changed?\n\nDescribe the change and why it is needed.\n\n## Related issue\n\nCloses #\n\n## Validation\n\nDescribe the checks you ran and the results.\n\n## Checklist\n\n- [ ] The change is focused and ready for review.\n- [ ] Relevant checks pass.\n- [ ] Documentation is updated where needed.\n- [ ] No secrets or generated local artifacts are included.\n',
    },
    // .editorconfig content.
    editorconfig: { '.editorconfig': 'root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\ninsert_final_newline = true\ntrim_trailing_whitespace = true\nindent_style = space\nindent_size = 2\n\n[*.md]\ntrim_trailing_whitespace = false\n' },
  };
  // Only add a CI workflow when ciAvailable() says it is safe.
  if (ciAvailable(ctx)) {
    // Pick the Node version source: .nvmrc, .node-version, engines.node, or LTS.
    const nodeVersion = paths.includes('.nvmrc') ? 'node-version-file: .nvmrc' : paths.includes('.node-version') ? 'node-version-file: .node-version' : `node-version: ${JSON.stringify(manifest?.engines?.node || 'lts/*')}`;
    // Workflow pinned to commit SHAs with read-only permissions; runs lint/check/test/build.
    templates.ci = { '.github/workflows/ci.yml': `name: Project checks\n\non:\n  push:\n  pull_request:\n\npermissions:\n  contents: read\n\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    timeout-minutes: 15\n    steps:\n      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6\n        with:\n          persist-credentials: false\n      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7\n        with:\n          ${nodeVersion}\n          cache: npm\n      - run: npm ci\n${['lint', 'check', 'test', 'build'].filter(s => manifest?.scripts?.[s]).map(s => `      - run: npm run ${s}`).join('\n')}\n` };
  }
  // Output list of files to write.
  const files: GeneratedFile[] = [];
  // Output list of commit groups (one commit per module).
  const commits: CommitGroup[] = [];
  // Commit message used for each module.
  const messages: Record<ModuleId, string> = { readme: 'docs: rewrite README with setup steps and project structure', docs: 'docs: add setup guide and architecture overview', contributing: 'docs: add CONTRIBUTING guide', changelog: 'docs: add changelog of recent commits', templates: 'chore: add bug report, feature request and PR templates', editorconfig: 'chore: add .editorconfig', ci: 'ci: add GitHub Actions workflow for project checks' };
  // Process each selected module once (deduplicated).
  for (const id of [...new Set(selected)]) {
    // Files this module produces.
    const entries = Object.entries(templates[id] ?? {});
    // Skip modules that produce nothing.
    if (!entries.length) continue;
    // Add each file; keep the original README text so the UI can show a diff.
    for (const [path, content] of entries) files.push({ path, content, original: path === 'README.md' ? ctx.readme : null, module: id });
    // Record one commit covering this module's files.
    commits.push({ message: messages[id], files: entries.map(([path]) => path) });
  }
  // Return the generated files and commit plan.
  return { files, commits };
}
