import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { cleanupExpiredTokens, findToken, readTokenPage, assertNoAccessBlock } from '../../src/token-list.js';
import { findLoginFrame } from '../../src/browser.js';

let browser: Browser;
before(async () => {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync(chromium.executablePath()) ? undefined : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  browser = await chromium.launch({ headless: true, executablePath });
});
after(async () => { await browser?.close(); });
const row = (id: string, expiration: string, creation = '2026-10-29') => ({ description: id, token: `token-${id}`, expiration, creation });
async function fixture(records: unknown[]): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent(await readFile(new URL('../fixtures/token-list.html', import.meta.url), 'utf8'));
  await page.evaluate(records => { Object.assign(window, { records }); (window as any).render(); }, records);
  return page;
}
const now = new Date('2026-10-31T02:00:00Z');

test('shuffled columns, pagination and shifted rows revoke every expired token and retain today/valid/unknown', async () => {
  const page = await fixture([row('old1', '10/29/26'), row('valid', '2026-11-05'), row('old2', '2026-10-30'), row('today', '10/31/26'), row('unknown', 'not-a-date'), row('old3', '10/01/2026')]);
  try {
    const result = await cleanupExpiredTokens(page, { now, actionMs: 1_000 });
    assert.equal(result.cleanup.revoked, 3);
    assert.equal(result.cleanup.expired, 3);
    assert.equal(result.cleanup.scanned, 6);
    assert.equal(result.cleanup.skipped, 1);
    assert.equal(result.cleanup.complete, false);
    assert.deepEqual(await page.evaluate(() => (window as any).records.map((row: any) => row.description)), ['valid', 'today', 'unknown']);
  } finally { await page.close(); }
});

test('hover-triggered delayed buttons are awaited', async () => {
  const page = await fixture([row('old', '10/29/26')]);
  try {
    await page.evaluate(() => { (window as any).delayButtons = 150; (window as any).render(); });
    const result = await cleanupExpiredTokens(page, { now, actionMs: 1_000 });
    assert.equal(result.cleanup.revoked, 1);
    assert.equal(result.cleanup.complete, true);
  } finally { await page.close(); }
});

test('a no-op revoke is a failure and is not retried forever', async () => {
  const page = await fixture([row('old', '10/29/26')]);
  try {
    await page.evaluate(() => { (window as any).noDelete = true; });
    const result = await cleanupExpiredTokens(page, { now, actionMs: 300, budgetMs: 2_000 });
    assert.equal(result.cleanup.revoked, 0);
    assert.equal(result.cleanup.failed, 1);
    assert.equal(result.cleanup.complete, false);
  } finally { await page.close(); }
});

test('unknown structure is a warning rather than an empty successful cleanup', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<main>Unrecognized portal</main>');
    const result = await cleanupExpiredTokens(page);
    assert.equal(result.cleanup.complete, false);
    assert.match(result.warnings.join(), /无法识别/);
  } finally { await page.close(); }
});

test('semantic rows and machine-readable expiration timestamps are supported', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div class="token-row"><span data-field="description">manual</span><span data-field="token">value</span><span data-field="creation">2026-01-01</span><span data-field="expiration"><time datetime="2026-11-01T00:00:00Z">Tomorrow</time></span></div>');
    const { rows } = await readTokenPage(page);
    assert.equal(rows[0].expiration, '2026-11-01T00:00:00Z');
  } finally { await page.close(); }
});

test('new token is found by exact description across pages and latest valid token ignores sort direction', async () => {
  const page = await fixture([row('older', '2027-01-01', '2026-01-01'), row('new-exact', '2027-01-01', '2026-10-31'), row('expired', '2020-01-01', '2026-11-01')]);
  try {
    assert.equal(await findToken(page, 'new-exact'), 'token-new-exact');
    assert.equal(await findToken(page), 'token-new-exact');
  } finally { await page.close(); }
});

test('agreement overlay is classified and delayed login iframe is discovered', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div role="dialog">Access Unavailable. Your Account Holder must agree to the latest Program License Agreement.</div>');
    await assert.rejects(assertNoAccessBlock(page), { code: 'AGREEMENT_REQUIRED' });
    await page.setContent('<script>setTimeout(() => { const f=document.createElement("iframe"); f.srcdoc="<input id=account_name_text_field>"; document.body.append(f); }, 150)</script>');
    assert.notEqual(await findLoginFrame(page, '#account_name_text_field', 2_000), page.mainFrame());
  } finally { await page.close(); }
});


