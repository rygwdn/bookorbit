import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { WorkflowDetail, WorkflowStep } from '@bookorbit/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { workflows, workflowSteps, type NewWorkflow, type NewWorkflowStepRow, type Workflow, type WorkflowStepRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export type NewStepInput = Omit<NewWorkflowStepRow, 'id' | 'workflowId' | 'stepOrder' | 'createdAt' | 'updatedAt'>;

@Injectable()
export class WorkflowRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findAll(): Promise<WorkflowDetail[]> {
    const [workflowRows, stepRows] = await Promise.all([
      this.db.select().from(workflows).orderBy(asc(workflows.name)),
      this.db.select().from(workflowSteps).orderBy(asc(workflowSteps.workflowId), asc(workflowSteps.stepOrder)),
    ]);

    const stepsByWorkflowId = new Map<number, WorkflowStep[]>();
    for (const step of stepRows) {
      const list = stepsByWorkflowId.get(step.workflowId);
      const mapped = toWorkflowStep(step);
      if (list) {
        list.push(mapped);
      } else {
        stepsByWorkflowId.set(step.workflowId, [mapped]);
      }
    }

    return workflowRows.map((row) => toWorkflowDetail(row, stepsByWorkflowId.get(row.id) ?? []));
  }

  async findById(id: number): Promise<WorkflowDetail | undefined> {
    const [row] = await this.db.select().from(workflows).where(eq(workflows.id, id)).limit(1);
    if (!row) return undefined;

    const stepRows = await this.db.select().from(workflowSteps).where(eq(workflowSteps.workflowId, id)).orderBy(asc(workflowSteps.stepOrder));

    return toWorkflowDetail(row, stepRows.map(toWorkflowStep));
  }

  async create(data: NewWorkflow, steps: NewStepInput[]): Promise<WorkflowDetail> {
    return this.db.transaction(async (tx) => {
      const [insertedWorkflow] = await tx.insert(workflows).values(data).returning();
      if (!insertedWorkflow) {
        throw new Error('Failed to insert workflow');
      }

      let insertedSteps: WorkflowStepRow[] = [];
      if (steps.length > 0) {
        insertedSteps = await tx
          .insert(workflowSteps)
          .values(
            steps.map((step, index) => ({
              ...step,
              workflowId: insertedWorkflow.id,
              stepOrder: index + 1,
            })),
          )
          .returning();
      }

      return toWorkflowDetail(insertedWorkflow, insertedSteps.map(toWorkflowStep));
    });
  }

  async update(id: number, data: Partial<NewWorkflow>, steps: NewStepInput[]): Promise<WorkflowDetail> {
    return this.db.transaction(async (tx) => {
      const [updatedWorkflow] = await tx
        .update(workflows)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(workflows.id, id))
        .returning();

      if (!updatedWorkflow) {
        throw new Error(`Workflow ${id} not found`);
      }

      await tx.delete(workflowSteps).where(eq(workflowSteps.workflowId, id));

      let insertedSteps: WorkflowStepRow[] = [];
      if (steps.length > 0) {
        insertedSteps = await tx
          .insert(workflowSteps)
          .values(
            steps.map((step, index) => ({
              ...step,
              workflowId: id,
              stepOrder: index + 1,
            })),
          )
          .returning();
      }

      return toWorkflowDetail(updatedWorkflow, insertedSteps.map(toWorkflowStep));
    });
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(workflows).where(eq(workflows.id, id));
  }
}

function toWorkflowStep(row: WorkflowStepRow): WorkflowStep {
  return {
    id: row.id,
    stepOrder: row.stepOrder,
    command: row.command,
    args: row.args ?? [],
    outputExtension: row.outputExtension ?? null,
    inPlace: row.inPlace,
    timeoutSeconds: row.timeoutSeconds,
  };
}

function toWorkflowDetail(row: Workflow, steps: WorkflowStep[]): WorkflowDetail {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    outputFormat: row.outputFormat,
    inputFormats: row.inputFormats ?? [],
    steps,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
