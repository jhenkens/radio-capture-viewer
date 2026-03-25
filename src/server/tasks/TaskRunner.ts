import { EventEmitter } from "events";
import { eq, and, lt, isNull, or, ne, asc, lte, notInArray } from "drizzle-orm";
import { schema } from "../db/index.js";
import type { DB } from "../db/index.js";
import type { FileCache } from "../cache/FileCache.js";
import type { StorageProvider } from "../storage/StorageProvider.js";
import type { TaskProcessor } from "./TaskProcessor.js";
import type { NotificationService } from "../notifications/NotificationService.js";

const POLL_INTERVAL_MS = 5_000;
const TASK_TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes

const BACKOFF_SCHEDULE_MS = [
  1 * 60 * 1_000,   //  1 minute
  5 * 60 * 1_000,   //  5 minutes
  30 * 60 * 1_000,  // 30 minutes
];
const BACKOFF_CAP_MS = 60 * 60 * 1_000; // 60 minutes

function backoffMs(failureCount: number): number {
  return BACKOFF_SCHEDULE_MS[failureCount - 1] ?? BACKOFF_CAP_MS;
}

export class TaskRunner extends EventEmitter {
  private readonly processors = new Map<string, TaskProcessor>();
  private readonly concurrencyByType = new Map<string, number>();
  private readonly activeCountByType = new Map<string, number>();
  private activeCount = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private readonly db: DB,
    private readonly cache: FileCache,
    private readonly storage: StorageProvider,
    private readonly notifications: NotificationService,
    private readonly concurrency: number
  ) {
    super();
  }

  registerProcessor(processor: TaskProcessor, concurrency?: number): void {
    this.processors.set(processor.type, processor);
    if (concurrency !== undefined) {
      this.concurrencyByType.set(processor.type, concurrency);
    }
  }

  start(): void {
    this.running = true;
    this.schedulePoll(0);
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  wake(): void {
    if (!this.running) return;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.schedulePoll(0);
  }

  private schedulePoll(delayMs: number): void {
    this.pollTimer = setTimeout(() => {
      this.poll().catch((err) =>
        console.error("[TaskRunner] Poll error:", err)
      );
    }, delayMs);
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    while (this.activeCount < this.concurrency) {
      // Types whose per-processor concurrency limit is currently reached
      const saturatedTypes = [...this.concurrencyByType.entries()]
        .filter(([type, limit]) => (this.activeCountByType.get(type) ?? 0) >= limit)
        .map(([type]) => type);

      const task = await this.claimNextTask(saturatedTypes);
      if (!task) break;
      this.runTask(task).catch((err) =>
        console.error("[TaskRunner] Task error:", task.id, err)
      );
    }

    this.schedulePoll(POLL_INTERVAL_MS);
  }

  private async claimNextTask(saturatedTypes: string[]): Promise<(typeof schema.tasks.$inferSelect) | null> {
    const now = Date.now();
    const timeoutThreshold = now - TASK_TIMEOUT_MS;

    // Find a pending task: not complete, under retry limit, not being processed (or timed out),
    // and not of a type that has reached its per-processor concurrency limit.
    const pending = await this.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.complete, false),
          lt(schema.tasks.failure_count, schema.tasks.retry_limit),
          or(
            isNull(schema.tasks.processing_start_time),
            lt(schema.tasks.processing_start_time, timeoutThreshold)
          ),
          or(
            isNull(schema.tasks.retry_after),
            lte(schema.tasks.retry_after, now)
          ),
          saturatedTypes.length ? notInArray(schema.tasks.type, saturatedTypes) : undefined
        )
      )
      .orderBy(asc(schema.tasks.created_at))
      .limit(1);

    if (!pending.length) return null;

    const task = pending[0]!;

    // Mark as processing
    await this.db
      .update(schema.tasks)
      .set({ processing_start_time: now })
      .where(eq(schema.tasks.id, task.id));

    return task;
  }

  private async runTask(task: typeof schema.tasks.$inferSelect): Promise<void> {
    this.activeCount++;
    this.activeCountByType.set(task.type, (this.activeCountByType.get(task.type) ?? 0) + 1);
    try {
      const processor = this.processors.get(task.type);
      if (!processor) {
        console.warn(`[TaskRunner] No processor for type: ${task.type}`);
        await this.failTask(task, `No processor registered for type: ${task.type}`);
        return;
      }

      // Fetch transmission
      const transmissions = await this.db
        .select()
        .from(schema.transmissions)
        .where(eq(schema.transmissions.id, task.transmission_id));

      if (!transmissions.length) {
        console.warn(`[TaskRunner] Transmission not found: ${task.transmission_id}`);
        await this.failTask(task, "Transmission not found");
        return;
      }

      const transmission = transmissions[0]!;

      console.info(`[TaskRunner] Starting task ${task.id} type=${task.type} transmission=${task.transmission_id}`);
      await processor.process(task, transmission, {
        db: this.db,
        cache: this.cache,
        storage: this.storage,
      });

      // Mark task complete
      await this.db
        .update(schema.tasks)
        .set({ complete: true, processing_end_time: Date.now() })
        .where(eq(schema.tasks.id, task.id));
      console.info(`[TaskRunner] Completed task ${task.id} type=${task.type}`);

      // Check if all required tasks for this transmission are complete
      await this.checkTransmissionComplete(task);
    } catch (err) {
      console.error(`[TaskRunner] Task ${task.id} failed:`, err);
      await this.failTask(task, String(err));
    } finally {
      this.activeCount--;
      this.activeCountByType.set(task.type, (this.activeCountByType.get(task.type) ?? 1) - 1);
      // Wake up to process more tasks
      if (this.running) {
        this.schedulePoll(0);
      }
    }
  }

  private async failTask(
    task: typeof schema.tasks.$inferSelect,
    reason: string
  ): Promise<void> {
    const newCount = task.failure_count + 1;
    const retryAfter = Date.now() + backoffMs(newCount);
    await this.db
      .update(schema.tasks)
      .set({
        failure_count: newCount,
        processing_start_time: null,
        retry_after: retryAfter,
      })
      .where(eq(schema.tasks.id, task.id));
    console.info(`[TaskRunner] Failed task ${task.id} type=${task.type} (attempt ${newCount}/${task.retry_limit}): ${reason} — retry after ${new Date(retryAfter).toISOString()}`);
  }

  private async checkTransmissionComplete(task: typeof schema.tasks.$inferSelect): Promise<void> {
    const transmissionId = task.transmission_id;

    // If any required task is still incomplete, nothing to do yet.
    const incompleteRequired = await this.db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.transmission_id, transmissionId),
          eq(schema.tasks.required, true),
          eq(schema.tasks.complete, false)
        )
      );

    if (incompleteRequired.length > 0) return;

    // All required tasks done — mark available if not already.
    const updated = await this.db
      .update(schema.transmissions)
      .set({ available: true })
      .where(and(eq(schema.transmissions.id, transmissionId), eq(schema.transmissions.available, false)))
      .returning();

    if (updated.length > 0) {
      // Transmission just became available.
      const tx = updated[0]!;
      this.notifications.emitTransmissionAvailable({
        system_id: tx.system_id,
        channel_id: tx.channel_id,
        transmission_id: tx.id,
      });
      return;
    }

    // Transmission was already available. If a non-required task (e.g. whisper) just finished,
    // push an update so clients can refresh the transcript.
    if (!task.required) {
      const txRows = await this.db
        .select()
        .from(schema.transmissions)
        .where(eq(schema.transmissions.id, transmissionId));

      if (txRows.length && txRows[0]!.available) {
        const tx = txRows[0]!;
        this.notifications.emitTransmissionAvailable({
          system_id: tx.system_id,
          channel_id: tx.channel_id,
          transmission_id: tx.id,
        });
      }
    }
  }
}
