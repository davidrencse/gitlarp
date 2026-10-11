// React state hook.
import { useState } from 'react';
// Icons.
import { ArrowUpRight, BookOpen, BrainCircuit, ChevronDown, FileCode2, MessageSquare, Sparkles } from 'lucide-react';
// Shared AI types.
import type { AIReport, AIUsage, Repo, SourceFact } from '../shared/types';
// Markdown renderer.
import Markdown from './Markdown';
// Spinner.
import { Spinner } from './components';

// A question and its AI answer, with sources, follow-up ideas, and token usage.
export interface ProjectAnswer { question: string; answer: string; sources: string[]; followUps: string[]; usage?: AIUsage; model?: string }
// AI analysis panel: settings, analysis results, and a question box.
export default function ProjectIntelligence({ repo, report, configured, model, enabled, onEnabled, instructions, onInstructions, busy, pending, answers, onAnalyze, onAsk, compact = false }: {
  repo: Repo; report: AIReport | null; configured: boolean; model: string; enabled: boolean; onEnabled: (value: boolean) => void;
  instructions: string; onInstructions: (value: string) => void; busy: boolean; pending: 'analysis' | 'question' | null;
  answers: ProjectAnswer[]; onAnalyze: () => void; onAsk: (question: string) => void; compact?: boolean;
}) {
  // UI state: the selected analysis tab and the question being typed.
  const [section, setSection] = useState<'overview' | 'architecture' | 'recommendations'>('overview'); const [question, setQuestion] = useState('');
  // Render a link to a source file on GitHub at the analyzed commit.
  function source(path: string) { return <a key={path} href={`${repo.html_url}/blob/${encodeURIComponent(report!.head)}/${path.split('/').map(encodeURIComponent).join('/')}`} target="_blank" rel="noreferrer"><FileCode2 size={12} />{path}<ArrowUpRight size={11} /></a>; }
  // Render a list of facts with titles, details, and source links.
  function facts(items: SourceFact[]) { return items.map((item, index) => <article className="intelligence-fact" key={`${item.title}-${index}`}><h4>{item.title}{'priority' in item && <span className="intelligence-priority">{String(item.priority)}</span>}</h4><p>{item.detail}</p>{!!item.evidence.length && <div className="evidence-links">{item.evidence.map(source)}</div>}</article>); }
  // Body of the panel (a fragment reused in compact and full layouts).
  const body = <>
    {/* Controls (instructions, toggle, analyze button, disclosure), hidden when compact. */}
    {!compact && <div className="intelligence-controls"><div><h3>Give the AI your direction.</h3><p>Tell it who this project is for and what deserves more detail.</p><textarea aria-label="AI documentation focus" placeholder="Explain the architecture, real workflows, setup, API examples, and troubleshooting. Keep it detailed and useful for developers." value={instructions} maxLength={2500} rows={3} onChange={event => onInstructions(event.target.value)} disabled={busy || !!pending} /></div><div className="intelligence-actions"><label className="simple-checkbox"><input type="checkbox" checked={enabled} onChange={event => onEnabled(event.target.checked)} disabled={!configured || busy || !!pending} />Use Groq for generated documentation</label><button className="button secondary" onClick={onAnalyze} disabled={!configured || busy || !!pending}>{pending === 'analysis' ? <Spinner label="Reading code and analyzing…" /> : <><BrainCircuit size={16} />{report ? 'Refresh project analysis' : 'Analyze this project'}</>}</button><p className="intelligence-disclosure">{configured ? 'Selected source excerpts are sent to Groq. Private environment files and common credentials are filtered. Review every generated claim.' : 'Configure Groq on the server to analyze source and generate richer documentation.'}</p></div></div>}
    {/* With a report: provenance, usage, tabs, analysis, and questions; otherwise an empty state. */}
    {report ? <>
      {/* Provenance: file count, characters, snapshot, and review warning. */}
      <div className="intelligence-provenance"><span><FileCode2 size={14} />{report.sourceFiles.length} source files</span><span>{report.sourceCharacters.toLocaleString()} characters inspected</span><span>Snapshot {report.head.slice(0, 7)}</span><span>AI interpretation · review required</span></div>
      {/* Note when a cached analysis was reused. */}
      {report.reused && <p className="intelligence-cache-note">Reused this snapshot's analysis. No new model call.</p>}
      {/* Token usage of the request. */}
      {report.usage && <div className="intelligence-token-usage" aria-label="AI token usage"><span>{report.reused ? 'Original request usage' : 'Request usage'}</span><strong>{report.usage.inputTokens.toLocaleString()} input</strong><strong>{report.usage.outputTokens.toLocaleString()} output</strong><strong>{report.usage.cachedTokens.toLocaleString()} cached input</strong></div>}
      {/* Tabs for overview, architecture, and recommendations. */}
      <div className="intelligence-sections" role="group" aria-label="Project analysis view">{(['overview', 'architecture', 'recommendations'] as const).map(value => <button key={value} aria-pressed={section === value} onClick={() => setSection(value)}>{value === 'overview' ? 'Overview & capabilities' : value === 'architecture' ? 'Architecture & data flow' : 'Recommended improvements'}</button>)}</div>
      {/* Overview (summary, capabilities, stack) or the selected fact list. */}
      {section === 'overview' ? <><div className="intelligence-summary"><h3>What this project does</h3><Markdown>{report.analysis.summary}</Markdown><p>{report.analysis.purpose}</p></div><div className="intelligence-columns"><section><h3>Capabilities</h3>{facts(report.analysis.capabilities)}</section><section><h3>Technology & responsibilities</h3>{facts(report.analysis.stack)}</section></div></> : <div className="intelligence-facts"><h3>{section === 'architecture' ? 'How the project fits together' : 'What to improve next'}</h3>{facts(section === 'architecture' ? report.analysis.architecture : report.analysis.recommendations)}</div>}
      {/* Limitations the AI could not verify. */}
      {!!report.analysis.limitations.length && <details className="intelligence-limitations"><summary>Scope and unverified details · {report.analysis.limitations.length}</summary><ul>{report.analysis.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
      {/* Source evidence: files read and omitted notes. */}
      <details className="intelligence-sources"><summary>Source evidence · {report.sourceFiles.length} files</summary><div className="evidence-links">{report.sourceFiles.map(source)}</div>{!!report.omitted.length && <ul>{report.omitted.map((item, index) => <li key={index}>{item}</li>)}</ul>}</details>
      {/* Ask-your-project section with previous answers and suggested questions. */}
      <section className="project-questions" aria-label="Ask about this repository"><div className="question-heading"><MessageSquare size={17} /><h3>Ask your project.</h3><span>Answers use this source snapshot.</span></div>{answers.length ? <div className="project-answers" aria-live="polite">{answers.map((item, index) => <article className="project-answer" key={index}><h4>{item.question}</h4><div className="answer-markdown"><Markdown>{item.answer}</Markdown></div><div className="evidence-links">{item.sources.map(source)}</div>{item.usage && <p className="intelligence-cache-note">{item.model} ? {item.usage.inputTokens.toLocaleString()} input / {item.usage.outputTokens.toLocaleString()} output / {item.usage.cachedTokens.toLocaleString()} cached input tokens</p>}{index === answers.length - 1 && <div className="question-suggestions">{item.followUps.map(value => <button key={value} onClick={() => onAsk(value)} disabled={busy || !!pending}>{value}<ArrowUpRight size={12} /></button>)}</div>}</article>)}</div> : <div className="question-suggestions">{['Explain the main workflow and data flow.', 'What is missing from the setup instructions?', 'Which improvements would have the most impact?'].map(value => <button key={value} onClick={() => onAsk(value)} disabled={busy || !!pending}>{value}<ArrowUpRight size={12} /></button>)}</div>}
        {/* Question form. */}
        <form className="project-question-form" onSubmit={event => { event.preventDefault(); if (question.trim().length >= 3) { onAsk(question.trim()); setQuestion(''); } }}><label className="sr-only" htmlFor="project-question">Question about this repository</label><input id="project-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={2500} placeholder="Ask about the code, architecture, or documentation…" disabled={busy || !!pending} /><button className="button primary" type="submit" disabled={question.trim().length < 3 || busy || !!pending}>{pending === 'question' ? <Spinner label="Thinking…" /> : <><Sparkles size={14} />Ask Groq</>}</button></form>
      </section>
    </> : <div className="intelligence-empty"><BookOpen size={22} /><div><strong>Source understanding comes first.</strong><p>Analyze the repository to see its actual capabilities, architecture, and useful improvements. You can also generate your selected files directly with Groq.</p></div></div>}
  </>;
  // Render nothing if the AI is not configured and there is no report.
  if (!configured && !report) return null;
  // Compact mode shows a collapsible details element; otherwise the full header and body.
  return <section className={`project-intelligence ${compact ? 'compact' : ''}`} aria-label="Project intelligence">{compact ? <details><summary><BrainCircuit size={16} />Project intelligence<span>{report?.sourceFiles.length || 0} sources · {report?.model || model}</span><ChevronDown className="intelligence-expand" size={16} aria-hidden="true" /></summary>{body}</details> : <><header className="intelligence-header"><div><BrainCircuit size={21} /><div><h2>Understand it. Then improve it.</h2><p>Source-aware analysis, useful documentation, and answers about your code.</p></div></div><span className="intelligence-model">Groq · {report?.model || model}</span></header>{body}</>}</section>;
}
