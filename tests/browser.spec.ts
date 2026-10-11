// Playwright test runner and assertions.
import { test, expect } from '@playwright/test';
// Page type.
import type { Page } from '@playwright/test';
// File reading (for downloaded ZIPs).
import { readFile } from 'node:fs/promises';
// ZIP reader.
import JSZip from 'jszip';
// Fixtures.
import { fixtureContext, fixtureRepos } from './fixtures/projects';
// File generator.
import { generateFiles } from '../shared/generator';
// Shared types.
import type { ModuleId, Plan } from '../shared/types';
// Sample AI report.
import { report as aiReport } from './fixtures/intelligence';

// Fake GitHub profile.
const profile = { login: 'alexmorgan', name: 'Alex Morgan', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4', id: 100 };
// Fake token used to check that it is never stored in the browser.
const secret = 'github_pat_browser_test_secret_never_store';
// Mock every API route so the tests do not need a real server or GitHub.
async function mockGitHub(page: Page, connected = true, publishError = false) {
  // Mock state: signed-in flag, current plan, and created repository name.
  let loggedIn = connected; let plan: Plan; let createdName = '';
  // Fake repositories.
  const repositories = [...fixtureRepos];
  // Session endpoint.
  await page.route('**/api/session', route => route.fulfill({ json: { user: loggedIn ? profile : null, configured: false, csrf: 'browser-csrf' } }));
  // Token connection endpoint.
  await page.route('**/api/connect', async route => {
    // Check the token and sign in.
    expect(route.request().postDataJSON().token).toBe(secret); loggedIn = true;
    // Return the profile and a new CSRF token.
    await route.fulfill({ json: { user: profile, csrf: 'connected-csrf' } });
  });
  // Logout endpoint.
  await page.route('**/api/logout', async route => { loggedIn = false; await route.fulfill({ json: { ok: true } }); });
  // Repository list endpoint.
  await page.route('**/api/repos?*', route => route.fulfill({ json: { repos: repositories, hasMore: false } }));
  // Project details endpoint.
  await page.route('**/api/projects/**', route => {
    // Find the repository by name.
    const name = route.request().url().split('/').pop(); const repo = repositories.find(item => item.name === name)!;
    // Return its context.
    return route.fulfill({ json: fixtureContext(repo) });
  });
  // Plan generation endpoint.
  await page.route('**/api/plans', async route => {
    // Read the request.
    const input = route.request().postDataJSON() as { repo: string; modules: ModuleId[] };
    // Find the repo and its context.
    const repo = repositories.find(item => item.name === input.repo)!; const context = fixtureContext(repo);
    // Build a plan with the real generator.
    plan = { id: '126a27da-25e1-4499-8cbe-a679201af81b', repo, head: context.head, createdAt: new Date().toISOString(), ...generateFiles(context, input.modules) };
    // Return the plan.
    await route.fulfill({ json: plan });
  });
  // Publish endpoint.
  await page.route('**/api/publish', async route => {
    // Check the plan id.
    const input = route.request().postDataJSON(); expect(input.planId).toBe(plan.id);
    // In error mode, return a 409 conflict.
    if (publishError) { await route.fulfill({ status: 409, json: { error: 'That branch already exists. Choose a new branch name.' } }); return; }
    // Otherwise return a success with a pull request URL.
    await route.fulfill({ json: { url: `${plan.repo.html_url}/tree/${input.branch}`, repoUrl: plan.repo.html_url, branch: input.branch, files: input.files.length, commits: input.messages.length, prUrl: `${plan.repo.html_url}/pull/10` } });
  });
  // Repository creation endpoint.
  await page.route('**/api/repositories', async route => {
    // Read the request.
    const input = route.request().postDataJSON(); createdName = input.name;
    // Create a fake repository.
    const repo = { ...fixtureRepos[0], ...input, name: input.name, full_name: `${profile.login}/${input.name}`, id: 999, stargazers_count: 0, forks_count: 0, html_url: `https://github.com/${profile.login}/${input.name}` };
    // Add it and return it with 201.
    repositories.push(repo); await route.fulfill({ status: 201, json: repo });
  });
  // Let the test read the created name.
  return { createdName: () => createdName };
}
// Wait for fonts to load so layout is stable.
async function settle(page: Page) { await page.evaluate(() => document.fonts.ready); }

// Test: analysis, Q&A, token usage, and AI previews on desktop and mobile.
test('source-aware analysis, Q&A, token usage and AI previews work on desktop and mobile', async ({ page }) => {
  // Collect page errors.
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  // Reduce motion and install the mocks.
  await page.emulateMedia({ reducedMotion: 'reduce' }); await mockGitHub(page);
  // Override the session: AI is configured.
  await page.route('**/api/session', route => route.fulfill({ json: { user: profile, configured: false, csrf: 'browser-csrf', ai: { configured: true, model: 'openai/gpt-oss-120b' } } }));
  // Count the analyses.
  let analyses = 0;
  // Analyze endpoint: check the instructions and return the report.
  await page.route('**/api/ai/analyze', route => { analyses++; expect(route.request().postDataJSON().instructions).toMatch(/technical depth.*presentation/); return route.fulfill({ json: { ...aiReport, reused: analyses > 1 } }); });
  // Ask endpoint: check the analysis id and return an answer.
  await page.route('**/api/ai/ask', route => { expect(route.request().postDataJSON().analysisId).toBe(aiReport.id); return route.fulfill({ json: { answer: 'The entry file exports **Button**, whose wrapper forwards native button props. Test execution is unverified.', sources: ['src/index.ts'], followUps: ['How can I use disabled buttons?'], model: 'llama-3.1-8b-instant', usage: { inputTokens: 700, outputTokens: 200, cachedTokens: 500 } } }); });
  // Plan endpoint with AI.
  await page.route('**/api/plans', route => {
    // Check the AI flag and analysis id.
    const input = route.request().postDataJSON(); expect(input.ai).toBe(true); expect(input.analysisId).toBe(aiReport.id);
    // Generate and customize the README.
    const context = fixtureContext(fixtureRepos[0]); const generated = generateFiles(context, input.modules);
    // Use the AI-style README text.
    generated.files[0].content = '# Orbit component library\n\nImport Button from the public entry. The native wrapper preserves disabled and keyboard behavior.\n\n## Setup\n\nUse npm ci followed by npm run dev. Test results are unverified.';
    // Return the plan with the AI report.
    return route.fulfill({ json: { id: '126a27da-25e1-4499-8cbe-a679201af81b', repo: context.repo, head: context.head, createdAt: new Date().toISOString(), ...generated, ai: { ...aiReport, model: 'openai/gpt-oss-120b' } } });
  });
  // Open the app and the orbit-ui project.
  await page.goto('/'); await page.getByRole('button', { name: 'orbit-ui', exact: true }).click();
  // Run the analysis.
  await page.getByRole('button', { name: 'Analyze this project' }).click();
  // The summary appears.
  await expect(page.getByRole('heading', { name: 'What this project does' })).toBeVisible();
  // Token usage is shown.
  await expect(page.getByLabel('AI token usage')).toContainText('800 cached input');
  // Open the architecture tab.
  await page.getByRole('button', { name: 'Architecture & data flow', exact: true }).click();
  // A fact heading is visible.
  await expect(page.getByRole('heading', { name: 'Component exports' })).toBeVisible();
  // Source links point to the analyzed commit.
  await expect(page.locator('.intelligence-facts a').first()).toHaveAttribute('href', new RegExp(`/blob/${aiReport.head}/src/index.ts`));
  // Back to the overview.
  await page.getByRole('button', { name: 'Overview & capabilities', exact: true }).click();
  // Ask a question.
  await page.getByLabel('Question about this repository').fill('How is Button exported?'); await page.getByRole('button', { name: 'Ask Groq', exact: true }).click();
  // The answer and its usage appear.
  await expect(page.locator('.project-answer')).toContainText('wrapper forwards'); await expect(page.locator('.project-answer')).toContainText('500 cached input tokens');
  // Refresh the analysis.
  await page.getByRole('button', { name: 'Refresh project analysis' }).click();
  // A reuse note appears.
  await expect(page.getByText("Reused this snapshot's analysis. No new model call.")).toBeVisible();
  // Take a desktop screenshot.
  await settle(page); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: '.impeccable/review/ai-desktop.png', fullPage: true });
  // Switch to a phone viewport.
  await page.setViewportSize({ width: 390, height: 844 }); await settle(page);
  // There is no horizontal scroll.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Take a mobile screenshot.
  await page.screenshot({ path: '.impeccable/review/ai-mobile.png', fullPage: true });
  // Generate with AI.
  await page.getByRole('button', { name: 'Generate with Groq', exact: true }).click();
  // The AI README is shown.
  await expect(page.getByRole('heading', { name: 'Orbit component library', exact: true })).toBeVisible();
  // The AI panel collapses.
  await expect(page.locator('.project-intelligence.compact details').first()).not.toHaveAttribute('open', '');
  // Download the ZIP.
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  // The ZIP contains the AI README.
  const zip = await JSZip.loadAsync(await readFile((await (await download).path())!)); expect(await zip.file('README.md')!.async('string')).toContain('native wrapper');
  // No page errors.
  expect(errors).toEqual([]);
});

