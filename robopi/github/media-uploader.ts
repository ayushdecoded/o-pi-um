import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export type MediaUpload = {
  path: string;
  sha256: string;
  url: string;
};

export function localMediaPaths(markdown: string): string[] {
  const paths = new Set<string>();
  for (const match of markdown.matchAll(/\]\((\.robopi\/evidence\/[^)]+)\)/g)) paths.add(match[1]);
  return [...paths];
}

export async function uploadMediaForPr(paths: string[], prUrl: string): Promise<MediaUpload[]> {
  if (paths.length === 0) return [];
  if (!process.env.ROBOPI_ENABLE_BROWSER_UPLOAD) {
    throw new Error(
      "GitHub browser media upload is not enabled yet. Set ROBOPI_ENABLE_BROWSER_UPLOAD=1 after bot browser login is configured.",
    );
  }
  // Browser upload will mint github.com/user-attachments URLs from an unsent
  // PR comment box. The guard above keeps this skeleton safe until login exists.
  throw new Error(`Browser media upload for ${prUrl} is not implemented in this slice.`);
}

export function replaceMediaLinks(markdown: string, uploads: MediaUpload[]): string {
  let result = markdown;
  for (const upload of uploads) result = result.replaceAll(upload.path, upload.url);
  return result;
}

export function mediaHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
