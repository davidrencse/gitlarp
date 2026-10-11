// React hooks.
import { useEffect, useRef, useState } from 'react';
// Icons from lucide-react.
import { ArrowLeft, ArrowRight, Check, CheckCheck, Code2, Copy, Download, ExternalLink, FileCode2, FileText, GitBranch, GitCommitHorizontal, GitFork, Github, History, Info, Pencil, ShieldCheck, Sparkles } from 'lucide-react';
// Markdown renderer.
import Markdown from './Markdown';
// Panel for AI analysis and questions.
import ProjectIntelligence from './ProjectIntelligence';
// Type of a Q&A answer.
import type { ProjectAnswer } from './ProjectIntelligence';
// File download helpers.
import { downloadFile, downloadPlan } from './downloads';
// Branch and repository name validators.
import { validBranch, validRepoName } from '../shared/validation';
// File and plan size limits and the UTF-8 size helper.
import { MAX_FILE_BYTES, MAX_PLAN_BYTES, utf8Bytes } from '../shared/validation';
// Scroll helper.
import { scrollToTop } from './components';
// API helper.
import { api } from './api';
// Generator helpers: CI availability, health score, and module list.
import { ciAvailable, health, modules } from '../shared/generator';
// Shared types.
import type { AIReport, ModuleId, Plan, ProjectContext, PublishInput, PublishResult, Repo } from '../shared/types';
// Shared UI components.
import { Empty, Spinner, Stepper } from './components';