// Test: a Groq failure leaves the user connected and allows a retry.
test('a Groq failure leaves the account connected and allows retry without a bogus preview', async ({ page }) => {
  // Mock with AI configured.
  await mockGitHub(page); await page.route('**/api/session', route => route.fulfill({ json: { user: profile, configured: false, csrf: 'browser-csrf', ai: { configured: true, model: 'openai/gpt-oss-120b' } } }));
  // The plan endpoint fails.
  await page.route('**/api/plans', route => route.fulfill({ status: 502, json: { error: 'Groq returned an incomplete response. Try fewer improvements.' } }));
  // Open the project.
  await page.goto('/'); await page.getByRole('button', { name: 'orbit-ui', exact: true }).click();
  // Try to generate.
  await page.getByRole('button', { name: 'Generate with Groq', exact: true }).click();
  // The error is shown.
  await expect(page.getByRole('alert')).toContainText('Try fewer improvements');
  // No preview was created.
  await expect(page.getByRole('heading', { name: 'Make it yours before you ship.' })).toHaveCount(0);
  // The button is enabled again.
  await expect(page.getByRole('button', { name: 'Generate with Groq', exact: true })).toBeEnabled();
  // Turn off AI.
  await page.getByRole('checkbox', { name: 'Use Groq for generated documentation' }).uncheck();
  // The normal preview button is available.
  await expect(page.getByRole('button', { name: 'Generate preview', exact: true })).toBeEnabled();
});

