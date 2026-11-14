import test from 'node:test';
import assert from 'node:assert/strict';
import { withBrowser, abortable, browserRecoveryRequired, OperationError } from '../src/runtime.js';
import { refreshMapKitToken } from '../src/browser.js';
import type { Browser, BrowserType } from 'playwright';

const launch = (browser: Partial<Browser>) => (async () => browser as Browser) as BrowserType['launch'];

test('success, context initialization failure and navigation failure all close the browser', async () => {
  let closed = 0;
  const fake = { close: async () => { closed++; }, newContext: async () => { throw new Error('context failed'); } };
  assert.equal(await withBrowser(true, async () => 'ok', { launch: launch(fake) }), 'ok');
  await assert.rejects(refreshMapKitToken('user', 'password', true, false, undefined, { launch: launch(fake), onFailure: async () => {} }), /context failed/);
  const page = { goto: async () => { throw new Error('navigation failed'); }, frames: () => [] };
  const context = { setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, newPage: async () => page };
  await assert.rejects(refreshMapKitToken('user', 'password', true, false, undefined, {
    launch: launch({ close: fake.close, newContext: async () => context as any }), onFailure: async () => {},
  }), /navigation failed/);
  assert.equal(closed, 3);
});

test('cancellation interrupts pending work and waits for close exactly once', async () => {
  let closes = 0;
  let finishClose!: () => void;
  const controller = new AbortController();
  const task = withBrowser(true, async () => new Promise(() => {}), {
    signal: controller.signal, launch: launch({ close: () => { closes++; return new Promise(resolve => { finishClose = resolve; }); } }),
  });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(new OperationError('CANCELLED', 'cancelled'));
  await new Promise(resolve => setImmediate(resolve));
  let settled = false;
  const check = task.finally(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  finishClose();
  await assert.rejects(check, /cancelled/);
  assert.equal(closes, 1);
});

test('total deadline closes a stalled browser and removes signal listeners', async () => {
  const before = process.listenerCount('SIGTERM');
  let closed = 0;
  await assert.rejects(withBrowser(true, async () => new Promise(() => {}), {
    timeoutMs: 10, launch: launch({ close: async () => { closed++; } }),
  }), { code: 'TASK_TIMEOUT' });
  assert.equal(closed, 1);
  assert.equal(process.listenerCount('SIGTERM'), before);
});

test('cancellation during launch still closes the browser returned later', async () => {
  let resolveLaunch!: (browser: Browser) => void;
  let closed = 0;
  const controller = new AbortController();
  const task = withBrowser(true, async () => assert.fail('must not run'), {
    signal: controller.signal, launch: (() => new Promise(resolve => { resolveLaunch = resolve; })) as BrowserType['launch'],
  });
  controller.abort(new OperationError('CANCELLED', 'cancelled'));
  resolveLaunch({ close: async () => { closed++; } } as Browser);
  await assert.rejects(task, /cancelled/);
  assert.equal(closed, 1);
});

test('diagnostic failure preserves original error and still closes', async () => {
  let closed = false;
  await assert.rejects(withBrowser(true, async () => { throw new Error('original'); }, {
    launch: launch({ close: async () => { closed = true; } }), onFailure: async () => { throw new Error('diagnostics'); },
  }), /original/);
  assert.equal(closed, true);
});

test('aborted pending promise rejects without retaining an abort listener', async () => {
  const controller = new AbortController();
  const result = abortable(new Promise(() => {}), controller.signal);
  controller.abort(new OperationError('CANCELLED', 'cancel'));
  await assert.rejects(result, /cancel/);
});

test('close timeout preserves original failure and prevents new launches until restart', async () => {
  let launched = 0;
  const options = { closeTimeoutMs: 10, launch: launch({ close: async () => new Promise(() => {}) }) };
  await assert.rejects(withBrowser(true, async () => { throw new Error('original'); }, options), /original/);
  assert.equal(browserRecoveryRequired(), true);
  await assert.rejects(withBrowser(true, async () => 'ok', { launch: (async () => { launched++; }) as any }), { code: 'BROWSER_RECOVERY_REQUIRED' });
  assert.equal(launched, 0);
});
