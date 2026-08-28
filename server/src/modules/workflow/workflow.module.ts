import { Module, forwardRef } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { WorkflowFileResolverService } from './workflow-file-resolver.service';
import { WorkflowLockService } from './workflow-lock.service';
import { WorkflowRunRepository } from './workflow-run.repository';
import { WorkflowRunBatchController, WorkflowRunController, WorkflowBulkRunController } from './workflow-run.controller';
import { WorkflowRunnerService } from './workflow-runner.service';
import { WorkflowController } from './workflow.controller';
import { WorkflowRepository } from './workflow.repository';
import { WorkflowService } from './workflow.service';

@Module({
  imports: [forwardRef(() => BookModule)],
  controllers: [WorkflowController, WorkflowRunController, WorkflowBulkRunController, WorkflowRunBatchController],
  providers: [WorkflowService, WorkflowRepository, WorkflowLockService, WorkflowRunRepository, WorkflowRunnerService, WorkflowFileResolverService],
  exports: [WorkflowService, WorkflowRepository, WorkflowFileResolverService],
})
export class WorkflowModule {}
