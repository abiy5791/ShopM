/**
 * Browser download helpers for blob API responses (exports, receipts).
 *
 * The anchor has to be in the document and the object URL has to outlive the
 * click — Firefox and Safari abort the download when either is missing, which
 * looks to the user like "the button does nothing".
 */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  // Give the browser a tick to start the transfer before tearing the URL down.
  setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

/** Filename the server asked for (`Content-Disposition`), else the fallback. */
export function filenameFrom(disposition: unknown, fallback: string): string {
  if (typeof disposition !== "string") return fallback;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return match ? decodeURIComponent(match[1].trim()) : fallback;
}

/** Blob#text is missing on older Android WebViews, which this app still runs on. */
function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === "function") return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read response"));
    reader.readAsText(blob);
  });
}

/**
 * Error bodies come back as a Blob when the request asked for one, so the usual
 * `error.response.data.detail` is unreadable without parsing it first.
 */
export async function readBlobError(data: unknown): Promise<string | null> {
  if (!(data instanceof Blob)) return null;
  try {
    const parsed: unknown = JSON.parse(await blobText(data));
    const detail = (parsed as { detail?: unknown }).detail;
    return typeof detail === "string" ? detail : null;
  } catch {
    return null;
  }
}
