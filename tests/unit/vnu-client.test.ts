import { describe, expect, it, vi } from "vitest";
import { callVnu } from "@/lib/vnu/client";

describe("callVnu", () => {
  it("posts with the right content type and returns messages + version", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ version: "26.10.7", messages: [{ type: "error", message: "x" }] })) as unknown as typeof fetch;
    const res = await callVnu("http://vnu:8888", { body: "a{}", mediaType: "text/css", charset: "utf-8" }, 1000, fetchImpl);
    expect(res.version).toBe("26.10.7");
    expect(res.messages).toHaveLength(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("http://vnu:8888/?out=json");
    expect(init.headers["Content-Type"]).toBe("text/css; charset=utf-8");
  });

  it("omits the charset when vnu should detect it", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ messages: [] })) as unknown as typeof fetch;
    await callVnu("http://vnu:8888", { body: new Uint8Array([1]), mediaType: "text/html" }, 1000, fetchImpl);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].headers["Content-Type"]).toBe("text/html");
  });

  it("turns failures into readable errors", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(callVnu("http://vnu:8888", { body: "", mediaType: "text/html" }, 1000, down)).rejects.toThrow(/unreachable/);

    const http500 = vi.fn(async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
    await expect(callVnu("http://vnu:8888", { body: "", mediaType: "text/html" }, 1000, http500)).rejects.toThrow(/HTTP 500/);

    const badJson = vi.fn(async () => Response.json({ nope: true })) as unknown as typeof fetch;
    await expect(callVnu("http://vnu:8888", { body: "", mediaType: "text/html" }, 1000, badJson)).rejects.toThrow(/messages/);
  });
});