// Test: deterministic-only selections skip the AI call.
test('deterministic-only selections skip the AI request even when Groq is enabled', async ({ page }) => {
  // Install the mocks.
  await mockGitHub(page);
  // AI is configured.
  await page.route('**/api/session', route => route.fulfill({ json: { user: profile, configured: false, csrf: 'browser-csrf', ai: { configured: true, model: 'openai/gpt-oss-120b' } } }));
  // Open the project.
  await page.goto('/'); await page.getByRole('button', { name: 'orbit-ui', exact: true }).click();
  // Deselect the four default modules.
  for (const name of ['Project README', 'Project documentation', 'Contributor guide', 'Issue & PR templates']) await page.locator('.module-row').filter({ hasText: name }).click();
  // Select the changelog and editor-config modules (neither uses AI).
  for (const name of ['Changelog', 'Editor configuration']) await page.locator('.module-row').filter({ hasText: name }).click();
  // The AI checkbox stays checked.
  await expect(page.getByRole('checkbox', { name: 'Use Groq for generated documentation' })).toBeChecked();
  // Wait for the plan request and generate.
  const preview = page.waitForRequest('**/api/plans'); await page.getByRole('button', { name: 'Generate preview', exact: true }).click();
  // The request does not use AI and has only those modules.
  const input = (await preview).postDataJSON(); expect(input.ai).toBe(false); expect(input.modules).toEqual(['changelog', 'editorconfig']);
  // A preview appears.
  await expect(page.getByRole('heading', { name: 'Make it yours before you ship.' })).toBeVisible();
});

