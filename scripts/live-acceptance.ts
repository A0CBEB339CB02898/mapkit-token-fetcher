/** Local, operator-assisted acceptance. Never prints credentials, cookies, or tokens. */
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chromium } from 'playwright';

const root = path.resolve('data/live-acceptance');
process.env.DATA_DIR = root;
await mkdir(root, { recursive: true, mode: 0o700 });
const { createRefreshApp } = await import('../src/server.js');
const { loadFullConfig } = await import('../src/config.js');
const { refreshMapKitToken, getMapKitToken } = await import('../src/browser.js');
const readExisting = process.argv.includes('--get');
const runTokenOperation: typeof refreshMapKitToken = readExisting
  ? (username, password, headless, cache, _provider, options) => getMapKitToken(username, password, headless, cache, options)
  : refreshMapKitToken;
const config = loadFullConfig();
const port = 3011;
const baseUrl = `http://127.0.0.1:${port}`;
const safeUrl = (url: string) => { try { const parsed = new URL(url); return parsed.origin + parsed.pathname; } catch { return ''; } };
const redact = (text: string) => text.replaceAll(config.apple.username, '[ACCOUNT]').replaceAll(config.apple.password, '[PASSWORD]');
let closed = 0;
let currentPage: import('playwright').Page | undefined;
const service = createRefreshApp({ ...config, server: { port, base_url: baseUrl } }, {
  port, headless: false, authCache: true, out: path.join(root, 'token.txt'),
}, {
  notifier: {
    async sendVerificationRequired(taskId, url) { console.log(JSON.stringify({ event: 'verification_required', url, taskId })); },
    async sendTaskCompleted() {},
  },
  refresh: (username, password, headless, cache, provider, options) => runTokenOperation(username, password, headless, cache, async () => {
    const layout = [];
    for (const frame of currentPage?.frames() ?? []) {
      const inputs = await frame.locator('.form-security-code-input, #security-code, input[name="security-code"]').evaluateAll(elements => elements.map(element => ({
        tag: element.tagName, type: element.getAttribute('type'), maxLength: element.getAttribute('maxlength'), visible: !!element.getClientRects().length,
      })));
      if (inputs.length) layout.push({ url: safeUrl(frame.url()), inputs });
    }
    console.log(JSON.stringify({ event: 'verification_layout', layout }));
    return provider ? provider() : null;
  }, {
    ...options,
    launch: async launchOptions => {
      const browser = await chromium.launch({ ...launchOptions, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
      browser.once('disconnected', () => { closed++; console.log(JSON.stringify({ event: 'browser_closed' })); });
      const createContext = browser.newContext.bind(browser);
      browser.newContext = async contextOptions => {
        const context = await createContext(contextOptions);
        context.on('page', page => {
          currentPage = page;
          page.on('domcontentloaded', () => console.log(JSON.stringify({ event: 'page_loaded', url: safeUrl(page.url()) })));
        });
        return context;
      };
      return browser;
    },
  }),
});
const server = service.app.listen(port, '127.0.0.1');
await once(server, 'listening');
const stop = () => { service.shutdown(); server.close(); server.closeIdleConnections(); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
let taskId: string | undefined;
try {
  const response = await fetch(`${baseUrl}/api/refresh`, { method: 'POST' });
  const started = await response.json() as { taskId: string };
  taskId = started.taskId;
  console.log(JSON.stringify({ event: 'started', mode: readExisting ? 'get' : 'refresh', taskId, url: `${baseUrl}/refresh?taskId=${taskId}`, output: path.join(root, 'token.txt') }));
  let previous: string | undefined;
  while (true) {
    const task = service.store.getTask(taskId)!;
    if (task.status !== previous) {
      console.log(JSON.stringify({ event: 'status', status: task.status }));
      previous = task.status;
    }
    if (['completed', 'failed', 'cancelled', 'timeout'].includes(task.status) && !service.store.getActiveTask()) {
      const result = task.result;
      const audit = {
        taskId, mode: readExisting ? 'get' : 'refresh', status: task.status, errorCode: result?.errorCode,
        error: result?.error ? redact(result.error) : undefined,
        warnings: result?.warnings, cleanup: result?.cleanup,
        tokenSaved: !!result?.token, fingerprint: result?.token ? createHash('sha256').update(result.token).digest('hex').slice(0, 12) : undefined,
        browserCloseCount: closed, output: result?.token ? path.join(root, 'token.txt') : undefined,
        completedAt: new Date().toISOString(),
      };
      await writeFile(path.join(root, readExisting ? 'get-audit.json' : 'audit.json'), JSON.stringify(audit, null, 2), { mode: 0o600 });
      console.log(JSON.stringify({ event: 'finished', ...audit }));
      if (task.status !== 'completed') process.exitCode = 1;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
} finally {
  service.shutdown();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}
