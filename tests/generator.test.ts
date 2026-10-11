// Node's built-in test runner.
import { test } from 'node:test';
// Strict assertions.
import assert from 'node:assert/strict';
// Functions under test.
import { ciAvailable, generateFiles, health } from '../shared/generator';
// Fixtures.
import { fixtureContext, fixtureRepos } from './fixtures/projects';

// README uses real scripts and an honest license note.
test('README uses observed scripts and keeps missing license information accurate', () => {
  // Use the "folio" fixture.
  const context = fixtureContext(fixtureRepos[1]);
  // Generate README, docs, and contributing files.
  const output = generateFiles(context, ['readme', 'docs', 'contributing']);
  // Find the README.
  const readme = output.files.find(f => f.path === 'README.md')!;
  // Uses npm ci (a lockfile exists).
  assert.match(readme.content, /npm ci/);
  // Lists the dev script.
  assert.match(readme.content, /npm run dev/);
  // Reports the missing license.
  assert.match(readme.content, /No license file was detected/);
  // Links to the setup doc.
  assert.match(readme.content, /docs\/SETUP.md/);
  // Four files are generated.
  assert.equal(output.files.length, 4);
  // Three commit groups.
  assert.equal(output.commits.length, 3);
});
// Python projects get no Node commands or CI.
test('Python repositories do not receive invented Node commands or CI', () => {
  // Use the Python fixture.
  const context = fixtureContext(fixtureRepos[2]);
  // CI is unavailable.
  assert.equal(ciAvailable(context), false);
  // Ask for README and CI.
  const output = generateFiles(context, ['readme', 'ci']);
  // Only the README is generated.
  assert.equal(output.files.length, 1);
  // No npm commands.
  assert.doesNotMatch(output.files[0].content, /npm run/);
  // Mentions Python.
  assert.match(output.files[0].content, /Python/);
});
// Changelog keeps real commit subjects and dates.
test('changelog preserves actual commit subjects and source dates', () => {
  // Use the first fixture.
  const context = fixtureContext(fixtureRepos[0]);
  // Generate the changelog.
  const output = generateFiles(context, ['changelog']);
  // For every commit:
  for (const commit of context.commits) {
    // The message appears.
    assert.ok(output.files[0].content.includes(commit.message));
    // The date appears.
    assert.ok(output.files[0].content.includes(commit.date.slice(0, 10)));
  }
});
// Each generated file belongs to exactly one commit group.
test('every generated file is included in exactly one meaningful commit group', () => {
  // Generate everything (with a duplicate module).
  const output = generateFiles(fixtureContext(fixtureRepos[0]), ['readme', 'docs', 'contributing', 'changelog', 'templates', 'editorconfig', 'ci', 'readme']);
  // All files across commit groups.
  const committed = output.commits.flatMap(c => c.files);
  // No file appears twice.
  assert.equal(new Set(committed).size, committed.length);
  // The committed files equal the generated files.
  assert.deepEqual([...committed].sort(), output.files.map(f => f.path).sort());
  // Every message uses a conventional prefix.
  assert.ok(output.commits.every(c => /^(docs|chore|ci): /.test(c.message)));
});
// The health check measures only the presence of files.
test('health check measures presence rather than invented repository activity', () => {
  // Use the first fixture.
  const context = fixtureContext(fixtureRepos[0]);
  // Compute the health result.
  const result = health(context);
  // Exactly one check passes.
  assert.equal(result.checks.filter(c => c.ok).length, 1);
  // Score is 17 percent.
  assert.equal(result.score, 17);
});

// pnpm or Yarn lockfiles disable npm CI.
test('mixed lockfiles do not generate npm CI for a pnpm or Yarn project', () => {
  // Use the first fixture.
  const context = fixtureContext(fixtureRepos[0]);
  // For each lockfile type:
  for (const lock of ['pnpm-lock.yaml', 'yarn.lock']) {
    // Add the lockfile alongside package-lock.json.
    const mixed = { ...context, paths: [...context.paths, lock, 'package-lock.json'] };
    // CI is not available.
    assert.equal(ciAvailable(mixed), false);
    // No CI file is generated.
    assert.equal(generateFiles(mixed, ['ci']).files.length, 0);
  }
});

// README generation keeps the README filename casing and omits empty link sections.
test('README generation preserves existing Markdown filename casing and omits empty link sections', () => {
  // Use a lowercase readme.md path.
  const context = { ...fixtureContext(fixtureRepos[0]), readmePath: 'readme.md' };
  // Generate the README.
  const output = generateFiles(context, ['readme']);
  // The path is unchanged.
  assert.equal(output.files[0].path, 'readme.md');
  // No Documentation section.
  assert.doesNotMatch(output.files[0].content, /## Documentation/);
  // The structure lists src/.
  assert.match(output.files[0].content, /src\//);
});

// Setup text states the Node requirement and uses npm shorthand.
test('setup text states the declared Node requirement and uses npm shorthand for test and start', () => {
  // Base fixture.
  const base = fixtureContext(fixtureRepos[0]);
  // Add an engines field and scripts.
  const context = { ...base, manifest: { ...base.manifest!, engines: { node: '>=22.13.0' }, scripts: { start: 'node .', test: 'vitest run', build: 'tsc' } } };
  // Generate the README text.
  const readme = generateFiles(context, ['readme']).files[0].content;
  // States the Node requirement.
  assert.match(readme, /You need Node\.js `>=22\.13\.0` and `npm`\./);
  // Uses npm test.
  assert.match(readme, /\| `npm test` \|/);
  // Uses npm start.
  assert.match(readme, /\| `npm start` \|/);
  // Uses npm run build.
  assert.match(readme, /\| `npm run build` \|/);
});
// Non-Node projects get honest setup text.
test('non-Node projects get honest, actionable setup text and no placeholder wording', () => {
  // Generate for a Python fixture.
  const python = generateFiles(fixtureContext(fixtureRepos[2]), ['readme', 'docs']);
  // Find the README.
  const readme = python.files.find(f => f.path === 'README.md')!.content;
  // Mentions pip install.
  assert.match(readme, /pip install -r requirements\.txt/);
  // No npm mentions.
  assert.doesNotMatch(readme, /npm/);
  // A bare project with no description and a single file.
  const bare = generateFiles({ ...fixtureContext({ ...fixtureRepos[2], description: null }), paths: ['main.py'] }, ['readme', 'docs']);
  // Combine all file contents.
  const text = bare.files.map(f => f.content).join('\n');
  // Reports the missing description.
  assert.match(text, /No description is set for this repository yet\./);
  // Reports the missing manifest.
  assert.match(text, /No package manifest was detected/);
  // No placeholder wording.
  assert.doesNotMatch(text, /Add a concise description|Document the responsibility/);
});
// Commit subjects are conventional, specific, and short.
test('commit subjects are conventional, specific, and short', () => {
  // Generate every module.
  const { commits } = generateFiles(fixtureContext(fixtureRepos[0]), ['readme', 'docs', 'contributing', 'changelog', 'templates', 'editorconfig', 'ci']);
  // Each message has a valid prefix and is at most 72 characters.
  for (const { message } of commits) assert.ok(/^(docs|chore|ci): [a-z]/.test(message) && message.length <= 72, message);
  // All messages are unique.
  assert.equal(new Set(commits.map(c => c.message)).size, commits.length);
});