// Test: signed-out view shows real connection options and no sample data.
test('signed-out view shows real connection options, WebGL, and no sample repositories', async ({ page }) => {
  // Collect page errors.
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  // Reduce motion, mock a signed-out user, and open the app.
  await page.emulateMedia({ reducedMotion: 'reduce' }); await mockGitHub(page, false); await page.goto('/');
  // The connection heading shows.
  await expect(page.getByRole('heading', { name: 'Connect your GitHub' })).toBeVisible();
  // OAuth is disabled when not configured.
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeDisabled();
  // No repository cards.
  await expect(page.locator('.repo-card')).toHaveCount(0);
  // No demo content.
  await expect(page.getByText(/demo|example projects|orbit-ui/i)).toHaveCount(0);
  // Token connect is disabled when empty.
  await expect(page.getByRole('button', { name: 'Connect with token' })).toBeDisabled();
  // Type a short token.
  await page.getByLabel('Fine-grained personal access token (recommended)', { exact: true }).fill('short');
  // Still disabled.
  await expect(page.getByRole('button', { name: 'Connect with token' })).toBeDisabled();
  // Clear it.
  await page.getByLabel('Fine-grained personal access token (recommended)', { exact: true }).fill(''); await page.locator('h1').click();
  // Wait for fonts.
  await settle(page);
  // Check that WebGL draws without errors.
  expect(await page.locator('.liquid-backdrop canvas').evaluate(canvas => {
    // Get the WebGL context.
    const gl = (canvas as HTMLCanvasElement).getContext('webgl');
    // A program is active and there are no GL errors.
    return !!gl && gl.getParameter(gl.CURRENT_PROGRAM) !== null && gl.getError() === gl.NO_ERROR;
  })).toBe(true);
  // Take a screenshot.
  await page.screenshot({ path: '.impeccable/review/desktop.png', fullPage: true });
  // No page errors.
  expect(errors).toEqual([]);
});

// Test: the project library filters and supports the list layout.
test('authenticated project library filters real API results and supports list layout', async ({ page }) => {
  // Reduce motion, mock, and open.
  await page.emulateMedia({ reducedMotion: 'reduce' }); await mockGitHub(page); await page.goto('/');
  // Six repositories appear.
  await expect(page.locator('.repo-card')).toHaveCount(6); await settle(page);
  // Take a screenshot.
  await page.screenshot({ path: '.impeccable/review/projects-desktop.png', fullPage: true });
  // Filter private repositories.
  await page.getByLabel('Filter repositories').selectOption('private'); await expect(page.locator('.repo-card')).toHaveCount(2);
  // Reset the filter.
  await page.getByLabel('Filter repositories').selectOption('all');
  // A search with no results shows an empty state.
  await page.getByLabel('Search projects').fill('no-such-repo'); await expect(page.getByRole('heading', { name: 'No projects found' })).toBeVisible();
  // Clear the filters.
  await page.getByRole('button', { name: 'Clear filters' }).click(); await expect(page.locator('.repo-card')).toHaveCount(6);
  // Switch to the list layout.
  await page.getByRole('button', { name: 'List view', exact: true }).click(); await expect(page.locator('.repo-grid')).toHaveClass(/list-layout/);
  // Ctrl+K focuses the search.
  await page.keyboard.press('Control+k'); await expect(page.getByLabel('Search projects')).toBeFocused();
});

// The repository grid should show page one while later pages are still loading.
test('repository results render progressively as GitHub pages arrive', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await mockGitHub(page);
  await page.unroute('**/api/repos?*');
  let releaseSecondPage!: () => void; let signalSecondPage!: () => void;
  const secondPageStarted = new Promise<void>(resolve => { signalSecondPage = resolve; });
  await page.route('**/api/repos?*', async route => {
    const pageNumber = new URL(route.request().url()).searchParams.get('page');
    if (pageNumber === '1') return route.fulfill({ json: { repos: [fixtureRepos[0]], hasMore: true } });
    signalSecondPage(); await new Promise<void>(resolve => { releaseSecondPage = resolve; });
    return route.fulfill({ json: { repos: [fixtureRepos[1]], hasMore: false } });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'orbit-ui', exact: true })).toBeVisible();
  await secondPageStarted;
  await expect(page.getByRole('status').filter({ hasText: 'Showing 1 repository' })).toBeVisible();
  releaseSecondPage();
  await expect(page.getByRole('button', { name: 'folio', exact: true })).toBeVisible();
  await expect(page.locator('.repo-card')).toHaveCount(2);
});

