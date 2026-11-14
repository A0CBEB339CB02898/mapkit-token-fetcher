import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { withBrowser } from '../../src/runtime.js';
import { findLoginFrame } from '../../src/browser.js';
import { assertNoAccessBlock } from '../../src/token-list.js';

const execFile = promisify(execFileCallback);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync(chromium.executablePath()) ? undefined : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
async function processes() {
  const { stdout } = await execFile('ps', ['-axo', 'pid=,ppid=,rss=,args=']);
  return stdout.trim().split('\n').map(line => {
    const [, pid, parent, rss, command] = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line)!;
    return { pid: +pid, parent: +parent, rss: +rss, command };
  });
}

test('20 consecutive real Chromium failures leave no owned browser processes or growing browser RSS', { timeout: 90_000 }, async () => {
  const tag = `mapkit-recovery-test-${randomUUID()}`;
  const memory: number[] = [];
  const browserRss: number[] = [];
  for (let index = 0; index < 20; index++) {
    const owned = new Set<number>();
    await assert.rejects(withBrowser(true, async (browser, _signal, setPage) => {
      const page = await browser.newPage(); setPage(page);
      const running = await processes();
      for (const process of running) if (process.command.includes(tag)) owned.add(process.pid);
      let previous = -1;
      while (previous !== owned.size) {
        previous = owned.size;
        for (const process of running) if (owned.has(process.parent)) owned.add(process.pid);
      }
      assert.ok(owned.size > 0);
      if (index % 2 === 0) {
        await page.setContent('<div>Account Holder must agree to the latest Program License Agreement.</div>');
        await assertNoAccessBlock(page);
      } else {
        await page.setContent('<main>Login form unavailable</main>');
        await findLoginFrame(page, '#account_name_text_field', 20);
      }
    }, {
      launch: options => chromium.launch({ ...options, executablePath, args: [...(options?.args ?? []), `--${tag}`] }),
      timeoutMs: 5_000,
    }));
    let remaining = (await processes()).filter(process => owned.has(process.pid));
    const deadline = Date.now() + 2_000;
    while (remaining.length && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
      remaining = (await processes()).filter(process => owned.has(process.pid));
    }
    assert.equal(remaining.length, 0, `iteration ${index + 1} left owned processes`);
    browserRss.push(remaining.reduce((sum, process) => sum + process.rss, 0));
    memory.push(process.memoryUsage().rss);
  }
  assert.ok(memory.at(-1)! - memory[4] < 64 * 1024 * 1024, 'Node RSS grew by more than 64 MiB after warmup');
  console.log(JSON.stringify({ iterations: memory.length, remainingBrowserRssKiB: browserRss, nodeRssMiB: memory.map(bytes => Math.round(bytes / 1024 / 1024)) }));
});
