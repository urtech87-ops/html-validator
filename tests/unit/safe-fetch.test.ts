import { describe, expect, it, vi } from "vitest";
import { parseUserUrl, safeFetch, type SafeFetchOptions } from "@/lib/fetch/safe-fetch";

const publicResolver = async () => ["93.184.215.14"];

function opts(fetchImpl: typeof fetch, patch: Partial<SafeFetchOptions> = {}): SafeFetchOptions {
  return { userAgent: "test-agent", allowPrivateUrls: false, runningInDocker: false, fetchImpl, resolver: publicResolver, ...patch };
}

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init ?? {})) as unknown as typeof fetch;
}

const html = (body: string, init: ResponseInit = {}) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });

describe("parseUserUrl", () => {
  it("adds http:// when the scheme is missing", () => {
    expect(parseUserUrl("example.com/page").href).toBe("http://example.com/page");
    expect(parseUserUrl(" https://x.test/ ").href).toBe("https://x.test/");
  });
  it("rejects garbage", () => {
    expect(() => parseUserUrl("http://")).toThrow(/not a valid URL/);
  });
});

describe("safeFetch", () => {
  it("fetches a page with the chosen user agent", async () => {
    const fetchImpl = mockFetch((_url, init) => {
      expect((init.headers as Record<string, string>)["User-Agent"]).toBe("test-agent");
      expect(init.redirect).toBe("manual");
      return html("<p>hi</p>");
    });
    const res = await safeFetch("https://example.com/", opts(fetchImpl));
    expect(res).toMatchObject({ status: 200, finalUrl: "https://example.com/", redirects: [] });
    expect(new TextDecoder().decode(res.bytes)).toBe("<p>hi</p>");
  });

  it("follows redirects and records them", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url === "http://example.com/") return new Response(null, { status: 301, headers: { location: "https://example.com/" } });
      if (url === "https://example.com/") return new Response(null, { status: 302, headers: { location: "/home" } });
      return html("ok");
    });
    const res = await safeFetch("http://example.com/", opts(fetchImpl));
    expect(res.finalUrl).toBe("https://example.com/home");
    expect(res.redirects).toEqual(["https://example.com/", "https://example.com/home"]);
  });

  it("stops after 5 redirects", async () => {
    let n = 0;
    const fetchImpl = mockFetch(() => new Response(null, { status: 302, headers: { location: `/r${++n}` } }));
    await expect(safeFetch("https://example.com/", opts(fetchImpl))).rejects.toThrow(/Too many redirects/);
    expect(n).toBe(6);
  });

  it("re-checks SSRF rules after every redirect", async () => {
    const fetchImpl = mockFetch(() => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }));
    await expect(safeFetch("https://example.com/", opts(fetchImpl))).rejects.toThrow(/private or local/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("enforces the size limit from Content-Length and while streaming", async () => {
    const big = mockFetch(() => html("x", { headers: { "content-length": String(10 * 1024 * 1024) } }));
    await expect(safeFetch("https://example.com/", opts(big))).rejects.toThrow(/larger than/);

    const streamed = mockFetch(() => html("x".repeat(2000)));
    await expect(safeFetch("https://example.com/", opts(streamed, { maxBytes: 1000 }))).rejects.toThrow(/larger than/);
  });

  it("reports timeouts and connection errors clearly", async () => {
    const timeout = mockFetch(() => {
      throw new DOMException("t", "TimeoutError");
    });
    await expect(safeFetch("https://example.com/", opts(timeout))).rejects.toThrow(/did not respond within 15 seconds/);

    const refused = mockFetch(() => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error(""), { code: "ECONNREFUSED" }) });
    });
    await expect(safeFetch("https://example.com/", opts(refused))).rejects.toThrow(/connection refused/);
  });

  it("rewrites localhost inside Docker but shows the original host", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe("http://host.docker.internal/site/");
      return html("ok");
    });
    const res = await safeFetch("http://localhost/site/", opts(fetchImpl, { runningInDocker: true, allowPrivateUrls: true }));
    expect(res.finalUrl).toBe("http://localhost/site/");
  });

  it("blocks localhost when private URLs are not allowed", async () => {
    const fetchImpl = mockFetch(() => html("never"));
    await expect(safeFetch("http://localhost/", opts(fetchImpl, { resolver: async () => ["127.0.0.1"] }))).rejects.toThrow(/private or local/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
