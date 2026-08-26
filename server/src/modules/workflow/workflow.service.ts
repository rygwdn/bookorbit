import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { WORKFLOW_TEMPLATE_KEYS, type WorkflowDeliveryPreference, type WorkflowDeliveryTarget, type WorkflowDetail } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { CreateWorkflowDto } from './dto/create-workflow.dto';
import type { UpdateWorkflowDto } from './dto/update-workflow.dto';
import type { CreateWorkflowDeliveryPreferenceDto } from './dto/workflow-delivery-preference.dto';
import { WorkflowRunRepository } from './workflow-run.repository';
import { extractTemplateKeys } from './lib/workflow-template';
import { WorkflowRepository, type NewStepInput } from './workflow.repository';

const ALLOWED_TEMPLATE_KEYS_SET = new Set<string>(WORKFLOW_TEMPLATE_KEYS);
function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error && error.code === '23505') return true;
  if (error instanceof Error && error.cause && typeof error.cause === 'object' && 'code' in error.cause) {
    return error.cause.code === '23505';
  }
  return false;
}
export type StepValidationInput = {
  command?: string;
  args: string[];
  outputExtension?: string | null;
  inPlace?: boolean;
  timeoutSeconds?: number;
};

@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(
    private readonly repo: WorkflowRepository,
    private readonly workflowRunRepo: WorkflowRunRepository,
  ) {}

  async list(): Promise<WorkflowDetail[]> {
    return this.repo.findAll();
  }

  async listDeliveryPreferences(userId: number): Promise<WorkflowDeliveryPreference[]> {
    const rows = await this.workflowRunRepo.listDeliveryPreferences(userId);
    return rows.map((row) => ({
      id: row.id,
      workflowId: row.workflowId,
      workflowName: row.workflowName,
      outputFormat: row.outputFormat,
      inputFormats: row.inputFormats ?? [],
      priority: row.priority,
      target: toDeliveryTarget(row.opdsUserId, row.koreaderDeviceId),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async createDeliveryPreference(userId: number, dto: CreateWorkflowDeliveryPreferenceDto): Promise<void> {
    await this.get(dto.workflowId);
    const target = toRequestTarget(dto.target);
    const owned =
      target.type === 'opds'
        ? await this.workflowRunRepo.hasOwnedOpdsUser(userId, target.opdsUserId)
        : await this.workflowRunRepo.hasOwnedKoreaderDevice(userId, target.deviceId);
    if (!owned) throw new NotFoundException('Delivery target not found');

    try {
      await this.workflowRunRepo.createDeliveryPreference(userId, dto.workflowId, target, dto.priority ?? 0);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A preference already exists for this target and workflow');
      throw error;
    }
  }

  async removeDeliveryPreference(userId: number, id: number): Promise<void> {
    const removed = await this.workflowRunRepo.deleteDeliveryPreference(userId, id);
    if (!removed) throw new NotFoundException(`Workflow delivery preference ${id} not found`);
  }

  async get(id: number): Promise<WorkflowDetail> {
    const workflow = await this.repo.findById(id);
    if (!workflow) {
      throw new NotFoundException(`Workflow ${id} not found`);
    }
    return workflow;
  }

  async create(dto: CreateWorkflowDto, user: RequestUser): Promise<WorkflowDetail> {
    this.validateSteps(dto.steps);

    try {
      return await this.repo.create(
        {
          name: dto.name,
          description: dto.description ?? null,
          outputFormat: dto.outputFormat,
          inputFormats: dto.inputFormats ?? null,
          createdBy: user.id,
        },
        dto.steps.map(toStepInsert),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`A workflow named "${dto.name}" already exists`);
      }
      this.logger.error(`[workflow.create] [fail] name="${sanitizeLogValue(dto.name)}" - ${sanitizeLogValue(error)}`);
      throw error;
    }
  }

  async update(id: number, dto: UpdateWorkflowDto): Promise<WorkflowDetail> {
    await this.get(id);
    this.validateSteps(dto.steps);

    try {
      return await this.repo.update(
        id,
        {
          name: dto.name,
          description: dto.description ?? null,
          outputFormat: dto.outputFormat,
          inputFormats: dto.inputFormats ?? null,
        },
        dto.steps.map(toStepInsert),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`A workflow named "${dto.name}" already exists`);
      }
      this.logger.error(`[workflow.update] [fail] id=${id} name="${sanitizeLogValue(dto.name)}" - ${sanitizeLogValue(error)}`);
      throw error;
    }
  }

  async remove(id: number): Promise<void> {
    await this.get(id);
    await this.repo.delete(id);
  }

  validateSteps(steps: StepValidationInput[]): void {
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];

      if (step.inPlace && step.outputExtension != null && step.outputExtension !== '') {
        throw new BadRequestException(
          `Step ${index + 1} has inPlace=true but specifies outputExtension "${step.outputExtension}". In-place steps cannot change the file extension.`,
        );
      }

      const keys = extractTemplateKeys(step.args);
      for (const key of keys) {
        if (!ALLOWED_TEMPLATE_KEYS_SET.has(key)) {
          throw new BadRequestException(
            `Step ${index + 1} uses unsupported template placeholder "{{${key}}}". Supported placeholders: ${WORKFLOW_TEMPLATE_KEYS.join(', ')}`,
          );
        }
      }
    }
  }
}
function toRequestTarget(target: CreateWorkflowDeliveryPreferenceDto['target']): WorkflowDeliveryTarget {
  if (target.type === 'opds' && target.opdsUserId != null) return { type: 'opds', opdsUserId: target.opdsUserId };
  if (target.type === 'koreader' && target.deviceId) return { type: 'koreader', deviceId: target.deviceId };
  throw new BadRequestException('Delivery target does not contain the required identifier');
}

function toDeliveryTarget(opdsUserId: number | null, koreaderDeviceId: string | null): WorkflowDeliveryTarget {
  if (opdsUserId != null && koreaderDeviceId == null) return { type: 'opds', opdsUserId };
  if (koreaderDeviceId != null && opdsUserId == null) return { type: 'koreader', deviceId: koreaderDeviceId };
  throw new BadRequestException('Invalid workflow delivery preference target');
}

function toStepInsert(step: StepValidationInput): NewStepInput {
  return {
    command: step.command ?? '',
    args: step.args,
    outputExtension: step.inPlace ? null : (step.outputExtension ?? null),
    inPlace: step.inPlace ?? false,
    timeoutSeconds: step.timeoutSeconds ?? 300,
  };
}
