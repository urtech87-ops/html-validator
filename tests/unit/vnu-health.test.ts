import { describe, expect, it, vi } from "vitest";
import { checkVnuHealth } from "@/lib/vnu/health";

const VNU = "http://vnu:8888";

function mockFetch(impl: () => Promise<Response>) {
  return vi.fn(impl) as unknown as typeof fetch;
}

describe("checkVnuHealth", () => {
  it("reports ok when vnu returns a messages array", async () => {
    const fetchImpl = mockFetch(async () => Response.json({ messages: [] }));
    const result = await checkVnuHealth(VNU, 1000, fetchImpl);

    expect(result.ok).toBe(true);
    expect(result.messageCount).toBe(0);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("http://vnu:8888/?out=json");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("text/html; charset=utf-8");
  });

  it("fails on a non-2xx status", async () => {
    const result = await checkVnuHealth(VNU, 1000, mockFetch(async () => new Response("down", { status: 502 })));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HTTP 502/);
  });

  it("fails when the JSON shape is wrong", async () => {
    const result = await checkVnuHealth(VNU, 1000, mockFetch(async () => Response.json({ foo: 1 })));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/messages/);
  });

  it("fails when vnu is unreachable", async () => {
    const result = await checkVnuHealth(
      VNU,
      1000,
      mockFetch(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unreachable/);
  });

  it("reports a timeout clearly", async () => {
    const result = await checkVnuHealth(
      VNU,
      1234,
      mockFetch(async () => {
        throw new DOMException("timed out", "TimeoutError");
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("vnu did not respond within 1234 ms");
  });
});
