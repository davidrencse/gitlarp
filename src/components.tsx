// React hooks.
import { useEffect, useId, useRef, useState } from 'react';
// ReactNode type.
import type { ReactNode } from 'react';
// Icons.
import { Check, GitBranch, GitCommitHorizontal, FileText, Github, X, LoaderCircle } from 'lucide-react';

// Avatar: a letter placeholder with a GitHub image on top once loaded.
export function Avatar({ login, url }: { login: string; url: string }) {
  // Whether the image has loaded.
  const [loaded, setLoaded] = useState(false);
  // Reset when the URL changes.
  useEffect(() => { setLoaded(false); }, [url]);
  // Show the letter and the image.
  return <span className="avatar" aria-hidden="true"><span>{login.slice(0, 1).toUpperCase()}</span>{url && <img src={url} alt="" className={loaded ? 'loaded' : ''} onLoad={() => setLoaded(true)} onError={() => setLoaded(false)} />}</span>;
}

// Logo: icon plus the wordmark (hidden when small).
export function Logo({ small = false }: { small?: boolean }) {
  // Render the logo.
  return <span className={`brand ${small ? 'small' : ''}`}><span className="brand-icon"><GitBranch size={21} strokeWidth={2.6} /></span>{!small && <span>gitlarp<span className="brand-dot">.</span></span>}</span>;
}
// Inline loading spinner with a label.
export function Spinner({ label = 'Loading' }: { label?: string }) { return <span className="loading-inline"><LoaderCircle size={17} className="spinner" />{label}</span>; }
// Modal dialog built on the native dialog element.
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  // Refs for the dialog and a unique title id.
  const ref = useRef<HTMLDialogElement>(null); const titleId = useId();
  // Open the dialog on mount and close it on unmount.
  useEffect(() => { const dialog = ref.current!; if (!dialog.open) dialog.showModal(); return () => { if (dialog.open) dialog.close(); }; }, []);
  // Dialog; clicking outside the content closes it.
  return <dialog ref={ref} aria-labelledby={titleId} className={`modal ${wide ? 'wide' : ''}`} onCancel={onClose} onClick={event => { if (event.target === ref.current) { const rect = ref.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    {/* Header with the title and a close button, then the content. */}
    <div className="modal-header"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={19} /></button></div>{children}
  </dialog>;
}
// Stepper: shows progress through the three steps.
export function Stepper({ step }: { step: number }) {
  // Mark each step as current, complete, or upcoming.
  return <ol className="stepper" aria-label="Project improvement progress">{['Choose improvements', 'Review changes', 'Publish'].map((label, index) => <li key={label} className={step === index ? 'current' : step > index ? 'complete' : ''}><span>{step > index ? <Check size={13} /> : index + 1}</span>{label}</li>)}</ol>;
}
// Decorative graphic of the workflow.
export function WorkflowGraphic() {
  // A repo, connecting lines, and three checked results.
  return <div className="workflow-graphic" aria-hidden="true"><div className="graph-repo"><Github size={25} /><span>Your project</span></div><div className="graph-connections"><svg viewBox="0 0 110 150" preserveAspectRatio="none"><path d="M0 75 H35 Q50 75 50 60 V30 Q50 15 65 15 H110 M50 75 H110 M50 60 V120 Q50 135 65 135 H110" /></svg><span className="graph-node" /></div><div className="graph-files"><div><FileText size={14} /><span>README.md</span><Check size={12} /></div><div><GitCommitHorizontal size={14} /><span>Better commits</span><Check size={12} /></div><div><GitBranch size={14} /><span>Ready to ship</span><Check size={12} /></div></div></div>;
}
// Empty state with an icon, title, text, and optional action.
export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) { return <div className="empty-state"><span className="empty-icon">{icon}</span><h2>{title}</h2><p>{children}</p>{action}</div>; }

// The workspace scrolls inside its own pane in the app shell, and the window scrolls on narrow screens.
// Scroll the workspace and the window to the top.
export function scrollToTop() { document.getElementById('main-content')?.scrollTo({ top: 0 }); window.scrollTo({ top: 0 }); }