// Test: editing, ZIP download, and publishing use the reviewed payload.
test('editing, ZIP download, and publishing use the reviewed API payload', async ({ page }) => {
  // Collect page errors.
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  // Reduce motion, mock, and open.
  await page.emulateMedia({ reducedMotion: 'reduce' }); await mockGitHub(page); await page.goto('/');
  // Open a project and generate a preview.
  await page.getByRole('button', { name: 'orbit-ui', exact: true }).click(); await page.getByRole('button', { name: 'Generate preview' }).click();
  // The review screen appears.
  await expect(page.getByRole('heading', { name: 'Make it yours before you ship.' })).toBeVisible();
  // Open the source editor.
  await page.getByRole('button', { name: 'Edit source' }).click();
  // Replace the README text.
  const content = '# A reviewed Orbit\n\nEdited before publishing.\n'; await page.getByLabel('Edit README.md').fill(content);
  // Switch to preview; the new heading shows.
  await page.getByRole('button', { name: 'Preview', exact: true }).click(); await expect(page.getByRole('heading', { name: 'A reviewed Orbit' })).toBeVisible();
  // Edit a commit message.
  await page.getByLabel('Commit 1 message').fill('docs: explain the reviewed Orbit project');
  // Go to the Documentation page.
  await page.getByRole('button', { name: 'Documentation', exact: true }).click();
  // Go back to Projects.
  await page.getByRole('button', { name: 'Projects 6', exact: true }).click();
  // Reopen the project.
  await page.getByRole('button', { name: 'orbit-ui', exact: true }).click();
  // The edits were kept.
  await expect(page.getByRole('heading', { name: 'A reviewed Orbit' })).toBeVisible();
  // The commit message was kept.
  await expect(page.getByLabel('Commit 1 message')).toHaveValue('docs: explain the reviewed Orbit project');
  // Wait and scroll.
  await settle(page); await page.evaluate(() => window.scrollTo(0, 0));
  // Take a screenshot.
  await page.screenshot({ path: '.impeccable/review/workbench-desktop.png', fullPage: true });
  // Download the ZIP.
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  // The ZIP has the edited README.
  const zip = await JSZip.loadAsync(await readFile((await (await download).path())!)); expect(await zip.file('README.md')!.async('string')).toBe(content);
  // Continue to publish.
  await page.getByRole('button', { name: 'Continue to publish' }).click();
  // Publish and wait for the request.
  const publishing = page.waitForRequest('**/api/publish'); await page.getByRole('button', { name: 'Publish changes', exact: true }).click();
  // The payload has the edited file.
  const payload = (await publishing).postDataJSON(); expect(payload.files.find((file: { path: string }) => file.path === 'README.md').content).toBe(content);
  // And the edited message.
  expect(payload.messages[0]).toBe('docs: explain the reviewed Orbit project');
  // The success screen appears with a pull request link.
  await expect(page.getByRole('heading', { name: 'Changes published.' })).toBeVisible(); await expect(page.getByRole('link', { name: 'View draft pull request' })).toHaveAttribute('href', /github.com.*pull\/10/);
  // Activity shows one entry.
  await page.getByRole('button', { name: 'Activity', exact: true }).click(); await expect(page.locator('.activity-row')).toHaveCount(1);
  // Documentation shows the file.
  await page.getByRole('button', { name: 'Documentation', exact: true }).click(); await page.locator('.document-list button').first().click(); await expect(page.getByRole('heading', { name: 'A reviewed Orbit' })).toBeVisible();
  // No page errors.
  expect(errors).toEqual([]);
});

// Test: a publishing error creates no success result or activity.
test('a GitHub publishing error does not create a success result or activity', async ({ page }) => {
  // Mock the publish error.
  await mockGitHub(page, true, true); await page.goto('/');
  // Open the project and generate.
  await page.getByRole('button', { name: 'orbit-ui', exact: true }).click(); await page.getByRole('button', { name: 'Generate preview' }).click();
  // Continue to publish and publish.
  await page.getByRole('button', { name: 'Continue to publish' }).click(); await page.getByRole('button', { name: 'Publish changes', exact: true }).click();
  // The error appears; no success heading.
  await expect(page.getByRole('alert')).toContainText('That branch already exists'); await expect(page.getByRole('heading', { name: 'Changes published.' })).toHaveCount(0);
  // Activity stays empty.
  await page.getByRole('button', { name: 'Activity', exact: true }).click(); await expect(page.locator('.activity-row')).toHaveCount(0);
});

