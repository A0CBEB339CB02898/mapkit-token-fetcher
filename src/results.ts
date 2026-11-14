import { randomUUID } from 'node:crypto';
import { writeFile, rename, rm } from 'node:fs/promises';
import type { CleanupSummary } from './types.js';

export function cleanupMessage(cleanup: CleanupSummary): string {
  return `清理：扫描 ${cleanup.scanned}，过期 ${cleanup.expired}，撤销 ${cleanup.revoked}，失败 ${cleanup.failed}，跳过 ${cleanup.skipped}`;
}

export async function writeTokenFile(file: string, token: string, signal?: AbortSignal): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, token, { encoding: 'utf8', mode: 0o600, signal });
    signal?.throwIfAborted();
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}
