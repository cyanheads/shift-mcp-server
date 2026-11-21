/**
 * @fileoverview Comparable PID namespaces and advisory process liveness.
 * @module services/worker-store/process-ownership
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readlinkSync } from 'node:fs';

/** Returns an identity only where this process can verify its boot and PID namespace. */
export function processScope(): string | undefined {
  try {
    if (process.platform === 'linux') {
      const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
      const namespace = readlinkSync('/proc/self/ns/pid');
      return `linux:${boot}:${namespace}`;
    }
    if (process.platform === 'darwin') {
      const boot = execFileSync('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1_000,
      }).trim();
      if (boot) return `darwin:${boot}`;
    }
  } catch {
    /** A restricted host may hide its namespace. Skip probes in that environment. */
  }
  return undefined;
}

/** Only a known same-namespace, missing PID supports the orphan marker. */
export function ownerHasExited(
  localScope: string | undefined,
  ownerScope: string | null,
  ownerPid: number | null,
): boolean {
  if (
    !localScope ||
    ownerScope !== localScope ||
    ownerPid === null ||
    ownerPid <= 0 ||
    ownerPid === process.pid
  )
    return false;
  try {
    process.kill(ownerPid, 0);
    return false;
  } catch (error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH';
  }
}
