import { randomUUID } from 'node:crypto';
import type { Task, TaskResult, TaskStatus } from './types.js';
import { OperationError, TASK_TIMEOUT_MS, VERIFICATION_TIMEOUT_MS } from './runtime.js';

const terminal = new Set<TaskStatus>(['completed', 'failed', 'cancelled', 'timeout']);

export class TaskStore {
  private tasks = new Map<string, Task>();
  private runs = new Map<string, { controller: AbortController; timer: NodeJS.Timeout }>();
  private verification = new Map<string, { resolve: (code: string | null) => void; timer: NodeJS.Timeout }>();
  private activeId?: string;

  constructor(private readonly limits = { taskMs: TASK_TIMEOUT_MS, verificationMs: VERIFICATION_TIMEOUT_MS }) {}

  getActiveTask(): Task | null { return this.activeId ? this.tasks.get(this.activeId) ?? null : null; }

  createTask(): Task {
    const active = this.getActiveTask();
    if (active) return active;
    const now = new Date();
    const task: Task = {
      id: randomUUID(), status: 'pending', createdAt: now,
      expiresAt: new Date(now.getTime() + this.limits.verificationMs),
      deadlineAt: new Date(now.getTime() + this.limits.taskMs),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => this.complete(task.id, 'timeout', {
      errorCode: 'TASK_TIMEOUT', error: '任务超过总时限',
    }), this.limits.taskMs);
    this.tasks.set(task.id, task);
    this.runs.set(task.id, { controller, timer });
    this.activeId = task.id;
    return task;
  }

  getTask(id: string): Task | null { return this.tasks.get(id) ?? null; }
  getSignal(id: string): AbortSignal {
    const run = this.runs.get(id);
    if (!run) throw new OperationError('TASK_NOT_FOUND', '任务不存在或已结束');
    return run.controller.signal;
  }

  updateTaskStatus(id: string, status: TaskStatus): boolean {
    const task = this.getTask(id);
    if (!task || terminal.has(task.status)) return false;
    task.status = status;
    return true;
  }

  complete(id: string, status: TaskStatus, result: TaskResult): boolean {
    const task = this.getTask(id);
    if (!task || terminal.has(task.status)) return false;
    task.result = result;
    task.status = status;
    const run = this.runs.get(id);
    clearTimeout(run?.timer);
    this.resolveVerification(id, null);
    delete task.verificationCode;
    if (status !== 'completed') run?.controller.abort(new OperationError(result.errorCode ?? 'BROWSER_ERROR', result.error ?? '任务失败'));
    return true;
  }

  private resolveVerification(id: string, code: string | null): void {
    const callback = this.verification.get(id);
    if (!callback) return;
    clearTimeout(callback.timer);
    this.verification.delete(id);
    callback.resolve(code);
  }

  waitForVerificationCode(id: string): Promise<string | null> {
    const task = this.getTask(id);
    if (!task || terminal.has(task.status) || this.verification.has(id)) return Promise.resolve(null);
    task.status = 'waiting_verification';
    task.expiresAt = new Date(Math.min(Date.now() + this.limits.verificationMs, task.deadlineAt.getTime()));
    return new Promise(resolve => {
      const timer = setTimeout(() => this.complete(id, 'timeout', {
        errorCode: 'VERIFICATION_TIMEOUT', error: '验证码输入超时',
      }), Math.max(0, task.expiresAt.getTime() - Date.now()));
      this.verification.set(id, { resolve, timer });
    });
  }

  submitVerificationCode(id: string, code: string): boolean {
    const task = this.getTask(id);
    if (!task || task.status !== 'waiting_verification' || !/^\d{6}$/.test(code)) return false;
    if (Date.now() >= task.expiresAt.getTime()) {
      this.complete(id, 'timeout', { errorCode: 'VERIFICATION_TIMEOUT', error: '验证码输入超时' });
      return false;
    }
    task.status = 'verifying';
    this.resolveVerification(id, code);
    return true;
  }

  cancelTask(id: string): boolean {
    return this.complete(id, 'cancelled', { errorCode: 'CANCELLED', error: '任务已取消' });
  }

  retryTask(id: string): Task | null {
    const old = this.getTask(id);
    return old && ['timeout', 'cancelled', 'failed'].includes(old.status) ? this.createTask() : null;
  }

  /** Called only after the browser operation has settled, never on a status change. */
  releaseTask(id: string): void {
    clearTimeout(this.runs.get(id)?.timer);
    this.resolveVerification(id, null);
    this.runs.delete(id);
    if (this.activeId === id) this.activeId = undefined;
  }

  shutdown(): void {
    if (this.activeId) this.cancelTask(this.activeId);
  }

  cleanupExpiredTasks(): void {
    for (const [id, task] of this.tasks) {
      if (id !== this.activeId && terminal.has(task.status) && Date.now() - task.createdAt.getTime() > 30 * 60_000) this.tasks.delete(id);
    }
  }
}
