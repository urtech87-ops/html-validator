import { LOGO_MAX_BYTES, type LogoType } from "./types";

/**
 * Logo checks shared by the report dialog and the server (client-safe).
 * Only PNG, JPEG and WebP are accepted, recognised by their magic bytes —
 * never SVG, which can carry scripts.
 */

export function sniffImageType(bytes: Uint8Array): LogoType | undefined {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return "image/png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return "image/webp";
  }
  return undefined;
}

/** Pixel size of a PNG or JPEG (for placing the logo in Excel without distortion). */
export function imageSize(bytes: Uint8Array, type: LogoType): { width: number; height: number } | undefined {
  const b = bytes;
  if (type === "image/png" && b.length >= 24) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (type === "image/jpeg") {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return undefined;
      const marker = b[i + 1];
      const length = (b[i + 2] << 8) | b[i + 3];
      // SOFn markers carry the frame size (C4 = DHT, C8 = JPG, CC = DAC are not frames).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
      }
      i += 2 + length;
    }
  }
  return undefined;
}

export type LogoCheck = { ok: true; type: LogoType; bytes: Uint8Array; dataUrl: string } | { ok: false; error: string };

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function checkLogoBytes(bytes: Uint8Array): LogoCheck {
  if (bytes.byteLength > LOGO_MAX_BYTES) return { ok: false, error: "The logo is larger than 1 MB." };
  const type = sniffImageType(bytes);
  if (!type) return { ok: false, error: "The logo must be a PNG, JPEG or WebP image." };
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { ok: true, type, bytes, dataUrl: `data:${type};base64,${btoa(binary)}` };
}

/** Validate a logo data: URL. The declared type is ignored; the bytes decide. */
export function checkLogoDataUrl(dataUrl: string): LogoCheck {
  const m = /^data:[\w.+-]+\/[\w.+-]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!m) return { ok: false, error: "The logo must be an uploaded image." };
  // Cheap size check before decoding: base64 is 4/3 of the binary size.
  if ((m[1].length * 3) / 4 > LOGO_MAX_BYTES + 3) return { ok: false, error: "The logo is larger than 1 MB." };
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(m[1].replace(/\s+/g, ""));
  } catch {
    return { ok: false, error: "The logo could not be read." };
  }
  return checkLogoBytes(bytes);
}
