// React lazy loading.
import { lazy, Suspense } from 'react';
// Load the Markdown renderer only when it is needed.
const loadRenderer = () => Promise.all([import('react-markdown'), import('remark-gfm')]).then(([{ default: Markdown }, { default: remarkGfm }]) => ({ default: ({ children }: { children: string }) => <Markdown remarkPlugins={[remarkGfm]} components={{ a: props => <a {...props} target="_blank" rel="noreferrer" /> }}>{children}</Markdown> }));
const Renderer = lazy(loadRenderer);
// Warm the renderer when the documentation page opens, before a file is picked.
export function preloadMarkdown() { void loadRenderer(); }
// Markdown component with a loading fallback.
export default function Markdown({ children }: { children: string }) { return <Suspense fallback={<p role="status">Loading preview…</p>}><Renderer>{children}</Renderer></Suspense>; }
