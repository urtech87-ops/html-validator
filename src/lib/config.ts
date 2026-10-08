import "server-only";

/**
 * Server-side runtime configuration, read from environment variables.
 * Values are read on each call (not at module load) so Docker images pick up
 * runtime env rather than build-time values.
 */

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface AppConfig {
  /** Base URL of the self-hosted Nu Html Checker, without trailing slash. */
  vnuUrl: string;
  /** Timeout for calls to vnu, in milliseconds. */
  vnuTimeoutMs: number;
  /** Allow fetching private/loopback URLs (local/VPN testing). */
  allowPrivateUrls: boolean;
  /** True when the app itself runs inside a Docker container. */
  runningInDocker: boolean;
}

export function getConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    vnuUrl: (env.VNU_URL || "http://localhost:8888").replace(/\/+$/, ""),
    vnuTimeoutMs: int(env.VNU_TIMEOUT_MS, 30_000),
    allowPrivateUrls: bool(env.ALLOW_PRIVATE_URLS, false),
    runningInDocker: bool(env.RUNNING_IN_DOCKER, false),
  };
}
