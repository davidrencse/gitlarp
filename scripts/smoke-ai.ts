// Explicit, paid provider check. No GitHub requests or publishing.
// Load .env so the API key is available.
import 'dotenv/config';
// File reading.
import { readFile } from 'node:fs/promises';
// Strict assertions.
import assert from 'node:assert/strict';
// AI functions under test.
import { generateAI, askAI } from '../server/groq';
// Secret redaction.
import { redactSecrets } from '../server/evidence';
// Evidence type.
import type { RepositoryEvidence } from '../server/evidence';
// AI report store.
import { IntelligenceStore } from '../server/intelligence';
// File generator.
import { generateFiles } from '../shared/generator';
// Project context type.
import type { ProjectContext } from '../shared/types';

// Refuse to run without an API key (this check costs money).
if (!process.env.GROQ_API_KEY) throw new Error('Set GROQ_API_KEY on the server before running this paid check.');
// Optional pacing keeps each paid stage below provider token-per-minute limits.
const cooldownMs = Math.max(0, Math.min(120_000, Number(process.env.GROQ_SMOKE_COOLDOWN_MS) || 0));
const coolDown = async () => { if (cooldownMs) { console.log(`Waiting ${Math.ceil(cooldownMs / 1000)} seconds for the Groq rate window...`); await new Promise(resolve => setTimeout(resolve, cooldownMs)); } };
// On a failed live check, report structure only. Never print source or credentials.
// Holds the last response structure for debugging.
let lastShape: unknown;
// Keep the original fetch.
const providerFetch = global.fetch;
// Wrap fetch to inspect Groq responses.
global.fetch = async (input, init) => {
  // Make the real request.
  const response = await providerFetch(input, init);
  // Only look at successful Groq chat responses.
  if (String(input).startsWith('https://api.groq.com/openai/v1/chat/completions') && response.ok) {
    // Wrap parsing so failures are recorded.
    try {
      // Parse the response and get the content.
      const body = await response.clone().json(); const content = body.choices?.[0]?.message?.content;
      // Try to parse the model content as JSON.
      try {
        // Parse it.
        const payload = JSON.parse(content || '{}');
        // Record only the structure (keys, lengths, types), never the content.
        lastShape = { finish: body.choices?.[0]?.finish_reason, keys: Object.keys(payload), analysis: payload.analysis && Object.fromEntries(Object.entries(payload.analysis).map(([key, value]) => [key, Array.isArray(value) ? { length: value.length, firstKeys: value[0] && typeof value[0] === 'object' ? Object.keys(value[0]) : undefined } : typeof value])), files: Array.isArray(payload.files) ? payload.files.length : typeof payload.files, messages: Array.isArray(payload.messages) ? payload.messages.length : typeof payload.messages };
      // If the content is not JSON, record its basic properties.
      } catch { lastShape = { finish: body.choices?.[0]?.finish_reason, contentType: typeof content, contentLength: content?.length || 0, fenced: typeof content === 'string' && content.startsWith('```') }; }
    // If the response is not JSON, record that.
    } catch { lastShape = { responseParseable: false }; }
  }
  // Return the original response.
  return response;
};
// Read this project's package.json for the test fixture.
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
// Local files used as sample source excerpts.
const paths = ['package.json', 'server/groq.ts', 'server/evidence.ts', 'shared/types.ts'];
// Read each file.
const files = await Promise.all(paths.map(async path => {
  // Redact secrets from each file.
  const source = redactSecrets(await readFile(path, 'utf8'));
  // Keep the paid live check compact enough to exercise every stage under
  // ordinary Groq token-per-minute limits.
  return { path, content: source.slice(0, 2500), truncated: source.length > 2500 };
}));
// Build a fake project context (a synthetic repo, not a real GitHub repository).
const context: ProjectContext = {
  // Synthetic repository metadata.
  repo: { id: 1, name: 'gitlarp-validation', full_name: 'local-validation/gitlarp-validation', description: 'A synthetic validation repository containing real local GitLarp source excerpts. This is not an existing GitHub repository.',
    // More metadata fields (language, timestamps, owner, no permissions).
    private: true, language: 'TypeScript', stargazers_count: 0, forks_count: 0, updated_at: new Date().toISOString(), pushed_at: new Date().toISOString(), default_branch: 'main', owner: { login: 'local-validation' }, html_url: '', permissions: { push: false, admin: false } },
  // Head id, file paths, manifest, no README, no commits.
  head: 'local-validation-snapshot', paths, manifest, readme: null, commits: [],
};
// Build the evidence object from the local files.
const evidence: RepositoryEvidence = { context, files, sourceCharacters: files.reduce((sum, file) => sum + file.content.length, 0), omitted: ['Synthetic validation context; not an actual GitHub repository. Source excerpts may be truncated. Tests have not been executed by the model.'] };
// Instructions for the AI.
const instructions = 'Explain the actual local AI implementation with technical depth and clear project presentation. Treat repository identity as a synthetic test fixture.';
// Log progress.
console.log('Checking Groq analysis against local source excerpts...');
// Analyze the project; on failure print the response structure and rethrow.
const inspected = await generateAI(evidence, [], [], instructions).catch(error => { console.error('Analysis response structure:', JSON.stringify(lastShape)); throw error; });
// Check that the analysis cites at least one source.
assert.ok([...inspected.analysis.stack, ...inspected.analysis.capabilities, ...inspected.analysis.architecture].some(item => item.evidence.length));
// Print the model and token usage.
console.log(JSON.stringify({ task: 'analysis', model: inspected.model, usage: inspected.usage }));
// Store the analysis in an in-memory store.
const store = new IntelligenceStore(); const report = store.put('validation', evidence, inspected.analysis, inspected.usage, inspected.model, instructions);
await coolDown();
// Log progress.
console.log('Checking focused Groq Q&A...');
// Ask the AI a question.
const answer = await askAI(evidence, report, 'How does the Groq integration reduce token usage, and what remains unverified?');
// Check the answer is substantial.
assert.ok(answer.answer.length > 100);
// Print the model, usage, and number of sources.
console.log(JSON.stringify({ task: 'question', model: answer.model, usage: answer.usage, sources: answer.sources.length }));
await coolDown();
// Log progress.
console.log('Checking Groq README generation with the existing analysis reused...');
// Generate a baseline README with the generator.
const baseline = generateFiles(context, ['readme']);
// Have the AI rewrite it, reusing the earlier analysis.
const drafted = await generateAI(evidence, baseline.files, baseline.commits, instructions, undefined, inspected.analysis);
// Check the README is long and the analysis was reused.
assert.ok(drafted.files[0].content.length > 4500, 'The sampled project should receive a substantial README.'); assert.deepEqual(drafted.analysis, inspected.analysis);
// Print a summary of the generated documents.
console.log(JSON.stringify({ task: 'documents', model: drafted.model, usage: drafted.usage, files: drafted.files.map(file => ({ path: file.path, characters: file.content.length, sections: (file.content.match(/^#{1,3}\s+/gm) || []).length })) }));
// Report success.
console.log('Live AI check passed. No GitHub changes were made.');
