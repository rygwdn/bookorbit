import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, serial, text, timestamp, unique, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { bookFiles, books } from './books';
import { users } from './auth';

export const workflows = pgTable('workflows', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull().unique(),
  description: text('description'),
  outputFormat: varchar('output_format', { length: 20 }).notNull(),
  inputFormats: text('input_formats').array(),
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
    args: jsonb('args').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
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
  },
  (t) => [
    uniqueIndex('book_workflow_outputs_book_workflow_uidx').on(t.bookId, t.workflowId),
    index('book_workflow_outputs_workflow_id_idx').on(t.workflowId),
    index('book_workflow_outputs_book_file_id_idx').on(t.bookFileId),
    check('book_workflow_outputs_status_chk', sql`${t.status} in ('pending', 'running', 'success', 'failed')`),
  ],
);

export const bookWorkflowPreferences = pgTable(
  'book_workflow_preferences',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    workflowId: integer('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('book_workflow_preferences_user_book_uidx').on(t.userId, t.bookId),
    index('book_workflow_preferences_workflow_id_idx').on(t.workflowId),
  ],
);

export type Workflow = typeof workflows.$inferSelect;
export type NewWorkflow = typeof workflows.$inferInsert;

export type WorkflowStepRow = typeof workflowSteps.$inferSelect;
export type NewWorkflowStepRow = typeof workflowSteps.$inferInsert;

export type BookWorkflowOutput = typeof bookWorkflowOutputs.$inferSelect;
export type NewBookWorkflowOutput = typeof bookWorkflowOutputs.$inferInsert;

export type BookWorkflowPreferenceRow = typeof bookWorkflowPreferences.$inferSelect;
export type NewBookWorkflowPreferenceRow = typeof bookWorkflowPreferences.$inferInsert;
