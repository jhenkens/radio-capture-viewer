import fs from "fs";
import path from "path";

interface CacheEntry {
  filePath: string;
  sizeBytes: number;
  accessedAt: number;
}

export class FileCache {
  private readonly entries = new Map<string, CacheEntry>();
  private totalSize = 0;

  constructor(
    private readonly basePath: string,
    private readonly maxAgeMs: number,
    private readonly maxSizeBytes: number
  ) {
    fs.mkdirSync(basePath, { recursive: true });
    this.loadExistingEntries();
  }

  private loadExistingEntries(): void {
    try {
      const files = this.listFiles(this.basePath);
      for (const file of files) {
        const stat = fs.statSync(file);
        const key = path.relative(this.basePath, file);
        const entry: CacheEntry = {
          filePath: file,
          sizeBytes: stat.size,
          accessedAt: stat.atimeMs,
        };
        this.entries.set(key, entry);
        this.totalSize += stat.size;
      }
    } catch {
      // ignore errors on startup
    }
  }

  private listFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.listFiles(fullPath));
      } else {
        results.push(fullPath);
      }
    }
    return results;
  }

  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    const age = Date.now() - entry.accessedAt;
    if (age > this.maxAgeMs) {
      this.evict(key);
      return false;
    }
    return fs.existsSync(entry.filePath);
  }

  get(key: string): Buffer | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    const age = Date.now() - entry.accessedAt;
    if (age > this.maxAgeMs) {
      this.evict(key);
      return null;
    }
    if (!fs.existsSync(entry.filePath)) {
      this.entries.delete(key);
      return null;
    }
    entry.accessedAt = Date.now();
    return fs.readFileSync(entry.filePath);
  }

  set(key: string, data: Buffer): void {
    const filePath = path.join(this.basePath, key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data);

    const existing = this.entries.get(key);
    if (existing) {
      this.totalSize -= existing.sizeBytes;
    }

    const entry: CacheEntry = {
      filePath,
      sizeBytes: data.length,
      accessedAt: Date.now(),
    };
    this.entries.set(key, entry);
    this.totalSize += data.length;

    this.evictIfNeeded();
  }

  getPath(key: string): string | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    const age = Date.now() - entry.accessedAt;
    if (age > this.maxAgeMs) {
      this.evict(key);
      return null;
    }
    if (!fs.existsSync(entry.filePath)) {
      this.entries.delete(key);
      return null;
    }
    entry.accessedAt = Date.now();
    return entry.filePath;
  }

  private evict(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    try {
      if (fs.existsSync(entry.filePath)) {
        fs.unlinkSync(entry.filePath);
      }
    } catch {
      // ignore
    }
    this.totalSize -= entry.sizeBytes;
    this.entries.delete(key);
  }

  private evictIfNeeded(): void {
    if (this.totalSize <= this.maxSizeBytes) return;

    // Sort by oldest access time
    const sorted = [...this.entries.entries()].sort(
      ([, a], [, b]) => a.accessedAt - b.accessedAt
    );

    for (const [key] of sorted) {
      if (this.totalSize <= this.maxSizeBytes) break;
      this.evict(key);
    }
  }
}
