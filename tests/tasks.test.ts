import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskStore } from '../src/task-manager.js';
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('single task reservation survives cancellation until resource release', async () => {
  const store = new TaskStore();
  const task = store.createTask();
  assert.equal(store.createTask().id, task.id);
  const signal = store.getSignal(task.id);
  const code = store.waitForVerificationCode(task.id);
  assert.equal(store.cancelTask(task.id), true);
  assert.equal(await code, null);
  assert.equal(signal.aborted, true);
  assert.equal(store.retryTask(task.id)?.id, task.id);
  assert.equal(store.complete(task.id, 'completed', { token: 'late' }), false);
  assert.equal(task.status, 'cancelled');
  assert.equal(task.result?.errorCode, 'CANCELLED');
  store.releaseTask(task.id);
  const next = store.retryTask(task.id)!;
  assert.notEqual(next.id, task.id);
  store.cancelTask(next.id); store.releaseTask(next.id);
});

test('verification and total deadlines abort work and preserve timeout reason', async () => {
  const verification = new TaskStore({ taskMs: 500, verificationMs: 10 });
  const task = verification.createTask();
  const signal = verification.getSignal(task.id);
  assert.equal(await verification.waitForVerificationCode(task.id), null);
  assert.equal(task.status, 'timeout');
  assert.equal(task.result?.errorCode, 'VERIFICATION_TIMEOUT');
  assert.equal(signal.aborted, true);
  assert.equal(verification.submitVerificationCode(task.id, '123456'), false);
  verification.releaseTask(task.id);
  const total = new TaskStore({ taskMs: 10, verificationMs: 500 });
  const running = total.createTask(); total.updateTaskStatus(running.id, 'running');
  await delay(30);
  assert.equal(running.status, 'timeout');
  assert.equal(running.result?.errorCode, 'TASK_TIMEOUT');
  total.releaseTask(running.id);
});

test('successful verification clears waiting callback and completed state cannot be overwritten', async () => {
  const store = new TaskStore({ taskMs: 1_000, verificationMs: 20 });
  const task = store.createTask();
  const pending = store.waitForVerificationCode(task.id);
  assert.equal(store.submitVerificationCode(task.id, '123456'), true);
  assert.equal(await pending, '123456');
  store.complete(task.id, 'completed', { token: 'new' });
  await delay(30);
  assert.equal(task.status, 'completed');
  assert.equal(store.cancelTask(task.id), false);
  store.releaseTask(task.id);
});
