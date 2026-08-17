import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { WORKFLOW_TEMPLATE_KEYS, type WorkflowDetail } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { CreateWorkflowDto } from './dto/create-workflow.dto';
import type { UpdateWorkflowDto } from './dto/update-workflow.dto';
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

  constructor(private readonly repo: WorkflowRepository) {}

  async list(): Promise<WorkflowDetail[]> {
    return this.repo.findAll();
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

function toStepInsert(step: StepValidationInput): NewStepInput {
  return {
    command: step.command ?? '',
    args: step.args,
    outputExtension: step.inPlace ? null : (step.outputExtension ?? null),
    inPlace: step.inPlace ?? false,
    timeoutSeconds: step.timeoutSeconds ?? 300,
  };
}
