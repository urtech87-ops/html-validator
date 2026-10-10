import path from "node:path";
import { describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";

describe("getConfig", () => {
  it("uses safe defaults", () => {
    const config = getConfig({} as NodeJS.ProcessEnv);
    expect(config).toEqual({
      vnuUrl: "http://localhost:8888",
      vnuTimeoutMs: 30_000,
      allowPrivateUrls: false,
      runningInDocker: false,
      dataDir: path.resolve("./data"),
      historyMaxRuns: 500,
      historyMaxMb: 2048,
    });
  });

  it("reads values and strips trailing slashes from VNU_URL", () => {
    const config = getConfig({
      VNU_URL: "http://vnu:8888///",
      VNU_TIMEOUT_MS: "10000",
      ALLOW_PRIVATE_URLS: "TRUE",
      RUNNING_IN_DOCKER: "1",
    } as unknown as NodeJS.ProcessEnv);
    expect(config.vnuUrl).toBe("http://vnu:8888");
    expect(config.vnuTimeoutMs).toBe(10_000);
    expect(config.allowPrivateUrls).toBe(true);
    expect(config.runningInDocker).toBe(true);
  });

  it("reads the data folder and history limits", () => {
    const config = getConfig({ DATA_DIR: "/app/data", HISTORY_MAX_RUNS: "20", HISTORY_MAX_MB: "64" } as unknown as NodeJS.ProcessEnv);
    expect(config.dataDir).toBe(path.resolve("/app/data"));
    expect(config.historyMaxRuns).toBe(20);
    expect(config.historyMaxMb).toBe(64);
  });

  it("falls back on invalid numbers and unknown booleans", () => {
    const config = getConfig({ VNU_TIMEOUT_MS: "abc", ALLOW_PRIVATE_URLS: "maybe" } as unknown as NodeJS.ProcessEnv);
    expect(config.vnuTimeoutMs).toBe(30_000);
    expect(config.allowPrivateUrls).toBe(false);
  });
});
