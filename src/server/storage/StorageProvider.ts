export interface StorageProvider {
  /**
   * Store a file. Returns the relative path used for storage.
   */
  put(key: string, data: Buffer, contentType: string): Promise<string>;

  /**
   * Get a file as a Buffer. Throws if not found.
   */
  get(path: string): Promise<Buffer>;

  /**
   * Delete a file by path.
   */
  delete(path: string): Promise<void>;

  /**
   * Generate a presigned upload URL (PUT). Returns { url, key }.
   */
  presignUpload(
    key: string,
    contentType: string,
    expiresInSeconds: number
  ): Promise<{ url: string; key: string }>;

  /**
   * Generate a presigned download URL (GET).
   */
  presignDownload(path: string, expiresInSeconds: number): Promise<string>;

  /**
   * Check whether this provider supports presigned uploads.
   */
  supportsPresign(): boolean;
}

/**
 * Compute the storage path for a transmission file.
 * Uses the first 2 chars of the UUID as directory prefix.
 * e.g. "a3b2c1d4-...-uuid.mp3" → "a3/a3b2c1d4-...-uuid.mp3"
 */
export function computeStoragePath(transmissionId: string, extension: string): string {
  const prefix = transmissionId.slice(0, 2);
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  return `${prefix}/${transmissionId}${ext}`;
}
