// Types for the sample AI data.
import type { AIReport, ProjectAnalysis } from '../../shared/types';
// Evidence type.
import type { RepositoryEvidence } from '../../server/evidence';
// Sample repositories and project context.
import { fixtureContext, fixtureRepos } from './projects';

// Sample AI analysis of the "orbit-ui" fixture project.
export const analysis: ProjectAnalysis = {
  // Summary of the project.
  summary: 'Orbit provides React interface components with keyboard navigation. The sampled Button source implements an accessible button wrapper; the package manifest declares Vite development and build commands.',
  // Purpose of the project.
  purpose: 'Developers can use the components to build consistent interfaces and inspect their source before adoption.',
  // Technology facts, each citing a file.
  stack: [{ title: 'React and Vite', detail: 'React provides the component model; the dev and build scripts use Vite.', evidence: ['package.json'] }],
  // Capabilities.
  capabilities: [{ title: 'Button component', detail: 'The button wrapper forwards its label and native props to an HTML button, preserving keyboard activation.', evidence: ['src/components/Button.tsx'] }],
  // Architecture facts.
  architecture: [{ title: 'Component exports', detail: 'The entry file exports Button. Consumers import the public entry while implementation stays in the components directory.', evidence: ['src/index.ts', 'src/components/Button.tsx'] }],
  // Recommendations with a priority.
  recommendations: [{ title: 'Document supported button props', detail: 'Show native disabled and click handler examples based on the existing wrapper, so consumers can use it correctly.', priority: 'high', evidence: ['src/components/Button.tsx'] }],
  // Limitations the AI must be honest about.
  limitations: ['Only selected source excerpts were reviewed. Test commands are declared but have not been executed.'],
};
// Sample evidence: the project context and three source files.
export const evidence: RepositoryEvidence = {
  // Context of the first fixture repository.
  context: fixtureContext(fixtureRepos[0]),
  // Files the AI would have read.
  files: [
    // package.json.
    { path: 'package.json', content: JSON.stringify(fixtureContext(fixtureRepos[0]).manifest), truncated: false },
    // src/index.ts.
    { path: 'src/index.ts', content: "export { Button } from './components/Button';", truncated: false },
    // A Button component.
    { path: 'src/components/Button.tsx', content: 'export function Button(props) { return <button {...props} />; }', truncated: false },
  // No omitted files and a size estimate.
  ], omitted: [], sourceCharacters: 400,
};
// Sample stored AI report with token usage.
export const report: AIReport = { id: 'c962c88d-9326-4a59-a9b6-8c44170953a8', provider: 'Groq', model: 'openai/gpt-oss-120b', head: evidence.context.head, analysis,
  // Source files, omitted notes, size, creation time, and token usage.
  sourceFiles: evidence.files.map(file => file.path), omitted: evidence.omitted, sourceCharacters: evidence.sourceCharacters, createdAt: new Date().toISOString(), usage: { inputTokens: 1200, outputTokens: 600, cachedTokens: 800 } };
