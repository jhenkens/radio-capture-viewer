import type { DB, schema } from "../db/index.js";
import type { FileCache } from "../cache/FileCache.js";
import type { StorageProvider } from "../storage/StorageProvider.js";

export type Task = typeof schema.tasks.$inferSelect;
export type Transmission = typeof schema.transmissions.$inferSelect;

export interface TaskProcessorContext {
  db: DB;
  cache: FileCache;
  storage: StorageProvider;
}

export interface TaskProcessor {
  readonly type: string;
  process(task: Task, transmission: Transmission, ctx: TaskProcessorContext): Promise<void>;
}
