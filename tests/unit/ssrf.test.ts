import { describe, expect, it } from "vitest";
import { assertUrlAllowed, isPrivateAddress, rewriteLocalhostForDocker } from "@/lib/fetch/ssrf";

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "127.10.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.10",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "not-an-ip",
  ])("blocks %s", (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(["8.8.8.8", "93.184.215.14", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe("assertUrlAllowed", () => {
  const publicResolver = async () => ["93.184.215.14"];

  it("rejects non-http schemes even when private URLs are allowed", async () => {
    for (const url of ["ftp://example.com/", "file:///etc/passwd", "gopher://x/"]) {
      await expect(assertUrlAllowed(new URL(url), { allowPrivateUrls: true })).rejects.toThrow(/Only http and https/);
    }
  });

  it("allows public hosts", async () => {
    await expect(assertUrlAllowed(new URL("https://example.com/"), { allowPrivateUrls: false, resolver: publicResolver })).resolves.toBeUndefined();
  });

  it("blocks private IP literals and hosts resolving to private ranges", async () => {
    await expect(assertUrlAllowed(new URL("http://127.0.0.1:8080/"), { allowPrivateUrls: false })).rejects.toThrow(/private or local/);
    await expect(assertUrlAllowed(new URL("http://[::1]/"), { allowPrivateUrls: false })).rejects.toThrow(/private or local/);
    await expect(
      assertUrlAllowed(new URL("http://sneaky.example/"), { allowPrivateUrls: false, resolver: async () => ["93.184.215.14", "10.0.0.5"] }),
    ).rejects.toThrow(/private or local/);
  });

  it("allows private hosts when ALLOW_PRIVATE_URLS is on", async () => {
    await expect(assertUrlAllowed(new URL("http://localhost/"), { allowPrivateUrls: true })).resolves.toBeUndefined();
  });

  it("reports unresolvable hosts", async () => {
    await expect(
      assertUrlAllowed(new URL("http://nope.invalid/"), {
        allowPrivateUrls: false,
        resolver: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    ).rejects.toThrow(/Could not resolve/);
  });
});

describe("rewriteLocalhostForDocker", () => {
  it("rewrites loopback hosts only inside Docker", () => {
    expect(rewriteLocalhostForDocker(new URL("http://localhost/app/?q=1"), true).href).toBe("http://host.docker.internal/app/?q=1");
    expect(rewriteLocalhostForDocker(new URL("http://127.0.0.1:8080/"), true).href).toBe("http://host.docker.internal:8080/");
    expect(rewriteLocalhostForDocker(new URL("http://[::1]/"), true).hostname).toBe("host.docker.internal");
    expect(rewriteLocalhostForDocker(new URL("http://mysite.localhost/"), true).hostname).toBe("host.docker.internal");
    expect(rewriteLocalhostForDocker(new URL("http://localhost/"), false).href).toBe("http://localhost/");
    expect(rewriteLocalhostForDocker(new URL("https://example.com/"), true).href).toBe("https://example.com/");
  });
});