test('cleanup budget prevents late pagination actions and reports incomplete work', async () => {
  const page = await fixture([row('old', '10/29/26'), row('valid', '2027-01-01'), row('other', '2027-01-01')]);
  try {
    await page.evaluate(() => { (window as any).noDelete = true; });
    const result = await cleanupExpiredTokens(page, { now, actionMs: 1_000, budgetMs: 150 });
    assert.equal(result.cleanup.complete, false);
    const before = await page.evaluate(() => (window as any).pageIndex);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => (window as any).pageIndex), before);
  } finally { await page.close(); }
});

test('revoke failures do not block subsequent expired records', async () => {
  const page = await fixture([row('fail', '10/29/26'), row('succeed', '10/29/26')]);
  try {
    await page.evaluate(() => { document.querySelector('tbody tr .action-remove')!.remove(); });
    const result = await cleanupExpiredTokens(page, { now, actionMs: 300, budgetMs: 2_000 });
    assert.equal(result.cleanup.failed, 1);
    assert.equal(result.cleanup.revoked, 1);
  } finally { await page.close(); }
});


test('row reordering during hover cannot revoke the valid record at its old index', async () => {
  const page = await fixture([row('expired', '10/29/26'), row('valid', '2027-01-01')]);
  try {
    await page.evaluate(() => {
      const tr = document.querySelector('tbody tr')!;
      tr.addEventListener('mouseenter', () => {
        const body = document.querySelector('tbody')!;
        body.append(tr);
      }, { once: true });
    });
    const result = await cleanupExpiredTokens(page, { now, actionMs: 1_000 });
    assert.equal(result.cleanup.revoked, 1);
    assert.deepEqual(await page.evaluate(() => (window as any).records.map((row: any) => row.description)), ['valid']);
  } finally { await page.close(); }
});


test('Apple ARIA table made of div/span supports reading, identity and verified revocation', async () => {
  const page = await fixture([row('old-aria', '10/29/26'), row('valid-aria', '2099-01-01')]);
  try {
    await page.evaluate(() => {
      const table = document.querySelector('table')!;
      const aria = document.createElement('div'); aria.setAttribute('role', 'table');
      const header = document.createElement('div'); header.setAttribute('role', 'row');
      for (const th of table.querySelectorAll('th')) {
        const span = document.createElement('span'); span.setAttribute('role', 'columnheader'); span.textContent = th.textContent; header.append(span);
      }
      aria.append(header);
      for (const tr of table.querySelectorAll('tbody tr')) {
        const group = document.createElement('div'); group.setAttribute('role', 'row');
        for (const td of tr.querySelectorAll('td')) {
          const cell = document.createElement('span'); cell.setAttribute('role', 'cell');
          cell.append(...Array.from(td.childNodes)); group.append(cell);
        }
        aria.append(group);
      }
      table.replaceWith(aria);
      (window as any).render = () => {};
      document.querySelector('#action-confirm')!.addEventListener('click', () => {
        document.querySelector('[role="table"] [role="row"]:nth-child(2)')!.remove();
      }, { once: true });
    });
    const records = await readTokenPage(page);
    assert.equal(records.rows.length, 2);
    assert.equal(records.rows[0].description, 'old-aria');
    const result = await cleanupExpiredTokens(page, { now, actionMs: 1_000 });
    assert.equal(result.cleanup.revoked, 1);
    assert.equal(result.cleanup.complete, true);
    assert.equal(await findToken(page, 'valid-aria'), 'token-valid-aria');
  } finally { await page.close(); }
});


test('a visible wizard Next button is never treated as token pagination', async () => {
  const page = await fixture([row('existing', '2099-12-31')]);
  try {
    await page.evaluate(() => {
      const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
      dialog.innerHTML = '<h2>Create Maps Token</h2><button>Next</button>';
      dialog.querySelector('button')!.onclick = () => { document.querySelector('table')!.remove(); };
      document.body.append(dialog);
    });
    assert.equal(await findToken(page, 'existing'), 'token-existing');
    assert.equal(await page.locator('table').count(), 1);
  } finally { await page.close(); }
});
