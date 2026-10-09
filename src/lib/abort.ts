/** Helpers for cancelling work (bulk runs pass an AbortSignal down to fetch and vnu calls). */

export class RunCancelledError extends Error {
  constructor() {
    super("The run was cancelled.");
    this.name = "RunCancelledError";
  }
}

/** Combine a timeout with an optional caller signal. */
export function withTimeout(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

/** Throw RunCancelledError when the caller's signal has fired. */
export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RunCancelledError();
}
