import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';

import {
  AuditAction,
  AuditResource,
  Permission,
  type BookWorkflowStatus,
  type WorkflowBulkRunFailure,
  type WorkflowBulkRunResult,
  type WorkflowRunStatusCounts,
} from '@bookorbit/types';
import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import { RunWorkflowBulkDto } from './dto/run-workflow-bulk.dto';
import { RunBatchFailuresQueryDto } from './dto/run-batch-failures-query.dto';
import { WorkflowRunnerService } from './workflow-runner.service';

@Controller('books/:bookId/workflows')
@RequirePermission(Permission.RunWorkflows)
export class WorkflowRunController {
  constructor(
    private readonly workflowRunnerService: WorkflowRunnerService,
    private readonly bookService: BookService,
  ) {}

  @Get()
  async list(@Param('bookId', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser): Promise<BookWorkflowStatus[]> {
    await this.bookService.verifyBookAccess(bookId, user);
    return this.workflowRunnerService.listBookWorkflowStatuses(bookId);
  }

  @Post(':workflowId/run')
  @HttpCode(HttpStatus.ACCEPTED)
  @Auditable({
    action: AuditAction.WorkflowRun,
    resource: AuditResource.Workflow,
    getResourceId: (req) => parseInt(req.params['workflowId'] ?? '', 10) || undefined,
    description: (req) => `Triggered workflow #${req.params['workflowId']} on book #${req.params['bookId']}`,
  })
  async run(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Param('workflowId', ParseIntPipe) workflowId: number,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    await this.bookService.verifyBookAccess(bookId, user);
    await this.workflowRunnerService.enqueueRun(bookId, workflowId, user.id);
  }
}

@Controller('books/workflows')
@RequirePermission(Permission.RunWorkflows)
export class WorkflowBulkRunController {
  constructor(
    private readonly workflowRunnerService: WorkflowRunnerService,
    private readonly bookService: BookService,
  ) {}

  @Post(':workflowId/run-bulk')
  @Auditable({
    action: AuditAction.WorkflowRun,
    resource: AuditResource.Workflow,
    getResourceId: (req) => parseInt(req.params['workflowId'] ?? '', 10) || undefined,
    description: (req) => `Triggered bulk workflow #${req.params['workflowId']}`,
  })
  async runBulk(
    @Param('workflowId', ParseIntPipe) workflowId: number,
    @Body() dto: RunWorkflowBulkDto,
    @CurrentUser() user: RequestUser,
  ): Promise<WorkflowBulkRunResult> {
    const bookIds = await this.bookService.resolveSelectionToIds(dto, user);
    return this.workflowRunnerService.enqueueRunBulk(bookIds, workflowId, user.id);
  }
}
@Controller('books/workflow-runs')
@RequirePermission(Permission.RunWorkflows)
export class WorkflowRunBatchController {
  constructor(private readonly workflowRunnerService: WorkflowRunnerService) {}

  @Get(':runBatchId/status-counts')
  async getStatusCounts(@Param('runBatchId', ParseUUIDPipe) runBatchId: string, @CurrentUser() user: RequestUser): Promise<WorkflowRunStatusCounts> {
    return this.workflowRunnerService.getRunBatchStatusCounts(runBatchId, user.id);
  }

  @Get(':runBatchId/failures')
  async getFailures(
    @Param('runBatchId', ParseUUIDPipe) runBatchId: string,
    @Query() query: RunBatchFailuresQueryDto,
    @CurrentUser() user: RequestUser,
  ): Promise<WorkflowBulkRunFailure[]> {
    return this.workflowRunnerService.listRunBatchFailures(runBatchId, user.id, query.limit ?? 20);
  }
}
