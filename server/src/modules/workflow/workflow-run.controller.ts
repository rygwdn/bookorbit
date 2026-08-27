import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';

import { AuditAction, AuditResource, Permission, type BookWorkflowStatus, type WorkflowRunStatusCounts } from '@bookorbit/types';
import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import { RunWorkflowBulkDto } from './dto/run-workflow-bulk.dto';
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
    await this.workflowRunnerService.enqueueRun(bookId, workflowId);
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
  ): Promise<{ queued: number[]; skipped: { bookId: number; reason: string }[] }> {
    const bookIds = await this.bookService.resolveSelectionToIds(dto, user);
    return this.workflowRunnerService.enqueueRunBulk(bookIds, workflowId);
  }

  @Get(':workflowId/run-status-counts')
  async getRunStatusCounts(@Param('workflowId', ParseIntPipe) workflowId: number): Promise<WorkflowRunStatusCounts> {
    return this.workflowRunnerService.getRunStatusCounts(workflowId);
  }
}
