/**
 * Get a camera photo into something the whole family can actually see.
 *
 * Two problems, both of which look like "the upload is broken" from the phone:
 *
 *  1. iPhones shoot HEIC. The bucket accepts it and the upload succeeds, so
 *     the app said "Posted to Story" — but only Safari can decode HEIC, so on
 *     every Android phone and most desktops the post rendered as a broken
 *     image. A silent success that produces an invisible photo.
 *  2. A modern phone photo is routinely 8-15 MB, and several at once on a
 *     patchy roadside connection is a slow upload that can simply time out.
 *     The bucket also caps at 20 MB, which a burst or ProRAW shot can exceed.
 *
 * Both are fixed by re-encoding to JPEG on the device before upload. The
 * conversion runs where the file came from — an iPhone decodes its own HEIC
 * natively, which is exactly the case that matters — and anything that cannot
 * be decoded is passed through untouched rather than lost.
 */

/** Longest edge kept. Plenty for a phone screen and a 4:5 story card. */
const MAX_DIM = 2560;
const JPEG_QUALITY = 0.85;
/** Below this, a JPEG is already small enough to send as-is. */
const REENCODE_ABOVE_BYTES = 4 * 1024 * 1024;

const HEIC_NAME = /\.(heic|heif)$/i;
const HEIC_TYPE = /heic|heif/i;

export interface PreparedImage {
  file: File;
  /** True when we re-encoded; false when the original is being sent. */
  converted: boolean;
  /**
   * Set when the file is HEIC and this browser could not decode it, so the
   * original is being uploaded and will not render for most viewers. The
   * caller should say so rather than report a clean success.
   */
  undecodableHeic?: boolean;
}

function isHeic(file: File): boolean {
  return HEIC_NAME.test(file.name) || HEIC_TYPE.test(file.type);
}

export async function prepareImageForUpload(file: File): Promise<PreparedImage> {
  const heic = isHeic(file);
  // Leave ordinary, reasonably sized photos completely alone.
  if (!heic && file.size <= REENCODE_ABOVE_BYTES) return { file, converted: false };
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") {
    return { file, converted: false, undecodableHeic: heic };
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > MAX_DIM ? MAX_DIM / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) throw new Error("encode failed");

    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return {
      file: new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified }),
      converted: true,
    };
  } catch {
    // Could not decode here (an Android browser handed a HEIC, say). Send the
    // original — a photo that some people can see beats no photo at all — but
    // tell the caller so the user is not promised a post that will look broken.
    return { file, converted: false, undecodableHeic: heic };
  } finally {
    bitmap?.close?.();
  }
}