// Test: token connection uses the server and disconnect clears the workspace.
test('token connection uses the server and disconnect clears the workspace', async ({ page }) => {
  // Mock a signed-out user.
  await mockGitHub(page, false); await page.goto('/');
  // Enter the token and connect.
  await page.getByLabel('Fine-grained personal access token (recommended)', { exact: true }).fill(secret); await page.getByRole('button', { name: 'Connect with token' }).click();
  // Six repositories appear.
  await expect(page.locator('.repo-card')).toHaveCount(6);
  // The token is not in localStorage.
  expect(await page.evaluate(value => Object.values(localStorage).some(item => item.includes(value)), secret)).toBe(false);
  // Disconnect.
  await page.getByRole('button', { name: 'Disconnect GitHub', exact: true }).click();
  // The sign-in screen returns and the repositories are gone.
  await expect(page.getByRole('heading', { name: 'Connect your GitHub' })).toBeVisible(); await expect(page.locator('.repo-card')).toHaveCount(0);
});

// Test: repository creation calls the API and opens the new repository.
test('repository creation makes an API request and opens the returned repository', async ({ page }) => {
  // Mock.
  const mock = await mockGitHub(page); await page.goto('/');
  // Open the New repository dialog.
  await page.getByRole('button', { name: 'New repository', exact: true }).click();
  // The dialog is visible.
  await expect(page.getByRole('dialog', { name: 'Create a repository' })).toBeVisible();
  // An invalid name disables the button.
  await page.getByRole('textbox', { name: 'Repository name' }).fill('.'); await expect(page.getByRole('button', { name: 'Create repository', exact: true })).toBeDisabled();
  // Enter a valid name and create.
  await page.getByRole('textbox', { name: 'Repository name' }).fill('fresh-project'); await page.getByRole('button', { name: 'Create repository', exact: true }).click();
  // The new project opens.
  await expect(page.locator('.project-heading h1')).toContainText('fresh-project'); expect(mock.createdName()).toBe('fresh-project');
  // Back to the list: there are seven repositories.
  await page.getByRole('button', { name: 'All projects', exact: true }).click(); await expect(page.locator('.repo-card')).toHaveCount(7);
});

