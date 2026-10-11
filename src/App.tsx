// React hooks used by the app.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Icons from lucide-react.
import { ArrowLeft, ArrowRight, BookOpen, Check, CircleHelp, Download, ExternalLink, FileText, FolderGit2, GitBranch, GitCommitHorizontal, GitFork, Github, LayoutGrid, List, LockKeyhole, LogOut, Menu, Pause, Play, Plus, Radio, RefreshCw, Search, Settings2, ShieldCheck, Star, X } from 'lucide-react';
// Type of an icon component.
import type { LucideIcon } from 'lucide-react';
// Shared data types.
import type { AIReport, Plan, PublishResult, Repo, User } from '../shared/types';
// Repository-name validation (shared with the server).
import { validRepoName } from '../shared/validation';
// Helper that scrolls the page to the top.
import { scrollToTop } from './components';
// API helpers (JSON requests with CSRF; fetch the session).
import { api, getSession } from './api';
// Small shared UI components.
import { Avatar, Empty, Logo, Modal, Spinner } from './components';
// Sign-in screen.
import AuthGate from './AuthGate';
// Animated glass background.
import LiquidBackdrop from './LiquidBackdrop';
// Markdown renderer.
import Markdown, { preloadMarkdown } from './Markdown';
// Helpers to download one file or a ZIP of a plan.
import { downloadFile, downloadPlan } from './downloads';
// Read saved preferences and activity from localStorage.
import { readActivities, readPreference } from './storage';
// Activity type.
import type { Activity } from './storage';

// The project workbench is loaded lazily (code-splitting) when a project is opened.
const loadWorkbench = () => import('./Workbench');
const Workbench = lazy(loadWorkbench);
// The top-level pages of the app.
type View = 'projects' | 'docs' | 'history' | 'activity' | 'settings';
// Sidebar navigation items (settings is reached through other buttons).
const navigation: { id: View; label: string; icon: LucideIcon }[] = [
  // Projects and Documentation entries.
  { id: 'projects', label: 'Projects', icon: FolderGit2 }, { id: 'docs', label: 'Documentation', icon: BookOpen },
  // Commit plan and Activity entries.
  { id: 'history', label: 'Commit plan', icon: GitCommitHorizontal }, { id: 'activity', label: 'Activity', icon: Radio },
];
// Turn a date string into text like "today" or "3 days ago".
function relativeDate(value: string) {
  // Parse the date; fall back to "recently" if invalid.
  const stamp = Date.parse(value); if (!Number.isFinite(stamp)) return 'recently';
  // Whole days between now and the date.
  const days = Math.max(0, Math.floor((Date.now() - stamp) / 86400000));
  // Choose the wording.
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}
// Read the saved "visual effects" setting (default on; safe if storage is blocked).
function initialEffects() { try { return localStorage.getItem('gitlarp.effects') !== 'false'; } catch { return true; } }

