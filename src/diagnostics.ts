import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Page } from 'playwright';
import type { OperationError } from './runtime.js';

export function redact(text: string): string {
  return text.replace(/\b[A-Za-z0-9_-]{24,}(?:\.[A-Za-z0-9_-]+)*\b/g, '[REDACTED]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[EMAIL]')
    .replace(/\b\d{6}\b/g, '[CODE]');
}

export async function saveDiagnostics(page: Page | undefined, error: OperationError): Promise<void> {
  const root = path.join(process.env.DATA_DIR || process.cwd(), 'diagnostics');
  const folder = path.join(root, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  try {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const safeUrl = (url: string) => { try { const parsed = new URL(url); return parsed.origin + parsed.pathname; } catch { return ''; } };
    await writeFile(path.join(folder, 'metadata.json'), JSON.stringify({
      code: error.code, time: new Date().toISOString(), url: safeUrl(page?.url() ?? ''),
      frames: page?.frames().map(frame => safeUrl(frame.url())) ?? [],
    }, null, 2), { mode: 0o600 });
    if (page && !page.isClosed()) {
      // Keep only element structure and UI labels; never serialize arbitrary text, attributes or scripts.
      const structures = [];
      for (const frame of page.frames()) {
        const structure = await frame.evaluate(String.raw`(() => {
        const body = document.body;
        function describe(element, depth) {
          if (depth > 12 || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(element.tagName)) return null;
          const sensitive = element.matches('input, textarea, .limit-name, [data-field="token"], [data-column="token"]');
          return {
            tag: element.tagName.toLowerCase(), role: element.getAttribute('role'),
            id: sensitive ? undefined : element.id || undefined,
            classes: sensitive ? undefined : element.getAttribute('class') || undefined,
            field: element.getAttribute('data-field') || element.getAttribute('data-column') || undefined,
            label: sensitive ? '[REDACTED]' : element.matches('button, th, [role="columnheader"], [role="dialog"] h1, [role="dialog"] h2')
              ? element.textContent?.slice(0, 200) : undefined,
            children: sensitive ? [] : Array.from(element.children).slice(0, 100).map(child => describe(child, depth + 1)).filter(Boolean),
          };
        }
        const alerts = Array.from(document.querySelectorAll('.form-message-wrapper, .error, [role="alert"]'))
          .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
          .map(element => ({ role: element.getAttribute('role'), text: element.textContent?.trim().slice(0, 500) }))
          .filter(alert => alert.text);
        return { tree: describe(body, 0), alerts };
      })()`).catch(() => null);
        structures.push({ url: safeUrl(frame.url()), structure });
      }
      await writeFile(path.join(folder, 'structure.json'), redact(JSON.stringify(structures, null, 2)), { mode: 0o600 });
      // Hide all ordinary text and form values in the image; retain buttons, headings and layout.
      await page.screenshot({ path: path.join(folder, 'page.png'), timeout: 2_000, mask: [page.locator('input, textarea, td, [role="cell"], .limit-name, p, label, [data-field], [data-column]')],
        style: '* { color: transparent !important; text-shadow: none !important; } button, th, h1, h2, h3 { color: #222 !important; }' });
    }
  } catch (failure) {
    console.error('⚠️ 无法完整保存页面诊断:', failure instanceof Error ? failure.name : 'unknown');
  } finally {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const old = entries.filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(entry.name)).map(entry => entry.name).sort().slice(0, -20);
    await Promise.all(old.map(name => rm(path.join(root, name), { recursive: true, force: true })));
  }
}