// Test: mobile sign-in, navigation, and file review fit the viewport.
test('mobile sign-in, navigation, and file review fit the viewport', async ({ page }) => {
  // Phone viewport, reduced motion, signed-out.
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await mockGitHub(page, false); await page.goto('/');
  // The sign-in screen appears; screenshot.
  await expect(page.getByRole('heading', { name: 'Connect your GitHub' })).toBeVisible(); await settle(page); await page.screenshot({ path: '.impeccable/review/mobile.png', fullPage: true });
  // No horizontal scroll.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Mock signed-in and reload.
  await mockGitHub(page); await page.reload(); await expect(page.locator('.repo-card')).toHaveCount(6);
  // The mobile sidebar is hidden (inert).
  await expect(page.locator('.sidebar')).toHaveAttribute('inert', '');
  // The menu button is collapsed.
  await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-expanded', 'false');
  // Open the menu and go to Settings.
  await page.getByRole('button', { name: 'Open navigation' }).click(); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  // Settings appears.
  await expect(page.getByRole('heading', { name: 'GitHub connection', exact: true })).toBeVisible();
  // Focus returns to the menu button.
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
  // The sidebar is hidden again.
  await expect(page.locator('.sidebar')).toHaveAttribute('inert', '');
  // Toggle the PR preference.
  await page.getByRole('switch', { name: 'Open draft pull requests by default' }).click(); await expect(page.getByRole('switch', { name: 'Open draft pull requests by default' })).toHaveAttribute('aria-checked', 'false');
  // Go back to Projects.
  await page.getByRole('button', { name: 'Open navigation' }).click(); await page.getByRole('button', { name: 'Projects 6' }).click();
  // Open a project and generate.
  await page.getByRole('button', { name: 'orbit-ui', exact: true }).click(); await page.getByRole('button', { name: 'Generate preview' }).click();
  // The review screen appears; scroll to the top.
  await expect(page.getByRole('heading', { name: 'Make it yours before you ship.' })).toBeVisible(); await expect(page.locator('.markdown-preview h1')).toBeVisible(); await settle(page); await page.evaluate(() => window.scrollTo(0, 0));
  // Take a screenshot.
  await page.screenshot({ path: '.impeccable/review/workbench-mobile.png', fullPage: true });
  // No horizontal scroll.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

// Test: without WebGL, and with a bad saved preference, sign-in still works.
test('WebGL unavailable and invalid saved preferences retain working connection controls', async ({ page }) => {
  // Run before the page loads.
  await page.addInitScript(() => {
    // Keep the original getContext.
    const original = HTMLCanvasElement.prototype.getContext;
    // Make WebGL unavailable.
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) { if (type === 'webgl') return null; return original.apply(this, [type, ...args] as never); } as typeof original;
    // Save an invalid preference.
    localStorage.setItem('gitlarp.defaultPr', '"invalid"');
  });
  // Open the app; the static fallback shows.
  await page.goto('/'); await expect(page.locator('.liquid-backdrop')).toHaveClass(/static-light/);
  // The token field still works.
  await expect(page.getByLabel('Fine-grained personal access token (recommended)', { exact: true })).toBeEnabled();
  // The effects toggle still works.
  await page.getByRole('button', { name: 'Pause visual effects' }).click(); await expect(page.getByRole('button', { name: 'Resume visual effects' })).toBeVisible();
});

// Test: session expiry removes projects and cancels a pending preview.
test('session expiry removes projects and aborts a pending preview', async ({ page }) => {
  // Mock and create promises to control timing.
  await mockGitHub(page); let connected = true; let release!: () => void; let started!: () => void;
  // Promises for release and start.
  const pending = new Promise<void>(resolve => { release = resolve; }); const submitted = new Promise<void>(resolve => { started = resolve; });
  // Session endpoint that can switch to signed-out.
  await page.route('**/api/session', route => route.fulfill({ json: { user: connected ? profile : null, configured: false, csrf: 'browser-csrf' } }));
  // Plan endpoint that waits to respond.
  await page.route('**/api/plans', async route => { started(); await pending; const context = fixtureContext(fixtureRepos[0]); await route.fulfill({ json: { id: 'late-preview', repo: context.repo, head: context.head, createdAt: new Date().toISOString(), ...generateFiles(context, ['readme']) } }); });
  // Open the project and start generating.
  await page.goto('/'); await page.getByRole('button', { name: 'orbit-ui', exact: true }).click(); await page.getByRole('button', { name: 'Generate preview' }).click(); await submitted;
  // Wait for the request to be canceled.
  const canceled = page.waitForEvent('requestfailed', { predicate: request => request.url().endsWith('/api/plans') });
  // Expire the session.
  connected = false; await page.evaluate(() => window.dispatchEvent(new Event('gitlarp:session-expired')));
  // The sign-in screen appears.
  await expect(page.getByRole('heading', { name: 'Connect your GitHub' })).toBeVisible();
  // Release the server; the request failed with an abort.
  release(); expect((await canceled).failure()?.errorText).toMatch(/abort/i);
  // No repositories or documents remain.
  await expect(page.locator('.repo-card')).toHaveCount(0); await expect(page.locator('.document-list button')).toHaveCount(0);
});


// Test: Continue with GitHub signs in the local account without a token.
test('Continue with GitHub connects the selected local account without requesting a pasted token', async ({ page }) => {
  // Signed-out flag.
  let connected = false;
  // Mock.
  await mockGitHub(page, false);
  // Session endpoint offering a local login.
  await page.route('**/api/session', route => route.fulfill({ json: { user: connected ? profile : null, configured: false, localLogin: profile.login, csrf: 'local-csrf' } }));
  // Local connect endpoint.
  await page.route('**/api/connect/local', route => {
    // Check the login in the request.
    expect(route.request().postDataJSON()).toEqual({ login: profile.login });
    // Check the CSRF header.
    expect(route.request().headers()['x-csrf-token']).toBe('local-csrf');
    // Mark connected and return the profile.
    connected = true; return route.fulfill({ json: { user: profile, csrf: 'new-local-csrf' } });
  });
  // Open the app.
  await page.goto('/');
  // The button is enabled.
  await expect(page.getByRole('button', { name: 'Continue with GitHub', exact: true })).toBeEnabled();
  // The note names the local account.
  await expect(page.locator('.oauth-note')).toContainText(profile.login);
  // Click it.
  await page.getByRole('button', { name: 'Continue with GitHub', exact: true }).click();
  // Six repositories appear.
  await expect(page.locator('.repo-card')).toHaveCount(6);
  // The token field is gone.
  await expect(page.getByLabel('Fine-grained personal access token (recommended)', { exact: true })).toHaveCount(0);
});

// Test: liquid motion draws each tick, eases the pointer, and keeps the shader on pause.
test('liquid motion draws each display tick, eases pointer movement, and preserves the shader on pause', async ({ page }) => {
  // Mock and enable motion.
  await mockGitHub(page, false); await page.emulateMedia({ reducedMotion: 'no-preference' });
  // Install a fake animation-frame queue.
  await page.addInitScript(() => {
    // Keep the native functions.
    const nativeFrame = window.requestAnimationFrame.bind(window); const nativeCancel = window.cancelAnimationFrame.bind(window);
    // Queue and counters.
    const queue = new Map<number, FrameRequestCallback>(); let next = -1; let stamp = 0;
    // Capture the draw calls.
    window.requestAnimationFrame = callback => { if (callback.name !== 'draw') return nativeFrame(callback); const id = next--; queue.set(id, callback); return id; };
    // Cancel handling.
    window.cancelAnimationFrame = id => { if (id < 0) queue.delete(id); else nativeCancel(id); };
    // A test API to tick frames and count pending.
    const state = { tick(count = 1) { for (let i = 0; i < count; i++) { stamp += 1000 / 60; const callbacks = [...queue.values()]; queue.clear(); callbacks.forEach(callback => callback(stamp)); } }, pending() { return queue.size; } };
    // Expose it on window.
    Object.assign(window, { liquidTest: state });
  });
  // Open the app.
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Connect your GitHub' })).toBeVisible();
  // Helper that ticks and reads the shader values.
  const sample = (ticks: number) => page.evaluate(count => {
    // Get the test harness.
    const harness = (window as typeof window & { liquidTest: { tick(count: number): void; pending(): number }; liquidProgram?: WebGLProgram }).liquidTest;
    // Run the ticks.
    harness.tick(count);
    // Get the WebGL context.
    const canvas = document.querySelector('canvas')!; const gl = canvas.getContext('webgl')!;
    // Get the active program.
    const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
    // Read time, pointer, and pending frames.
    return { time: gl.getUniform(program, gl.getUniformLocation(program, 'u_time')!) as number, pointer: Array.from(gl.getUniform(program, gl.getUniformLocation(program, 'u_pointer')!) as Float32Array), pending: harness.pending() };
  }, ticks);
  // Sample three frames.
  const start = await sample(2); const first = await sample(2); const second = await sample(2);
  // Each frame advances time by 1/60 second.
  expect(first.time - start.time).toBeCloseTo(1 / 30, 3); expect(second.time - first.time).toBeCloseTo(1 / 30, 3);
  // Move the mouse.
  await page.mouse.move(1400, 30); const eased = await sample(2);
  // The pointer eases toward the target.
  expect(eased.pointer[0]).toBeGreaterThan(start.pointer[0]); expect(eased.pointer[0]).toBeLessThan(0.7);
  // It keeps moving over more frames.
  expect((await sample(20)).pointer[0]).toBeGreaterThan(eased.pointer[0]);
  // Remember the shader program.
  await page.evaluate(() => { const gl = document.querySelector('canvas')!.getContext('webgl')!; Object.assign(window, { liquidProgram: gl.getParameter(gl.CURRENT_PROGRAM) }); });
  // Pause the effects.
  await page.getByRole('button', { name: 'Pause visual effects' }).click(); const paused = await sample(2);
  // Nothing is pending and time stops.
  expect(paused.pending).toBe(0); expect((await sample(10)).time).toBe(paused.time);
  // Resume.
  await page.getByRole('button', { name: 'Resume visual effects' }).click(); await sample(1);
  // Time advances again.
  expect((await sample(2)).time).toBeGreaterThan(paused.time);
  // The same shader program is still in use.
  expect(await page.evaluate(() => { const gl = document.querySelector('canvas')!.getContext('webgl')!; return gl.getParameter(gl.CURRENT_PROGRAM) === (window as typeof window & { liquidProgram?: WebGLProgram }).liquidProgram; })).toBe(true);
  // Reduce motion.
  await page.emulateMedia({ reducedMotion: 'reduce' }); await sample(1); const reduced = await sample(1);
  // Nothing is pending and time stops.
  expect(reduced.pending).toBe(0); expect((await sample(5)).time).toBe(reduced.time);
});
