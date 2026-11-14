import { chromium, type Browser, type Page } from 'playwright';

export const TASK_TIMEOUT_MS = 15 * 60_000;
export const VERIFICATION_TIMEOUT_MS = 5 * 60_000;
export const ACTION_TIMEOUT_MS = 15_000;
export const NAVIGATION_TIMEOUT_MS = 60_000;
export const CLOSE_TIMEOUT_MS = 10_000;

export class OperationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'OperationError';
  }
}

export function asOperationError(error: unknown): OperationError {
  if (error instanceof OperationError) return error;
  return new OperationError(
    error instanceof Error && error.name === 'TimeoutError' ? 'ELEMENT_TIMEOUT' : 'BROWSER_ERROR',
    error instanceof Error ? error.message : String(error),
  );
}

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason ?? new OperationError('CANCELLED', '任务已取消'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function within<T>(promise: Promise<T>, ms: number, error: Error): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(error), ms);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

let recoveryRequired = false;
export function browserRecoveryRequired(): boolean { return recoveryRequired; }

export interface BrowserOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  closeTimeoutMs?: number;
  launch?: typeof chromium.launch;
  onFailure?: (page: Page | undefined, error: OperationError) => Promise<void>;
}

/** Owns the browser from launch through close, including cancellation during launch. */
export async function withBrowser<T>(
  headless: boolean,
  work: (browser: Browser, signal: AbortSignal, setPage: (page: Page) => void) => Promise<T>,
  options: BrowserOptions = {},
): Promise<T> {
  if (recoveryRequired) throw new OperationError('BROWSER_RECOVERY_REQUIRED', '浏览器回收异常，请重启服务');
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason ?? new OperationError('CANCELLED', '任务已取消'));
  const shutdown = () => controller.abort(new OperationError('CANCELLED', '程序正在退出'));
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  const timeout = options.timeoutMs ?? TASK_TIMEOUT_MS;
  const timer = timeout > 0 ? setTimeout(() => controller.abort(new OperationError('TASK_TIMEOUT', '任务超过总时限')), timeout) : undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  let closePromise: Promise<void> | undefined;
  let failure: OperationError | undefined;
  const close = (): Promise<void> => {
    if (!browser) return Promise.resolve();
    closePromise ??= within(Promise.resolve().then(() => browser!.close()), options.closeTimeoutMs ?? CLOSE_TIMEOUT_MS,
      new OperationError('BROWSER_RECOVERY_REQUIRED', '浏览器关闭超时，请重启服务'))
      .catch(error => {
        recoveryRequired = true;
        console.error('❌ 浏览器回收异常，已停止接受新任务:', asOperationError(error).message);
        throw new OperationError('BROWSER_RECOVERY_REQUIRED', '浏览器回收异常，请重启服务');
      });
    return closePromise;
  };
  const closeOnAbort = () => { void close().catch(() => {}); };
  controller.signal.addEventListener('abort', closeOnAbort);
  try {
    controller.signal.throwIfAborted();
    // Await launch even when cancelled: a late browser must still be owned and closed.
    browser = await (options.launch ?? chromium.launch.bind(chromium))({
      headless, timeout: NAVIGATION_TIMEOUT_MS, args: ['--window-size=1280,800'],
      handleSIGINT: false, handleSIGTERM: false,
    });
    controller.signal.throwIfAborted();
    return await abortable(work(browser, controller.signal, value => { page = value; }), controller.signal);
  } catch (error) {
    failure = asOperationError(controller.signal.aborted ? controller.signal.reason : error);
    if (options.onFailure) {
      await within(options.onFailure(page, failure), 5_000, new Error('诊断超时')).catch(() => {});
    }
    throw failure;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', closeOnAbort);
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    try { await close(); } catch (error) { if (!failure) throw error; }
  }
}
