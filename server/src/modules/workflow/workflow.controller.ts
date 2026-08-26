import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';

import { AuditAction, AuditResource, Permission, type WorkflowDetail } from '@bookorbit/types';
import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { CreateWorkflowDeliveryPreferenceDto } from './dto/workflow-delivery-preference.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { WorkflowService } from './workflow.service';

function resolveResourceId(_: unknown, res: unknown): number | undefined {
  if (res && typeof res === 'object' && 'id' in res && typeof res.id === 'number') {
    return res.id;
  }
  return undefined;
}

function resolveCreatedDescription(_: unknown, res: unknown): string {
  const name = res && typeof res === 'object' && 'name' in res && typeof res.name === 'string' ? res.name : 'unknown';
  return `Created workflow '${name}'`;
}

@Controller('workflows')
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Get()
  @RequirePermission(Permission.RunWorkflows)
  async list(): Promise<WorkflowDetail[]> {
    return this.workflowService.list();
  }

  @Get('preferences')
  @RequirePermission(Permission.RunWorkflows)
  async listPreferences(@CurrentUser() user: RequestUser) {
    return this.workflowService.listDeliveryPreferences(user.id);
  }

  @Post('preferences')
  @RequirePermission(Permission.RunWorkflows)
  async createPreference(@CurrentUser() user: RequestUser, @Body() dto: CreateWorkflowDeliveryPreferenceDto): Promise<void> {
    await this.workflowService.createDeliveryPreference(user.id, dto);
  }

  @Delete('preferences/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.RunWorkflows)
  async removePreference(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.workflowService.removeDeliveryPreference(user.id, id);
  }

  @Get(':id')
  @RequirePermission(Permission.RunWorkflows)
  async get(@Param('id', ParseIntPipe) id: number): Promise<WorkflowDetail> {
    return this.workflowService.get(id);
  }

  @Post()
  @RequirePermission(Permission.ManageWorkflows)
  @Auditable({
    action: AuditAction.WorkflowCreate,
    resource: AuditResource.Workflow,
    getResourceId: resolveResourceId,
    description: resolveCreatedDescription,
  })
  async create(@Body() dto: CreateWorkflowDto, @CurrentUser() user: RequestUser): Promise<WorkflowDetail> {
    return this.workflowService.create(dto, user);
  }

  @Patch(':id')
  @RequirePermission(Permission.ManageWorkflows)
  @Auditable({
    action: AuditAction.WorkflowUpdate,
    resource: AuditResource.Workflow,
    getResourceId: (req) => parseInt(req.params['id'] ?? '', 10) || undefined,
    description: (req) => `Updated workflow #${req.params['id']}`,
  })
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWorkflowDto): Promise<WorkflowDetail> {
    return this.workflowService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ManageWorkflows)
  @Auditable({
    action: AuditAction.WorkflowDelete,
    resource: AuditResource.Workflow,
    getResourceId: (req) => parseInt(req.params['id'] ?? '', 10) || undefined,
    description: (req) => `Deleted workflow #${req.params['id']}`,
  })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.workflowService.remove(id);
  }
}