// The root component: sign-in state, navigation, project list, and every page.
export default function App() {
  // The signed-in GitHub user (null when signed out).
  const [user, setUser] = useState<User | null>(null);
  // Session state: OAuth configured, local gh login, session loaded, and any load error.
  const [configured, setConfigured] = useState(false); const [localLogin, setLocalLogin] = useState<string | null>(null); const [sessionReady, setSessionReady] = useState(false); const [sessionError, setSessionError] = useState('');
  // Repository list, loading flag, and error text.
  const [repos, setRepos] = useState<Repo[]>([]); const [repoLoading, setRepoLoading] = useState(false); const [repoError, setRepoError] = useState('');
  // Current page and the selected project.
  const [view, setView] = useState<View>('projects'); const [project, setProject] = useState<Repo | null>(null);
  // Project list controls: search text, filter, sort order, and grid/list layout.
  const [search, setSearch] = useState(''); const [filter, setFilter] = useState('all'); const [sort, setSort] = useState('updated'); const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  // Whether the mobile navigation drawer is open.
  const [mobileNav, setMobileNav] = useState(false);
  // Whether the screen is narrow (mobile layout).
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 760px)').matches);
  // Refs to the menu button and sidebar (for focus handling).
  const menuRef = useRef<HTMLButtonElement>(null); const sidebarRef = useRef<HTMLElement>(null);
  // Close the mobile menu and return focus to its button; also toast text and open modal.
  const closeMobileNav = useCallback(() => { setMobileNav(false); menuRef.current?.focus(); }, []); const [toast, setToast] = useState(''); const [modal, setModal] = useState<'new' | 'help' | null>(null);
  // Generated plans and AI reports kept for this browser session.
  const [plans, setPlans] = useState<Plan[]>([]); const [reports, setReports] = useState<{ repo: number; report: AIReport }[]>([]);
  // AI settings from the server and the published-activity list.
  const [ai, setAI] = useState({ configured: false, model: 'openai/gpt-oss-120b' }); const [activities, setActivities] = useState<Activity[]>([]);
  // The document currently shown on the Documentation page.
  const [document, setDocument] = useState<{ key: string; path: string; content: string } | null>(null);
  // Preference: open draft pull requests by default; and the visual-effects setting.
  const [defaultPr, setDefaultPr] = useState(readPreference); const [effects, setEffects] = useState(initialEffects);
  // New-repository form state.
  const [creating, setCreating] = useState(false); const [newName, setNewName] = useState(''); const [newDescription, setNewDescription] = useState(''); const [newPrivate, setNewPrivate] = useState(true); const [newError, setNewError] = useState('');
  // True while signing out.
  const [signingOut, setSigningOut] = useState(false);
  // Ref holding the current login (so async callbacks can detect account changes).
  const account = useRef<string | null>(null); account.current = user?.login || null;
  // Refs for tracking repo requests: request counter, abort controller, and search input.
  const repoRequest = useRef(0); const repoAbort = useRef<AbortController | null>(null); const searchRef = useRef<HTMLInputElement>(null);

  // Track the mobile breakpoint (max-width 760px) and close the drawer on wide screens.
  useEffect(() => { const media = matchMedia('(max-width: 760px)'); const update = () => { setNarrow(media.matches); if (!media.matches) setMobileNav(false); }; media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  // When the mobile drawer opens, focus its first button.
  useEffect(() => { if (narrow && mobileNav) sidebarRef.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [narrow, mobileNav]);

  // Load the session from the server (user, config, AI settings).
  const refreshSession = useCallback(async () => {
    // On success, store the user and settings.
    try { const data = await getSession(); setUser(data.user); setConfigured(data.configured); setAI(data.ai || { configured: false, model: 'openai/gpt-oss-120b' }); setLocalLogin(data.localLogin || null); setSessionError(''); }
    // On failure, store the error message.
    catch (error) { setSessionError((error as Error).message); }
    // Always mark the session as loaded.
    finally { setSessionReady(true); }
  }, []);
  // On startup: load the session and handle OAuth return parameters.
  useEffect(() => {
    // Load the session and read the URL query.
    void refreshSession(); const params = new URLSearchParams(location.search);
    // OAuth error: show a message and clean the URL.
    if (params.has('auth_error')) { setToast('GitHub sign-in did not finish. Check OAuth settings or connect with a token.'); history.replaceState({}, '', '/'); }
    // OAuth success: show a message and clean the URL.
    if (params.has('connected')) { setToast('GitHub connected. Loading your repositories.'); history.replaceState({}, '', '/'); }
  }, [refreshSession]);
  // Load every page of the user's repositories.
  async function loadRepos() {
    // Do nothing when signed out.
    if (!account.current) return;
    // Cancel any in-flight load and start a new one.
    repoAbort.current?.abort(); const controller = new AbortController(); repoAbort.current = controller;
    // Track this request so stale responses are ignored; show the loading state.
    const requestId = ++repoRequest.current; setRepoLoading(true); setRepoError('');
    // Fetch pages in a loop.
    try {
      // Accumulate repos across pages.
      const all: Repo[] = []; let page = 1; let hasMore = true;
      // Continue while more pages exist and the request was not cancelled.
      while (hasMore && !controller.signal.aborted) {
        // Fetch the next page.
        const result = await api<{ repos: Repo[]; hasMore: boolean }>(`/api/repos?page=${page++}`, undefined, { signal: controller.signal });
        // Append results and remember whether more pages remain.
        all.push(...result.repos); hasMore = result.hasMore;
        // Show the first repository page immediately while later pages load.
        if (requestId === repoRequest.current && !controller.signal.aborted) setRepos([...new Map(all.map(repo => [repo.id, repo])).values()]);
        // Safety limit against endless pagination.
        if (page > 10000 && hasMore) throw new Error('Repository pagination limit reached.');
      }
      // Deduplicate by id and save, unless this request became stale.
      if (requestId === repoRequest.current && !controller.signal.aborted) setRepos([...new Map(all.map(repo => [repo.id, repo])).values()]);
    // Show errors only for the latest, non-cancelled request.
    } catch (error) { if (requestId === repoRequest.current && !controller.signal.aborted) setRepoError((error as Error).message); }
    // Stop the loading state for the latest request.
    finally { if (requestId === repoRequest.current) setRepoLoading(false); }
  }
  // When the signed-in account changes, reset all per-account state and reload repos.
  useEffect(() => {
    // Clear projects, plans, reports, documents, repos, modal, view, and errors.
    repoRequest.current++; setProject(null); setPlans([]); setReports([]); setDocument(null); setRepos([]); setModal(null); setView('projects'); setRepoError('');
    // Load this user's saved activity from localStorage.
    setActivities(user ? readActivities(`gitlarp.activity.${user.login}`) : []);
    // Load repos when signed in.
    if (user) void loadRepos(); else setRepoLoading(false);
    // On cleanup, cancel in-flight requests.
    return () => { repoAbort.current?.abort(); repoRequest.current++; };
  }, [user?.login]);
  // Handle session expiry events raised by the API helper.
  useEffect(() => {
    // Sign out locally, show a message, and refresh the session.
    const expired = () => { setUser(null); setToast('Your GitHub connection expired. Sign in again to continue.'); void refreshSession(); };
    // Register and remove the event listener.
    window.addEventListener('gitlarp:session-expired', expired); return () => window.removeEventListener('gitlarp:session-expired', expired);
  }, [refreshSession]);
  // Auto-dismiss toast messages after 6.5 seconds.
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 6500); return () => clearTimeout(timer); }, [toast]);
  // Keyboard shortcuts.
  useEffect(() => {
    // Key handler.
    const keyboard = (event: KeyboardEvent) => {
      // Ctrl/Cmd+K focuses the repository search.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && account.current) { event.preventDefault(); setView('projects'); setProject(null); setTimeout(() => searchRef.current?.focus(), 0); }
      // Escape closes the mobile menu.
      if (event.key === 'Escape' && menuRef.current?.getAttribute('aria-expanded') === 'true') closeMobileNav();
    };
    // Register and remove the listener.
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, []);
  // Toggle visual effects and save the choice.
  function toggleEffects() { setEffects(value => { try { localStorage.setItem('gitlarp.effects', String(!value)); } catch {} return !value; }); }
  // Navigate to a page and close the mobile menu.
  function navigate(next: View) { if (next === 'docs') preloadMarkdown(); setView(next); setProject(null); if (mobileNav) closeMobileNav(); }
  // Open a project in the workbench.
  function selectRepo(repo: Repo) { setProject(repo); setView('projects'); setMobileNav(false); scrollToTop(); }
  // Save an AI report (max 10) for the current account.
  function saveReport(repo: number, report: AIReport) { if (account.current !== user?.login) return; setReports(list => [{ repo, report }, ...list.filter(item => item.repo !== repo)].slice(0, 10)); }
  // Save or update a plan (max 10) for the current account.
  function savePlan(plan: Plan) { if (account.current !== user?.login) return; setPlans(list => [plan, ...list.filter(item => item.id !== plan.id)].slice(0, 10)); }
  // Record a publish in the activity log.
  function published(plan: Plan, result: PublishResult) {
    // Ignore if the account changed meanwhile.
    if (!user || account.current !== user.login) return;
    // Build the activity entry.
    const activity: Activity = { id: plan.id, project: plan.repo.full_name, files: result.files, commits: result.commits, date: new Date().toISOString(), url: result.prUrl || result.url };
    // Save the newest 50 entries in state and localStorage.
    setActivities(list => { const next = [activity, ...list.filter(item => item.id !== activity.id)].slice(0, 50); try { localStorage.setItem(`gitlarp.activity.${user.login}`, JSON.stringify(next)); } catch {} return next; });
  }
  // Download the plan as a ZIP, showing a toast on error.
  function downloadBundle(plan: Plan) { void downloadPlan(plan).catch(error => setToast(`Download failed. ${(error as Error).message}`)); }
  // Sign out of GitHub.
  async function logout() {
    // Ignore repeated clicks.
    if (signingOut) return; setSigningOut(true);
    // Call the API, clear the user, refresh the session, and show a message.
    try { await api('/api/logout', {}); setUser(null); await refreshSession(); setToast('GitHub disconnected.'); }
    // Show errors and reset the flag.
    catch (error) { setToast((error as Error).message); } finally { setSigningOut(false); }
  }
  // Create a new repository from the modal form.
  async function createRepo(event: React.FormEvent) {
    // Validate the name before submitting.
    event.preventDefault(); if (!validRepoName(newName) || creating) return; setCreating(true); setNewError('');
    // Send the request.
    try {
      // Create the repository through the API.
      const repo = await api<Repo>('/api/repositories', { name: newName, description: newDescription, private: newPrivate });
      // Ignore if the account changed meanwhile.
      if (account.current !== user?.login) return;
      // Add it to the list, close the modal, reset the form, and open it.
      setRepos(list => [repo, ...list]); setModal(null); setNewName(''); setNewDescription(''); setToast('Repository created on GitHub.'); selectRepo(repo);
    // Show errors and reset the flag.
    } catch (error) { setNewError((error as Error).message); } finally { setCreating(false); }
  }
  // Apply the search, filter, and sort to the repository list.
  const filtered = useMemo(() => {
    // Normalized search text.
    const query = search.trim().toLowerCase();
    // Match the query in name or description, and apply the visibility/ownership filter.
    return repos.filter(repo => `${repo.full_name} ${repo.description || ''}`.toLowerCase().includes(query) && (filter === 'all' || filter === 'private' && repo.private || filter === 'public' && !repo.private || filter === 'owned' && repo.owner.login === user?.login))
      // Sort by name, stars, or most recent push (default).
      .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'stars' ? b.stargazers_count - a.stargazers_count : Date.parse(b.pushed_at || b.updated_at) - Date.parse(a.pushed_at || a.updated_at));
  }, [repos, search, filter, sort, user?.login]);
  // Flatten all generated files from all plans for the Documentation page.
  const docs = useMemo(() => plans.flatMap(plan => plan.files.map(file => ({ ...file, repository: plan.repo.full_name, planId: plan.id, key: `${plan.id}:${file.path}` }))), [plans]);
  // Page title for the title bar and breadcrumb.
  const title = project?.name || (view === 'docs' ? 'Documentation' : view === 'history' ? 'Commit plan' : view === 'settings' ? 'Settings' : view === 'activity' ? 'Activity' : 'Projects');
  // Button that pauses or resumes the visual effects.
  const effectsButton = <button className="icon-button effects-button" onClick={toggleEffects} aria-label={effects ? 'Pause visual effects' : 'Resume visual effects'} title={effects ? 'Pause visual effects' : 'Resume visual effects'}>{effects ? <Pause size={16} /> : <Play size={16} />}</button>;

  // Render the layout: backdrop, skip link, title bar, then either the sign-in screen or the workspace.
  return <div className={`app-shell ${user ? 'signed-in' : 'signed-out'}`}>
    {/* Animated background; it only runs when effects are enabled. */}
    <LiquidBackdrop playing={effects} workspace={!!user} />
    {/* Accessibility link to skip to the main content. */}
    <a className="skip-link" href="#main-content">Skip to content</a>
    {/* Desktop title bar with the brand and breadcrumb. */}
    <header className="titlebar"><span className="titlebar-brand"><Logo small />GitLarp</span><span className="titlebar-path">{user ? <><span>{user.login}</span><span className="breadcrumb-slash">/</span><strong>{title}</strong></> : <strong>Connect GitHub</strong>}</span><span className="titlebar-actions">{user && <span className="connected-status"><span />Connected</span>}{effectsButton}</span></header>
    {/* Signed-out view. */}
    {!user ? <>
      {/* Header with the logo and effects button. */}
      <header className="connection-header"><Logo /><div className="connection-header-actions">{effectsButton}<span className="secure-label"><LockKeyhole size={13} />A private workspace</span></div></header>
      {/* Sign-in component; it reports back with the connected profile. */}
      <AuthGate ready={sessionReady} configured={configured} localLogin={localLogin} sessionError={sessionError} retry={() => void refreshSession()} onConnected={profile => { setUser(profile); setToast(`Connected as ${profile.login}.`); }} />
    {/* Signed-in view. */}
    </> : <>
      {/* On mobile, a scrim that closes the navigation when clicked. */}
      {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={closeMobileNav} tabIndex={-1} />}
      {/* Sidebar navigation (hidden from assistive tech when off-screen on mobile). */}
      <aside id="workspace-navigation" ref={sidebarRef} className={`sidebar ${mobileNav ? 'mobile-open' : ''}`} inert={narrow && !mobileNav} aria-hidden={narrow && !mobileNav ? true : undefined}>
        {/* Logo button returning to Projects. */}
        <button className="brand-link" onClick={() => navigate('projects')} aria-label="Go to projects"><Logo /></button>
        {/* Workspace switch: shows the user and opens Settings. */}
        <button className="workspace-switch" onClick={() => navigate('settings')}><Avatar login={user.login} url={user.avatar_url} /><span className="workspace-label">{user.login}<small>GitHub workspace</small></span><Settings2 size={15} /></button>
        {/* Main navigation buttons with the repository count. */}
        <nav aria-label="Workspace navigation">{navigation.map(item => <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} aria-current={view === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon size={17} /><span>{item.label}</span>{item.id === 'projects' && <span className="nav-count">{repos.length}</span>}</button>)}</nav>
        {/* Bottom of the sidebar: tip, Settings, Help, and Disconnect. */}
        <div className="sidebar-bottom"><p><ShieldCheck size={16} />Review before publishing.<br />Keep every commit meaningful.</p><button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings2 size={17} />Settings</button><button className="nav-item" onClick={() => setModal('help')}><CircleHelp size={17} />Help & getting started</button><button className="nav-item disconnect-button" onClick={() => void logout()} disabled={signingOut}><LogOut size={17} />{signingOut ? 'Disconnecting…' : 'Disconnect GitHub'}</button></div>
      </aside>
      {/* Main area. */}
      <div className="main-shell">
        {/* Top bar: mobile menu button, breadcrumb, effects, status, and avatar. */}
        <header className="topbar"><div className="breadcrumb"><button ref={menuRef} className="icon-button mobile-menu" aria-label="Open navigation" aria-controls="workspace-navigation" aria-expanded={mobileNav} onClick={() => mobileNav ? closeMobileNav() : setMobileNav(true)}><Menu size={20} /></button><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{title}</strong></div><div className="topbar-actions">{effectsButton}<span className="connected-status"><span />GitHub connected</span><button className="topbar-avatar" aria-label="Account settings" onClick={() => navigate('settings')}><Avatar login={user.login} url={user.avatar_url} /></button></div></header>
        {/* Main content, one page at a time. */}
        <main id="main-content" className="main-content">
          {/* Open project (workbench) or the pages below. */}
          {project ? <Suspense fallback={<div className="loading-panel"><Spinner label="Opening project…" /></div>}><Workbench key={project.id} repo={project} aiConfigured={ai.configured} aiModel={ai.model} initialReport={reports.find(item => item.repo === project.id)?.report} onReport={report => saveReport(project.id, report)} initialPlan={plans.find(plan => plan.repo.id === project.id && Date.now() - Date.parse(plan.createdAt) < 30 * 60_000 && !activities.some(activity => activity.id === plan.id))} onBack={() => setProject(null)} onSave={savePlan} onPublish={published} notify={setToast} defaultPr={defaultPr} /></Suspense> : view === 'projects' ? <>
            {/* Projects page heading and New-repository button. */}
            <div className="page-heading"><div><h1>Your projects.</h1><p>The work is yours. Give it the presentation it deserves.</p></div><button className="button primary" onClick={() => { setNewError(''); setModal('new'); }}><Plus size={16} />New repository</button></div>
            {/* Repository section. */}
            <section aria-label="Your repositories">
              <div className="library-heading"><div><h2>Repositories</h2><p>Open a project to inspect it and prepare reviewed changes.</p></div><span className="library-count" aria-live="polite">{repoLoading ? 'Syncing repositories' : `${repos.length} available`}</span></div>
              {/* Toolbar: search, filter, sort, grid/list toggle, and refresh. */}
              <div className="repo-toolbar"><div className="search-field"><Search size={17} /><input ref={searchRef} value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a repository…" aria-label="Search projects" />{search ? <button className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button> : <kbd>Ctrl K</kbd>}</div><select aria-label="Filter repositories" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All repositories</option><option value="owned">Owned by me</option><option value="public">Public</option><option value="private">Private</option></select><select aria-label="Sort projects" value={sort} onChange={event => setSort(event.target.value)}><option value="updated">Recently updated</option><option value="name">Name A–Z</option><option value="stars">Most stars</option></select><div className="view-toggle"><button className={`icon-button ${layout === 'grid' ? 'active' : ''}`} aria-label="Grid view" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}><LayoutGrid size={16} /></button><button className={`icon-button ${layout === 'list' ? 'active' : ''}`} aria-label="List view" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><List size={16} /></button></div><button className="icon-button" aria-label="Refresh repositories" onClick={() => void loadRepos()} disabled={repoLoading}><RefreshCw size={16} className={repoLoading ? 'spinner' : ''} /></button></div>
              {/* Error banner with Retry. */}
              {repoError && <div className="error-banner" role="alert">{repoError}<button className="text-button" onClick={() => void loadRepos()}>Try again</button></div>}
              {/* Loading skeletons, repository cards, or an empty state. */}
              {repoLoading && !repos.length ? <div className="repo-grid" aria-busy="true" aria-label="Loading repositories">{[0, 1, 2].map(index => <div key={index} className="repo-skeleton glass"><span /><span /><span /><span /></div>)}<p className="sr-only" role="status">Loading repositories.</p></div> : filtered.length ? <><div className={`repo-grid ${layout === 'list' ? 'list-layout' : ''}`}>{filtered.map(repo => <article className="repo-card glass" key={repo.id}><div className="repo-card-top"><FolderGit2 size={23} strokeWidth={1.5} /><span className="visibility">{repo.private ? <><LockKeyhole size={11} />Private</> : 'Public'}</span><a className="icon-button" href={repo.html_url} target="_blank" rel="noreferrer" aria-label={`View ${repo.name} on GitHub`}><ExternalLink size={15} /></a></div><small className="repo-owner">{repo.owner.login}</small><button className="repo-name" onMouseEnter={() => void loadWorkbench()} onFocus={() => void loadWorkbench()} onClick={() => selectRepo(repo)}>{repo.name}<ArrowRight size={16} /></button><p className="repo-description">{repo.description || 'Add a clear introduction when you improve this repository.'}</p><div className="repo-meta"><span>{repo.language || 'No primary language'}</span><span><Star size={13} />{repo.stargazers_count.toLocaleString()}</span><span><GitFork size={13} />{repo.forks_count.toLocaleString()}</span></div><div className="repo-card-bottom"><span>{repo.archived ? 'Archived' : repo.permissions?.push ? 'Write access' : 'Read access'}</span><span>Updated {relativeDate(repo.pushed_at || repo.updated_at)}</span></div></article>)}</div>{repoLoading && <p className="repo-loading-more" role="status">Showing {repos.length} {repos.length === 1 ? 'repository' : 'repositories'} · loading more…</p>}</> : repoLoading ? <p className="repo-loading-more" role="status">Loading repositories…</p> : <Empty icon={<Search size={28} />} title={search || filter !== 'all' ? 'No projects found' : 'Your next project starts here'} action={search || filter !== 'all' ? <button className="button secondary" onClick={() => { setSearch(''); setFilter('all'); }}>Clear filters</button> : <button className="button primary" onClick={() => setModal('new')}><Plus size={16} />Create a repository</button>}>{search || filter !== 'all' ? 'Try another name or choose a different filter.' : 'Create a repository or check that your token has access to your existing projects.'}</Empty>}
              {/* Footer showing the number of repositories shown. */}
              <div className="repo-list-footer"><span>{filtered.length} of {repos.length} repositories</span><span><ShieldCheck size={13} />Changes are reviewed before publishing</span></div>
            </section>
          </> : view === 'docs' ? <>
            {/* Documentation page heading with a ZIP download of the latest plan. */}
            <div className="page-heading"><div><h1>Documentation.</h1><p>Your reviewed files, together in one place.</p></div>{plans[0] && <button className="button secondary" onClick={() => downloadBundle(plans[0])}><Download size={15} />Download latest bundle</button>}</div>
            {/* Document list and preview, or an empty state. */}
            {docs.length ? <div className="document-layout glass"><div className="document-list">{docs.map(file => <button key={file.key} className={document?.key === file.key ? 'active' : ''} onClick={() => setDocument({ key: file.key, path: `${file.repository}/${file.path}`, content: file.content })}><FileText size={16} /><span><strong>{file.path}</strong><small>{file.repository}</small></span></button>)}</div><section className="document-view">{document ? <><div className="editor-toolbar"><span>{document.path}</span><button className="icon-button" aria-label="Download document" onClick={() => downloadFile(document.path.split('/').pop()!, document.content)}><Download size={15} /></button></div><div className="markdown-preview"><Markdown>{document.content}</Markdown></div></> : <Empty icon={<BookOpen size={30} />} title="Pick a file to preview">Your generated documentation is ready to read.</Empty>}</section></div> : <Empty icon={<BookOpen size={30} />} title="Good documentation starts here." action={<button className="button primary" onClick={() => navigate('projects')}>Choose a project<ArrowRight size={15} /></button>}>Generate a README, setup guide, or contributor guide from one of your repositories.</Empty>}
          </> : view === 'history' ? <>
            {/* Commit plan page heading. */}
            <div className="page-heading"><div><h1>Commit plan.</h1><p>Focused changes that explain how your project improves.</p></div></div>
            {/* List each plan's proposed commits, or an empty state. */}
            {plans.length ? plans.map(plan => <section key={plan.id} className="history-section glass"><div className="history-heading"><h2><GitBranch size={17} />{plan.repo.full_name}</h2><span className="tag">Proposed commits</span></div>{plan.commits.map((commit, index) => <div className="history-row" key={index}><GitCommitHorizontal size={18} /><div><strong>{commit.message}</strong><small>{commit.files.join(', ')}</small></div><span>{commit.files.length} files</span></div>)}</section>) : <Empty icon={<GitCommitHorizontal size={30} />} title="A clear history starts with a plan." action={<button className="button primary" onClick={() => navigate('projects')}>Choose a project<ArrowRight size={15} /></button>}>Generate improvements to see their proposed commits. Publishing creates these commits on a new branch.</Empty>}
          </> : view === 'activity' ? <>
            {/* Activity page heading. */}
            <div className="page-heading"><div><h1>Activity.</h1><p>The changes you have actually published.</p></div></div>
            {/* List of published changes, or an empty state. */}
            {activities.length ? <div className="activity-list glass">{activities.map(activity => <div className="activity-row" key={activity.id}><span className="activity-check"><Check size={18} /></span><div><strong>{activity.project}</strong><p>{activity.files} files · {activity.commits} commits published</p></div><time dateTime={activity.date}>{relativeDate(activity.date)}</time>{activity.url && <a className="icon-button" href={activity.url} target="_blank" rel="noreferrer" aria-label="View published changes"><ExternalLink size={16} /></a>}</div>)}</div> : <Empty icon={<Radio size={30} />} title="Your next improvement belongs here." action={<button className="button primary" onClick={() => navigate('projects')}>Choose a project<ArrowRight size={15} /></button>}>Complete the review-and-publish flow to start your activity log.</Empty>}
          </> : <>
            {/* Settings page heading. */}
            <div className="page-heading"><div><h1>Settings.</h1><p>A workspace that works the way you do.</p></div></div>
            {/* GitHub connection section with a Disconnect button. */}
            <section className="settings-section glass"><h2>GitHub connection</h2><div className="settings-connection"><Github size={28} /><div><strong>Connected as {user.login}</strong><p>Only repositories available to your account and token appear here.</p></div><button className="button secondary" disabled={signingOut} onClick={() => void logout()}>{signingOut ? <Spinner label="Disconnecting…" /> : 'Disconnect'}</button></div><p className="permissions-note"><ShieldCheck size={16} />Tokens stay in server memory. Reconnect after 30 minutes of inactivity or eight hours.</p></section>
            {/* Publishing preferences: draft pull requests toggle (saved to localStorage). */}
            <section className="settings-section glass"><h2>Publishing preferences</h2><div className="setting-row"><div><strong>Open draft pull requests</strong><p>Create a draft for review after publishing the branch.</p></div><button role="switch" aria-checked={defaultPr} aria-label="Open draft pull requests by default" className={`toggle ${defaultPr ? 'on' : ''}`} onClick={() => { setDefaultPr(!defaultPr); try { localStorage.setItem('gitlarp.defaultPr', String(!defaultPr)); } catch {} }}><span /></button></div></section>
            {/* Visual effects toggle. */}
            <section className="settings-section glass"><h2>Visual effects</h2><div className="setting-row"><div><strong>Liquid glass motion</strong><p>Automatically still when your device requests reduced motion.</p></div><button role="switch" aria-checked={effects} aria-label="Liquid glass motion" className={`toggle ${effects ? 'on' : ''}`} onClick={toggleEffects}><span /></button></div></section>
          </>}
          {/* Footer. */}
          <footer className="app-footer"><span>Your work, thoughtfully presented.</span><span>GitLarp</span></footer>
        </main>
      </div>
    </>}
    {/* Toast notification. */}
    {toast && <div className="toast glass" role="status"><span>{toast}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}><X size={15} /></button></div>}
    {/* Create-repository modal. */}
    {modal === 'new' && user && <Modal title="Create a repository" onClose={() => { if (!creating) setModal(null); }}><p>A real repository in your GitHub account, ready for its first project.</p><form onSubmit={createRepo}><label className="field">Repository name<input autoFocus required value={newName} onChange={event => setNewName(event.target.value)} maxLength={100} placeholder="my-next-project" /></label><label className="field">Description <span className="optional">optional</span><textarea value={newDescription} onChange={event => setNewDescription(event.target.value)} maxLength={350} rows={3} placeholder="What are you building?" /></label><label className="simple-checkbox"><input type="checkbox" checked={newPrivate} onChange={event => setNewPrivate(event.target.checked)} />Keep this repository private</label>{newError && <div className="error-banner" role="alert">{newError}</div>}<div className="modal-footer"><button className="button primary" type="submit" disabled={creating || !validRepoName(newName)}>{creating ? <Spinner label="Creating on GitHub…" /> : <><Plus size={15} />Create repository</>}</button><button className="button secondary" type="button" disabled={creating} onClick={() => setModal(null)}>Cancel</button></div></form></Modal>}
    {/* Help modal explaining the three steps. */}
    {modal === 'help' && <Modal title="From repository to ready" onClose={() => setModal(null)}><ol className="help-steps"><li><strong>Choose a project</strong><p>Select a repository accessible through your GitHub connection.</p></li><li><strong>Review the changes</strong><p>Generate documentation and templates, edit every file, and refine the commit messages.</p></li><li><strong>Publish</strong><p>Create a new branch, fork, or documentation repository. GitHub must confirm the result before it appears in Activity.</p></li></ol><p className="permissions-note"><ShieldCheck size={17} />The original branch and existing history stay intact.</p><div className="modal-footer"><button className="button primary" onClick={() => { setModal(null); navigate('projects'); }}>Choose a project<ArrowRight size={15} /></button></div></Modal>}
  </div>;
}
