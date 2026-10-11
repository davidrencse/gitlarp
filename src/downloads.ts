// Plan type.
import type { Plan } from '../shared/types';
// Save a Blob as a file by clicking a temporary link.
function save(blob: Blob, filename: string) {
  // Create a URL and an anchor, then click it.
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  // Free the URL after one second.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Download text content as a file.
export function downloadFile(filename: string, content: string) { save(new Blob([content], { type: 'text/plain;charset=utf-8' }), filename); }
// Download a plan as a ZIP.
export async function downloadPlan(plan: Plan) {
  // Load JSZip on demand and create an archive.
  const { default: JSZip } = await import('jszip'); const zip = new JSZip();
  // Add every generated file.
  plan.files.forEach(file => zip.file(file.path, file.content));
  // Add a JSON description of the commit plan.
  zip.file('gitlarp-commit-plan.json', JSON.stringify({ source: plan.repo.full_name, base: plan.head, commits: plan.commits, note: 'These are proposed commits. Publishing can optionally backdate them under a fabricated author for an established-looking history.' }, null, 2));
  // Generate the ZIP and save it.
  save(await zip.generateAsync({ type: 'blob' }), `${plan.repo.name}-improvements.zip`);
}
