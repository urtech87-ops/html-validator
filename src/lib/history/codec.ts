import "server-only";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** JSON → gzip, for the results and re-run input blobs. */
export async function packJson(value: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await gzipAsync(Buffer.from(JSON.stringify(value), "utf8"), { level: 6 });
  return new Uint8Array(buffer.buffer as ArrayBuffer, buffer.byteOffset, buffer.byteLength);
}

export async function unpackJson<T>(bytes: Uint8Array): Promise<T> {
  const buffer = await gunzipAsync(bytes);
  return JSON.parse(buffer.toString("utf8")) as T;
}
