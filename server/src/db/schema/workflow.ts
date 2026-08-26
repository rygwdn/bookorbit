import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, serial, text, timestamp, unique, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import { bookFiles, books } from './books';
import { opdsUsers } from './opds';
import { users } from './auth';

export const workflows = pgTable('workflows', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull().unique(),
  description: text('description'),
  outputFormat: varchar('output_format', { length: 20 }).notNull(),
  inputFormats: text('input_formats').array(),
  outputFilenameTemplate: varchar('output_filename_template', { length: 500 }),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
});

export const workflowSteps = pgTable(
  'workflow_steps',
  {
    id: serial('id').primaryKey(),
    workflowId: integer('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    stepOrder: integer('step_order').notNull(),
    command: varchar('command', { length: 500 }).notNull(),
    args: jsonb('args')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    outputExtension: varchar('output_extension', { length: 20 }),
    inPlace: boolean('in_place').notNull().default(false),
    timeoutSeconds: integer('timeout_seconds').notNull().default(300),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    unique('workflow_steps_workflow_step_order_uidx').on(t.workflowId, t.stepOrder),
    check('workflow_steps_timeout_chk', sql`${t.timeoutSeconds} > 0 and ${t.timeoutSeconds} <= 3600`),
    check('workflow_steps_inplace_no_ext_chk', sql`not (${t.inPlace} and ${t.outputExtension} is not null)`),
  ],
);

export const bookWorkflowOutputs = pgTable(
  'book_workflow_outputs',
  {
    id: serial('id').primaryKey(),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    workflowId: integer('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    bookFileId: integer('book_file_id').references(() => bookFiles.id, { onDelete: 'cascade' }),
    sourceBookFileId: integer('source_book_file_id').references(() => bookFiles.id, { onDelete: 'cascade' }),
    sourceFileHash: varchar('source_file_hash', { length: 32 }),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
    runBatchId: uuid('run_batch_id'),
    triggeredBy: integer('triggered_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('book_workflow_outputs_book_workflow_uidx').on(t.bookId, t.workflowId),
    index('book_workflow_outputs_workflow_id_idx').on(t.workflowId),
    index('book_workflow_outputs_book_file_id_idx').on(t.bookFileId),
    index('book_workflow_outputs_run_batch_id_idx').on(t.runBatchId, t.triggeredBy),
    check('book_workflow_outputs_status_chk', sql`${t.status} in ('pending', 'running', 'success', 'failed')`),
  ],
);

export const workflowDeliveryPreferences = pgTable(
  'workflow_delivery_preferences',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workflowId: integer('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    opdsUserId: integer('opds_user_id').references(() => opdsUsers.id, { onDelete: 'cascade' }),
    koreaderDeviceId: varchar('koreader_device_id', { length: 100 }),
    priority: integer('priority').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('workflow_delivery_preferences_user_id_idx').on(t.userId),
    index('workflow_delivery_preferences_workflow_id_idx').on(t.workflowId),
    index('workflow_delivery_preferences_koreader_device_idx').on(t.userId, t.koreaderDeviceId),
    uniqueIndex('workflow_delivery_preferences_opds_workflow_uidx')
      .on(t.opdsUserId, t.workflowId)
      .where(sql`${t.opdsUserId} is not null`),
    uniqueIndex('workflow_delivery_preferences_koreader_workflow_uidx')
      .on(t.userId, t.koreaderDeviceId, t.workflowId)
      .where(sql`${t.koreaderDeviceId} is not null`),
    check(
      'workflow_delivery_preferences_target_chk',
      sql`(${t.opdsUserId} is not null and ${t.koreaderDeviceId} is null) or (${t.opdsUserId} is null and ${t.koreaderDeviceId} is not null)`,
    ),
    check('workflow_delivery_preferences_priority_chk', sql`${t.priority} >= 0`),
  ],
);

export type Workflow = typeof workflows.$inferSelect;
export type NewWorkflow = typeof workflows.$inferInsert;

export type WorkflowStepRow = typeof workflowSteps.$inferSelect;
export type NewWorkflowStepRow = typeof workflowSteps.$inferInsert;

export type BookWorkflowOutput = typeof bookWorkflowOutputs.$inferSelect;
export type NewBookWorkflowOutput = typeof bookWorkflowOutputs.$inferInsert;

export type WorkflowDeliveryPreference = typeof workflowDeliveryPreferences.$inferSelect;
export type NewWorkflowDeliveryPreference = typeof workflowDeliveryPreferences.$inferInsert;
