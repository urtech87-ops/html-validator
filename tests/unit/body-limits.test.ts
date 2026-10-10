import { describe, expect, it } from "vitest";
import { BODY_LIMITS, BodyTooLargeError, bodyErrorResponse, InvalidBodyError, readBodyLimited, readFormLimited, readJsonLimited } from "@/lib/http/body";

const post = (body: BodyInit | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
  new Request("http://127.0.0.1:3000/api/x", { method: "POST", body, headers, duplex: "half" } as RequestInit);

/** A chunked body (no Content-Length) that counts how much of it was read. */
function chunked(chunkBytes: number, chunks: number) {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunks) return controller.close();
      pulled++;
      controller.enqueue(new Uint8Array(chunkBytes).fill(0x20));
    },
  });
  return { stream, pulled: () => pulled };
}

describe("request body limits", () => {
  it("reads bodies under the limit", async () => {
    expect(new TextDecoder().decode(await readBodyLimited(post("hello"), 10))).toBe("hello");
    expect(await readJsonLimited(post('{"a":1}'), 100)).toEqual({ a: 1 });
  });

  it("refuses a declared Content-Length over the limit without reading", async () => {
    const req = post("x".repeat(10), { "content-length": "999999" });
    await expect(readBodyLimited(req, 1000)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(req.bodyUsed).toBe(false);
  });

  it("stops a chunked body as soon as it passes the limit", async () => {
    const body = chunked(64 * 1024, 1000); // would be 64 MB
    await expect(readBodyLimited(post(body.stream), 1024 * 1024)).rejects.toThrow(/larger than 1 MB/);
    expect(body.pulled()).toBeLessThan(20);
  });

  it("JSON errors are 400, size errors 413", async () => {
    await expect(readJsonLimited(post("{nope"), 100)).rejects.toBeInstanceOf(InvalidBodyError);
    expect(bodyErrorResponse(new BodyTooLargeError(BODY_LIMITS.small))?.status).toBe(413);
    expect(await bodyErrorResponse(new BodyTooLargeError(BODY_LIMITS.small))?.json()).toEqual({ error: "The request body is larger than 64 KB." });
    expect(bodyErrorResponse(new InvalidBodyError("bad"))?.status).toBe(400);
    expect(bodyErrorResponse(new Error("other"))).toBeUndefined();
  });

  it("parses multipart forms under the limit and refuses larger ones", async () => {
    const form = new FormData();
    form.append("files", new File(["<p>hi</p>"], "a.html", { type: "text/html" }));
    form.append("options", "{}");
    const encoded = new Request("http://x/", { method: "POST", body: form });
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    const headers = { "content-type": encoded.headers.get("content-type")! };
    const parsed = await readFormLimited(post(bytes, headers), 10_000);
    expect((parsed.get("files") as File).name).toBe("a.html");
    await expect(readFormLimited(post(bytes, headers), 100)).rejects.toBeInstanceOf(BodyTooLargeError);
    await expect(readFormLimited(post("not multipart", { "content-type": "text/plain" }), 1000)).rejects.toBeInstanceOf(InvalidBodyError);
  });

  it("limits fit the documented inputs", () => {
    // 5 MB of HTML where every character needs escaping in JSON (worst realistic case: quotes/backslashes double).
    expect(BODY_LIMITS.validate).toBeGreaterThanOrEqual(2 * 5 * 1024 * 1024);
    expect(BODY_LIMITS.upload).toBeGreaterThan(20 * 5 * 1024 * 1024);
    expect(BODY_LIMITS.bulk).toBeGreaterThan(200 * 2048 * 2);
  });
});
