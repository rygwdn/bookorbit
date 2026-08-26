import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';

import { AuditAction, AuditResource, Permission, type BookWorkflowStatus } from '@bookorbit/types';
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
    const accessibleBookIds: number[] = [];
    const skipped: { bookId: number; reason: string }[] = [];

    const uniqueIds = [...new Set(dto.bookIds)];
    for (const bookId of uniqueIds) {
      try {
        await this.bookService.verifyBookAccess(bookId, user);
        accessibleBookIds.push(bookId);
      } catch {
        skipped.push({ bookId, reason: 'access denied or book not found' });
      }
    }

    const result = await this.workflowRunnerService.enqueueRunBulk(accessibleBookIds, workflowId);
    return {
      queued: result.queued,
      skipped: [...skipped, ...result.skipped],
    };
  }
}
