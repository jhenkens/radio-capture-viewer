import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const systems = sqliteTable("systems", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  created_at: integer("created_at").notNull(),
});

export const api_keys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  key_hash: text("key_hash").notNull().unique(),
  system_id: text("system_id")
    .notNull()
    .references(() => systems.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  created_at: integer("created_at").notNull(),
  last_used_at: integer("last_used_at"),
});

export const channels = sqliteTable(
  "channels",
  {
    id: text("id").primaryKey(),
    system_id: text("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    created_at: integer("created_at").notNull(),
  },
  (t) => ({
    systemIdx: index("channels_system_id_idx").on(t.system_id),
  })
);

export const transmissions = sqliteTable(
  "transmissions",
  {
    id: text("id").primaryKey(),
    system_id: text("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "cascade" }),
    channel_id: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    available: integer("available", { mode: "boolean" }).notNull().default(false),
    transcript: text("transcript"),
    duration_ms: integer("duration_ms"),
    frequency_hz: integer("frequency_hz"),
    recorded_at: integer("recorded_at").notNull(),
    created_at: integer("created_at").notNull(),
  },
  (t) => ({
    listIdx: index("transmissions_list_idx").on(
      t.system_id,
      t.channel_id,
      t.available,
      t.recorded_at
    ),
  })
);

export const transmission_files = sqliteTable(
  "transmission_files",
  {
    id: text("id").primaryKey(),
    transmission_id: text("transmission_id")
      .notNull()
      .references(() => transmissions.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    path: text("path").notNull(),
    size_bytes: integer("size_bytes").notNull(),
    created_at: integer("created_at").notNull(),
  },
  (t) => ({
    providerTransmissionUniq: uniqueIndex("tf_provider_transmission_uniq").on(
      t.provider,
      t.transmission_id
    ),
  })
);

export const upload_sessions = sqliteTable("upload_sessions", {
  id: text("id").primaryKey(),
  transmission_id: text("transmission_id")
    .notNull()
    .references(() => transmissions.id, { onDelete: "cascade" }),
  signed_url: text("signed_url").notNull(),
  signed_url_key: text("signed_url_key").notNull(),
  expires_at: integer("expires_at").notNull(),
  completed_at: integer("completed_at"),
  created_at: integer("created_at").notNull(),
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    transmission_id: text("transmission_id")
      .notNull()
      .references(() => transmissions.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    required: integer("required", { mode: "boolean" }).notNull().default(true),
    complete: integer("complete", { mode: "boolean" }).notNull().default(false),
    processing_start_time: integer("processing_start_time"),
    processing_end_time: integer("processing_end_time"),
    failure_count: integer("failure_count").notNull().default(0),
    retry_limit: integer("retry_limit").notNull().default(3),
    retry_delay_ms: integer("retry_delay_ms").notNull().default(30_000),
    retry_after: integer("retry_after"),
    created_at: integer("created_at").notNull(),
  },
  (t) => ({
    pendingIdx: index("tasks_pending_idx").on(
      t.complete,
      t.required,
      t.failure_count,
      t.created_at
    ),
  })
);

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  system_id: text("system_id")
    .notNull()
    .references(() => systems.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  start_time: integer("start_time").notNull(),
  end_time: integer("end_time").notNull(),
  created_at: integer("created_at").notNull(),
});

export const event_transmissions = sqliteTable(
  "event_transmissions",
  {
    event_id: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    transmission_id: text("transmission_id")
      .notNull()
      .references(() => transmissions.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.event_id, t.transmission_id] }),
  })
);
