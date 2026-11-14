/** Read-only portal inspection using the local acceptance session. No create/revoke actions. */
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { withBrowser } from '../src/runtime.js';
import { createHash } from 'node:crypto';
import { writeTokenFile } from '../src/results.js';
import { readTokenPage, assertNoAccessBlock, waitForTokenList, findToken, parseTokenDate, isExpired } from '../src/token-list.js';
import { saveDiagnostics } from '../src/diagnostics.js';

const root = path.resolve('data/live-acceptance');
process.env.DATA_DIR = root;
const recoverDescription = process.argv.find(argument => argument.startsWith('--recover-description='))?.slice('--recover-description='.length);
let browserClosed = false;
const acceptance = await withBrowser(false, async (browser, _signal, setPage) => {
  browser.once('disconnected', () => { browserClosed = true; });
  const context = await browser.newContext({ storageState: path.join(root, '.auth-state.json'), locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  context.setDefaultTimeout(15_000);
  const page = await context.newPage(); setPage(page);
  await page.goto('https://developer.apple.com/account/resources/services/maps-tokens', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await assertNoAccessBlock(page);
  await waitForTokenList(page);
  const snapshot = await readTokenPage(page);
  const result = {
    rowCount: snapshot.rows.length,
    expiredRemaining: snapshot.rows.filter(row => { const expiry = parseTokenDate(row.expiration); return expiry && isExpired(expiry); }).length,
    generatedDuringAcceptance: snapshot.rows.filter(row => row.description.startsWith('auto-refresh-' + new Date().toISOString().slice(0, 10) + 'T')).map(({ description, creation, expiration }) => ({ description, creation, expiration })),
    dates: snapshot.rows.slice(0, 5).map(({ creation, expiration }) => ({ creation, expiration })),
    layout: await page.evaluate(() => {
      const table = document.querySelector('[role="table"]')!;
      const header = Array.from(table.querySelectorAll('[role="columnheader"]')).map(element => ({ text: element.textContent?.trim(), dataId: element.getAttribute('data-id') }));
      const row = table.querySelector('[role="row"]:has([role="cell"])');
      return {
        header,
        rowCells: Array.from(row?.querySelectorAll('[role="cell"]') ?? []).map(cell => ({
          tag: cell.tagName, class: cell.getAttribute('class'),
          descendants: Array.from(cell.querySelectorAll('*')).map(element => ({ tag: element.tagName, class: element.getAttribute('class'), role: element.getAttribute('role') })),
        })),
        controls: Array.from(document.querySelectorAll('button, [role="button"]')).map(element => ({ tag: element.tagName, text: element.textContent?.trim(), title: element.getAttribute('title'), ariaLabel: element.getAttribute('aria-label') })),
        scrolling: { scrollHeight: table.scrollHeight, clientHeight: table.clientHeight, documentHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight },
      };
    }),
  };
  await writeFile(path.join(root, 'inspection.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
  if (recoverDescription) {
    const token = await findToken(page, recoverDescription);
    await writeTokenFile(path.join(root, 'token.txt'), token);
    return { status: 'completed', recoveredDescription: recoverDescription, tokenSaved: true, fingerprint: createHash('sha256').update(token).digest('hex').slice(0, 12), rowCount: snapshot.rows.length, expiredRemaining: result.expiredRemaining, output: path.join(root, 'token.txt') };
  }
  return undefined;
}, {
  launch: options => chromium.launch({ ...options, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }),
  onFailure: saveDiagnostics,
});

if (acceptance) {
  const audit = { ...acceptance, browserClosed, completedAt: new Date().toISOString() };
  await writeFile(path.join(root, 'recovery-audit.json'), JSON.stringify(audit, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ event: 'recovered', ...audit }));
}
