import fs from "fs";
import path from "path";
import { StorageProvider } from "./StorageProvider.js";

export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly basePath: string) {
    fs.mkdirSync(basePath, { recursive: true });
  }

  async put(key: string, data: Buffer, _contentType: string): Promise<string> {
    const fullPath = path.join(this.basePath, key);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, data);
    return key;
  }

  async get(filePath: string): Promise<Buffer> {
    const fullPath = path.join(this.basePath, filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    return fs.readFileSync(fullPath);
  }

  async delete(filePath: string): Promise<void> {
    const fullPath = path.join(this.basePath, filePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  async presignUpload(
    _key: string,
    _contentType: string,
    _expiresInSeconds: number
  ): Promise<{ url: string; key: string }> {
    throw new Error("Local storage does not support presigned uploads");
  }

  async presignDownload(_filePath: string, _expiresInSeconds: number): Promise<string> {
    throw new Error("Local storage does not support presigned downloads");
  }

  supportsPresign(): boolean {
    return false;
  }

  getFullPath(filePath: string): string {
    return path.join(this.basePath, filePath);
  }
}