// Convert a Date to the format used by datetime-local inputs.
function toLocalInput(date: Date) {
  // Zero-pad a number to two digits.
  const pad = (value: number) => String(value).padStart(2, '0');
  // Build YYYY-MM-DDTHH:MM in local time.
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Workbench: configure, review, and publish improvements for one repository.
export default function Workbench({ repo, initialPlan, initialReport, aiConfigured, aiModel, onReport, onBack, onSave, onPublish, notify, defaultPr }: { repo: Repo; initialPlan?: Plan; initialReport?: AIReport; aiConfigured: boolean; aiModel: string; onReport: (report: AIReport) => void; onBack: () => void; onSave: (plan: Plan) => void; onPublish: (plan: Plan, result: PublishResult) => void; notify: (text: string) => void; defaultPr: boolean }) {
  // Project context loaded from the server (null until loaded).
  const [context, setContext] = useState<ProjectContext | null>(null);
  // Error message.
  const [error, setError] = useState('');
  // Whether the project is loading.
  const [loading, setLoading] = useState(true);
  // Selected improvement modules (default set).
  const [selected, setSelected] = useState<ModuleId[]>(['readme', 'docs', 'contributing', 'templates']);
  // Current step: 0 configure, 1 review, 2 publish (starts at review if a plan exists).
  const [step, setStep] = useState(initialPlan ? 1 : 0);
  // The generated plan.
  const [plan, setPlan] = useState<Plan | null>(initialPlan ?? null);
  // True while generating or publishing.
  const [busy, setBusy] = useState(false);
  // File being viewed in the editor.
  const [activeFile, setActiveFile] = useState(initialPlan?.files[0]?.path ?? 'README.md');
  // Which view of the file is shown: preview, source, or original.
  const [preview, setPreview] = useState<'preview' | 'source' | 'original'>('preview');
  // Publish destination: branch, fork, or new repo.
  const [target, setTarget] = useState<PublishInput['target']>('branch');
  // Branch name (or prefix).
  const [branch, setBranch] = useState('docs/project-polish');
  // Whether to publish each commit group on its own branch.
  const [splitBranches, setSplitBranches] = useState(false);
  // Name for a new documentation repository.
  const [name, setName] = useState(`${repo.name}-docs`);
  // Whether a new repository is private.
  const [isPrivate, setIsPrivate] = useState(true);
  // Whether to open draft pull requests (defaults to the saved preference).
  const [createPr, setCreatePr] = useState(defaultPr);
  // Whether commit history is customized (author and dates).
  const [fabricate, setFabricate] = useState(false);
  // Author name for customized history.
  const [authorName, setAuthorName] = useState('');
  // Author email for customized history.
  const [authorEmail, setAuthorEmail] = useState('');
  // Earliest commit date.
  const [historyFrom, setHistoryFrom] = useState('');
  // Latest commit date.
  const [historyTo, setHistoryTo] = useState('');
  // Publish result.
  const [result, setResult] = useState<PublishResult | null>(null);
  // Counter that triggers a reload of the project.
  const [retry, setRetry] = useState(0);
  // AI settings: whether to use it, and the user's instructions.
  const [useAI, setUseAI] = useState(aiConfigured); const [instructions, setInstructions] = useState('Balance technical depth with clear project presentation. Explain real features, use cases, architecture, setup, API examples, and troubleshooting.');
  // Latest AI report (from the plan, or saved from before).
  const [report, setReport] = useState<AIReport | null>(initialPlan?.ai || initialReport || null);
  // AI status (analysis or question running) and the Q&A history.
  const [pending, setPending] = useState<'analysis' | 'question' | null>(null); const [answers, setAnswers] = useState<ProjectAnswer[]>([]);
  // Controller to cancel in-flight AI requests.
  const aiAbort = useRef<AbortController | null>(null);
  // Cancel any running request when the component unmounts.
  useEffect(() => () => aiAbort.current?.abort(), []);
  // Save a new AI report, reset answers, and notify the parent.
  function rememberReport(next: AIReport) { setReport(next); setAnswers([]); onReport(next); }
  // Run the AI project analysis.
  async function analyze() {
    // Skip if something else is running.
    if (busy || pending) return; setPending('analysis'); setError('');
    // Create an abort controller for cancellation.
    const controller = new AbortController(); aiAbort.current = controller;
    // Call the API (up to 4 minutes) and save the report.
    try { const next = await api<AIReport>('/api/ai/analyze', { owner: repo.owner.login, repo: repo.name, instructions, ...(context?.inspectionId ? { inspectionId: context.inspectionId } : {}) }, { signal: controller.signal, timeoutMs: 240_000 }); rememberReport(next); }
    // Show errors (unless canceled) and clear the pending state.
    catch (error) { if (!controller.signal.aborted) setError((error as Error).message); } finally { setPending(null); }
  }
  // Ask the AI a question about the project.
  async function ask(question: string) {
    // Requires a report and nothing running.
    if (!report || busy || pending) return; setPending('question'); setError('');
    // Create an abort controller.
    const controller = new AbortController(); aiAbort.current = controller;
    // Send the question with the last two exchanges as history; keep the latest 8 answers.
    try { const next = await api<Omit<ProjectAnswer, 'question'>>('/api/ai/ask', { analysisId: report.id, question, history: answers.slice(-2).flatMap(item => [{ role: 'user', content: item.question }, { role: 'assistant', content: item.answer.slice(0, 1400) }]) }, { signal: controller.signal, timeoutMs: 240_000 }); setAnswers(list => [...list, { question, ...next }].slice(-8)); }
    // Show errors (unless canceled) and clear the pending state.
    catch (error) { if (!controller.signal.aborted) setError((error as Error).message); } finally { setPending(null); }
  }

  // Scroll to the top whenever the step or result changes.
  useEffect(() => { scrollToTop(); }, [step, result]);

  // Load the project from the server when opened (or retried).
  useEffect(() => {
    // Flag to ignore results after cleanup.
    let cancelled = false;
    // Controller to cancel the request on cleanup.
    const controller = new AbortController();
    // Show the loading state and clear errors.
    setLoading(true); setError('');
    // Request the project context.
    const load = api<ProjectContext>(`/api/projects/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}`, undefined, { signal: controller.signal });
    // On success store it and pick fork when the user has no push access; handle errors.
    load.then(data => { if (!cancelled) { setContext(data); if (!data.repo.permissions?.push) setTarget('fork'); } }).catch(err => { if (!cancelled) setError(err.message); }).finally(() => { if (!cancelled) setLoading(false); });
    // Cleanup: ignore results and abort.
    return () => { cancelled = true; controller.abort(); };
  }, [repo, retry]);

  // Generate the preview of files and commits.
  async function generate() {
    // Needs project data and nothing running.
    if (!context || busy || pending) return;
    // Show the busy state and clear errors.
    setBusy(true); setError('');
    // Create an abort controller.
    const controller = new AbortController(); aiAbort.current = controller;
    // Request the plan.
    try {
      // Send selected modules, AI choice, instructions, and the analysis id when available.
      const next = await api<Plan>('/api/plans', { owner: repo.owner.login, repo: repo.name, modules: selected, ai: useAI && aiRelevant, instructions, ...(context.inspectionId ? { inspectionId: context.inspectionId } : {}), ...(useAI && report ? { analysisId: report.id } : {}) }, { signal: controller.signal, timeoutMs: 240_000 });
      // Save any AI report.
      if (next.ai) rememberReport(next.ai);
      // Store the plan, select the first file, move to review, and notify the parent.
      setPlan(next); setActiveFile(next.files[0].path); setStep(1); onSave(next);
    // Show errors (unless canceled) and clear the busy state.
    } catch (err) { if (!controller.signal.aborted) setError((err as Error).message); } finally { setBusy(false); }
  }
  // Update the content of the active file.
  function editFile(content: string) {
    // Needs a plan.
    if (!plan) return;
    // Create a new plan with the updated file.
    const next = { ...plan, files: plan.files.map(f => f.path === activeFile ? { ...f, content } : f) };
    // Store it and notify the parent.
    setPlan(next); onSave(next);
  }
  // Update a commit message.
  function editMessage(index: number, message: string) {
    // Needs a plan.
    if (!plan) return;
    // Create a new plan with the updated message.
    const next = { ...plan, commits: plan.commits.map((c, i) => i === index ? { ...c, message } : c) };
    // Store it and notify the parent.
    setPlan(next); onSave(next);
  }
  // Publish the reviewed plan.
  async function publish() {
    // Needs a plan.
    if (!plan) return;
    // Check size limits.
    if (plan.files.some(file => utf8Bytes(file.content) > MAX_FILE_BYTES) || plan.files.reduce((size, file) => size + utf8Bytes(file.content), 0) > MAX_PLAN_BYTES) { setError('Keep each file below 250 KB and the complete preview below 1 MB.'); return; }
    // Check commit message length.
    if (plan.commits.some(commit => commit.message.trim().length < 5)) { setError('Give every commit a descriptive message of at least five characters.'); return; }
    // Check the history settings.
    if (fabricate && !historyValid) { setError('Fill in the author and a valid date range before publishing a fabricated history.'); return; }
    // Show the busy state and clear errors.
    setBusy(true); setError('');
    // Build the history object (ISO dates) if customized.
    const history = fabricate ? { authorName: authorName.trim(), authorEmail: authorEmail.trim(), from: new Date(historyFrom).toISOString(), to: new Date(historyTo).toISOString() } : undefined;
    // Send the request.
    try {
      // Send the plan id, destination, options, final files, messages, and history.
      const published = await api<PublishResult>('/api/publish', { planId: plan.id, target, branch, name: target === 'new' ? name : undefined, private: isPrivate, createPr, splitBranches, files: plan.files.map(({ path, content }) => ({ path, content })), messages: plan.commits.map(c => c.message), ...(history ? { history } : {}) });
      // Store the result and notify the parent.
      setResult(published); onPublish(plan, published);
    // Show errors and clear the busy state.
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  // Project health checks (null before loading).
  const audit = context ? health(context) : null;
  // The currently selected file.
  const file = plan?.files.find(f => f.path === activeFile);
  // Total files in the selected modules.
  const totalFiles = modules.filter(m => selected.includes(m.id)).reduce((sum, m) => sum + m.files.length, 0);
  // AI is only relevant for README, docs, contributing, and templates.
  const aiRelevant = selected.some(module => ['readme', 'docs', 'contributing', 'templates'].includes(module));
  // Branch name validity.
  const branchValid = validBranch(branch);
  // Repository name validity.
  const nameValid = validRepoName(name);
  // History validity: author, email, dates, and order (always valid when disabled).
  const historyValid = fabricate ? authorName.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authorEmail.trim()) && Number.isFinite(Date.parse(historyFrom)) && Number.isFinite(Date.parse(historyTo)) && Date.parse(historyFrom) <= Date.parse(historyTo) : true;
  // Toggle customized history and pre-fill default dates.
  function toggleFabricate(enabled: boolean) {
    // Update the toggle.
    setFabricate(enabled);
    // When enabling with empty dates, suggest defaults.
    if (enabled && !historyFrom && !historyTo) {
      // Latest date: one month ago.
      const to = new Date(); to.setMonth(to.getMonth() - 1);
      // Earliest date: one year ago.
      const from = new Date(); from.setFullYear(from.getFullYear() - 1);
      // Fill the date inputs.
      setHistoryFrom(toLocalInput(from)); setHistoryTo(toLocalInput(to));
    }
  }
  // Number of branches that would be published when splitting (groups with real changes).
  const publishGroupCount = plan?.commits.filter(group => group.files.some(path => { const file = plan.files.find(item => item.path === path); return file && (target === 'new' || file.content !== file.original); })).length ?? 0;
  // Download the plan as a ZIP, with a toast on error.
  function downloadBundle() { if (plan) void downloadPlan(plan).catch(error => notify(`Download failed. ${(error as Error).message}`)); }

  // Render the workbench.
  return <div className="workbench page-enter">
    {/* Back link to all projects. */}
    <button className="back-link" onClick={onBack}><ArrowLeft size={15} /> All projects</button>
    {/* Project heading with the owner, name, visibility, description, and default branch. */}
    <div className="project-heading"><div><div className="repo-owner">{repo.owner.login} /</div><h1>{repo.name}<span className="visibility">{repo.private ? 'Private' : 'Public'}</span></h1><p>{repo.description}</p></div><div className="branch-badge"><GitBranch size={14} />{repo.default_branch}</div></div>
    {/* Evidence strip with project facts. */}
    {context && <div className="project-evidence-strip"><span>{context.repo.language || 'Mixed languages'}</span><span>{context.paths.length} file paths{context.truncated ? ' ? incomplete tree' : ''}</span><span>{Object.keys(context.manifest?.scripts || {}).length} declared scripts</span><span>{context.commits.length} recent commits</span></div>}
    {/* Stepper showing the current step. */}
    <Stepper step={step} />
    {/* Error banner with a Dismiss button. */}
    {error && <div className="error-banner" role="alert"><Info size={17} /><span>{error}</span><button className="text-button" onClick={() => setError('')}>Dismiss</button></div>}
    {/* AI analysis panel. */}
    {context && <ProjectIntelligence repo={repo} report={report} configured={aiConfigured} model={aiModel} enabled={useAI} onEnabled={setUseAI} instructions={instructions} onInstructions={setInstructions} busy={busy} pending={pending} answers={answers} onAnalyze={() => void analyze()} onAsk={question => void ask(question)} compact={step > 0} />}
    {/* Content: loading, error, success, or the current step (details below). */}
    {loading ? <div className="loading-panel"><Spinner label="Reading your project…" /></div> : !context ? <Empty icon={<Github size={30} />} title="We couldn’t read this project" action={<button className="button secondary" onClick={() => setRetry(r => r + 1)}>Try again</button>}>Check repository access and try again.</Empty> : result ? <div className="success-panel"><span className="success-icon"><CheckCheck size={32} /></span><h2>Changes published.</h2><p>{`${result.files} files and ${result.commits} commits published${result.branches?.length ? ` across ${result.branches.length} branches` : ` to ${result.branch}`}.`}</p>{result.branches && <ul className="published-branches">{result.branches.map(item => <li key={item.name}><a href={item.prUrl || item.url} target="_blank" rel="noreferrer">{item.name}<ExternalLink size={13} /></a>{item.prError && <span>{item.prError}</span>}</li>)}</ul>}<div className="success-actions"><button className="button primary" onClick={downloadBundle}><Download size={16} /> Download files</button>{<a className="button secondary" href={result.prUrl || result.url} target="_blank" rel="noreferrer">{result.prUrl ? 'View draft pull request' : 'View on GitHub'}<ExternalLink size={15} /></a>}<button className="button secondary" onClick={onBack}>Back to projects</button></div>{createPr && !result.prUrl && <p className="small muted">The branch was published. GitHub could not create a draft pull request; you can open one from the branch.{result.prError && <> {result.prError}</>}</p>}</div> : step === 0 ? <div className="configure-grid">
      {/* Step 0: module selection. */}
      <section className="improvements"><div className="section-title"><h2>A little polish goes a long way.</h2><p>Choose what your project needs. You’ll review everything next.</p></div><div className="module-list">{modules.map(module => {
        // Is this module unavailable (CI without checks)?
        const disabled = module.id === 'ci' && !ciAvailable(context);
        // Pick an icon for the module.
        const Icon = module.id === 'ci' ? ShieldCheck : module.id === 'editorconfig' ? Code2 : module.id === 'changelog' ? GitCommitHorizontal : FileText;
        // One module row with a checkbox.
        return <label key={module.id} className={`module-row ${selected.includes(module.id) ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}><span className="module-icon"><Icon size={19} /></span><span className="module-copy"><strong>{module.title}</strong><span>{disabled ? 'Available for npm projects with a lockfile and existing checks.' : module.description}</span></span><input type="checkbox" checked={selected.includes(module.id)} disabled={disabled} onChange={() => setSelected(list => list.includes(module.id) ? list.filter(id => id !== module.id) : [...list, module.id])} /><span className="custom-checkbox"><Check size={13} /></span></label>;
      })}</div><div className="configure-footer"><span>{selected.length} improvements · {totalFiles} files</span><button className="button primary" onClick={generate} disabled={!selected.length || busy || !!pending}>{busy ? <Spinner label="Generating…" /> : <><Sparkles size={16} /> {useAI && aiRelevant ? 'Generate with Groq' : 'Generate preview'}<ArrowRight size={15} /></>}</button></div></section>
      {/* Project checkup panel with a score and checks. */}
      <aside className="project-check"><div className="section-title"><h3>Project checkup</h3><p>A quick look at the essentials.</p></div><div className="health-score"><strong>{audit!.score}<span>/100</span></strong><span>Repository readiness</span></div><div className="health-track"><span style={{ width: `${audit!.score}%` }} /></div><ul className="check-list">{audit!.checks.map(check => <li key={check.label}><span>{check.label}</span>{check.ok ? <span className="check-good"><Check size={13} />Present</span> : <span className="check-missing">Needs attention</span>}</li>)}</ul><div className="context-note"><ShieldCheck size={17} /><p>Generated from your actual project. Every proposed commit represents a real change.</p></div></aside>
    </div> : step === 1 && plan ? <>
      {/* Review heading with a ZIP download. */}
      <div className="review-heading"><div><h2>Make it yours before you ship.</h2><p>{plan.files.length} files, organized into {plan.commits.length} meaningful commits.</p></div><button className="button secondary" onClick={downloadBundle}><Download size={15} /> Download ZIP</button></div>
      {/* File list and the file editor (copy, download, preview, source, original). */}
      <div className="editor"><aside className="file-tree"><div className="file-tree-label">Files changed <span>{plan.files.length}</span></div>{plan.files.map(f => <button key={f.path} className={`file-item ${activeFile === f.path ? 'active' : ''}`} onClick={() => { setActiveFile(f.path); setPreview('preview'); }}><FileCode2 size={15} /><span title={f.path}>{f.path}</span><span className={`file-status ${f.original === null ? 'added' : ''}`} title={f.original === null ? 'New file' : 'Modified file'}>{f.original === null ? 'A' : 'M'}</span></button>)}</aside><section className="file-view"><div className="editor-toolbar"><span className="current-file">{activeFile}</span><div className="editor-actions"><button className="icon-button" title="Copy file contents" aria-label="Copy file contents" onClick={async () => { try { await navigator.clipboard.writeText(file!.content); notify('File copied to clipboard'); } catch { notify('Clipboard unavailable. Download the file instead.'); } }}><Copy size={14} /></button><button className="icon-button" title="Download this file" aria-label="Download this file" onClick={() => downloadFile(activeFile.split('/').pop()!, file!.content)}><Download size={14} /></button></div></div><div className="preview-tabs" role="group" aria-label="File view">{(['preview', 'source', 'original'] as const).map(view => <button key={view} aria-pressed={preview === view} onClick={() => setPreview(view)}>{view === 'source' ? <Pencil size={13} /> : view === 'preview' ? <FileText size={13} /> : <GitBranch size={13} />}{view === 'preview' ? 'Preview' : view === 'source' ? 'Edit source' : 'Original'}</button>)}<span className="auto-saved">Local draft</span></div>{preview === 'source' ? <textarea className="source-editor" aria-label={`Edit ${activeFile}`} value={file!.content} onChange={e => editFile(e.target.value)} spellCheck={false} /> : preview === 'original' ? <pre className="original-content">{file!.original ?? 'This is a new file. There is no original version.'}</pre> : activeFile.endsWith('.md') ? <div className="markdown-preview"><Markdown>{file!.content}</Markdown></div> : <pre className="original-content">{file!.content}</pre>}</section></div>
      {/* Commit plan with editable messages. */}
      <section className="commit-plan"><div className="section-title"><h3><GitCommitHorizontal size={18} />A commit history that tells the story.</h3><p>Focused changes, clear messages. Edit any message before publishing.</p></div><div className="commit-rows">{plan.commits.map((commit, index) => <div className="commit-row" key={index}><span className="commit-point"><GitCommitHorizontal size={15} /></span><div><input aria-label={`Commit ${index + 1} message`} value={commit.message} onChange={e => editMessage(index, e.target.value)} maxLength={200} /><span>{commit.files.length} {commit.files.length === 1 ? 'file' : 'files'} changed</span></div><span className="commit-order">{index + 1}</span></div>)}</div></section>
      {/* Navigation buttons. */}
      <div className="step-footer"><button className="button secondary" onClick={() => setStep(0)}><ArrowLeft size={14} /> Change improvements</button><button className="button primary" onClick={() => setStep(2)} disabled={plan.commits.some(c => c.message.trim().length < 5)}>Continue to publish<ArrowRight size={15} /></button></div>
    </> : plan ? <div className="publish-grid"><section><div className="section-title"><h2>A new chapter for {repo.name}.</h2><p>Choose where your reviewed changes should go.</p></div><div className="destination-list">{([{ id: 'branch', title: 'New branch', description: 'Keep everything in your existing repository.', icon: GitBranch }, { id: 'fork', title: 'Fork this project', description: 'Create a fork in your own GitHub account.', icon: GitFork }, { id: 'new', title: 'New documentation repository', description: 'Publish these files in a separate repository. Source code is not copied.', icon: Github }] as const).map(option => <label key={option.id} className={`destination ${target === option.id ? 'selected' : ''}`}><option.icon size={20} /><span><strong>{option.title}</strong><span>{option.description}</span></span><input type="radio" name="destination" checked={target === option.id} disabled={option.id === 'new' && plan.files.some(f => f.path.startsWith('.github/workflows/'))} onChange={() => setTarget(option.id)} /></label>)}</div>{plan.files.some(f => f.path.startsWith('.github/workflows/')) && <p className="new-repo-ci-note">CI checks need the source code. Choose a branch or fork, or generate a new preview without CI to create a documentation repository.</p>}<div className="publish-fields">{target === 'new' && <><label className="field">Repository name<input value={name} onChange={e => setName(e.target.value)} maxLength={100} placeholder="my-project-docs" /></label><label className="simple-checkbox"><input type="checkbox" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)} />Create as a private repository</label></>}<label className="field">New branch name<input value={branch} onChange={e => setBranch(e.target.value)} maxLength={120} /><span>{splitBranches ? 'This is the prefix; each reviewed commit group gets a separate branch.' : 'Your changes will be published to this new branch.'}</span></label><label className="simple-checkbox"><input type="checkbox" checked={splitBranches} onChange={e => setSplitBranches(e.target.checked)} />Publish each commit group on its own branch</label><label className="simple-checkbox"><input type="checkbox" checked={createPr} onChange={e => setCreatePr(e.target.checked)} />Open a draft pull request for each branch</label><label className="simple-checkbox"><input type="checkbox" checked={fabricate} onChange={e => toggleFabricate(e.target.checked)} />Backdate commits with a fabricated author</label>{fabricate && <div className="history-fields"><div className="history-dates"><label className="field">Author name<input value={authorName} onChange={e => setAuthorName(e.target.value)} maxLength={100} placeholder="e.g. Ada Lovelace" /></label><label className="field">Author email<input value={authorEmail} onChange={e => setAuthorEmail(e.target.value)} maxLength={200} placeholder="author@example.com" /></label></div><div className="history-dates"><label className="field">Earliest commit<input type="datetime-local" value={historyFrom} onChange={e => setHistoryFrom(e.target.value)} /></label><label className="field">Latest commit<input type="datetime-local" value={historyTo} onChange={e => setHistoryTo(e.target.value)} /></label></div><p className="history-note"><History size={14} />Commits are spaced evenly between these dates under the fabricated author, reading as an established development history.</p></div>}</div><div className="step-footer"><button className="button secondary" onClick={() => setStep(1)} disabled={busy}><ArrowLeft size={14} /> Back to review</button><button className="button primary" onClick={publish} disabled={busy || !branchValid || target === 'new' && !nameValid || fabricate && !historyValid}>{busy ? <Spinner label="Publishing…" /> : <><GitBranch size={16} />Publish changes<ArrowRight size={15} /></>}</button></div></section><aside className="publish-summary"><h3>Ready to go</h3><div className="summary-repo"><Github size={20} /><strong>{repo.full_name}</strong></div><dl><div><dt>Files</dt><dd>{plan.files.length}</dd></div><div><dt>Commits</dt><dd>{plan.commits.length}</dd></div><div><dt>Destination</dt><dd>{target === 'branch' ? 'New branch' : target === 'fork' ? 'Your fork' : 'Documentation repo'}</dd></div><div><dt>Branches</dt><dd>{splitBranches ? publishGroupCount : 1}</dd></div></dl><div className="context-note"><ShieldCheck size={18} /><p>{fabricate ? 'Reviewed changes will be published under a fabricated author with backdated commit dates.' : 'Reviewed changes use your GitHub identity and are dated when published.'}</p></div></aside></div> : null}
  </div>;
}
