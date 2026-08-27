import { Test } from '@nestjs/testing';

import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import { WorkflowBulkRunController, WorkflowRunController } from './workflow-run.controller';
import { WorkflowRunnerService } from './workflow-runner.service';

type MockBookService = {
  verifyBookAccess: ReturnType<typeof vi.fn>;
  resolveSelectionToIds: ReturnType<typeof vi.fn>;
};

type MockRunnerService = {
  listBookWorkflowStatuses: ReturnType<typeof vi.fn>;
  enqueueRun: ReturnType<typeof vi.fn>;
  enqueueRunBulk: ReturnType<typeof vi.fn>;
  getRunStatusCounts: ReturnType<typeof vi.fn>;
};

function makeBookService(): MockBookService {
  return {
    verifyBookAccess: vi.fn(),
    resolveSelectionToIds: vi.fn(),
  };
}

function makeRunnerService(): MockRunnerService {
  return {
    listBookWorkflowStatuses: vi.fn(),
    enqueueRun: vi.fn(),
    enqueueRunBulk: vi.fn(),
    getRunStatusCounts: vi.fn(),
  };
}

function makeUser(): RequestUser {
  return {
    id: 1,
    username: 'tester',
    name: 'Tester',
    email: null,
    active: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    isSuperuser: false,
    permissions: [],
    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

describe('WorkflowRunController', () => {
  let controller: WorkflowRunController;
  let bookService: MockBookService;
  let runnerService: MockRunnerService;

  beforeEach(async () => {
    bookService = makeBookService();
    runnerService = makeRunnerService();
    const module = await Test.createTestingModule({
      controllers: [WorkflowRunController],
      providers: [
        { provide: BookService, useValue: bookService },
        { provide: WorkflowRunnerService, useValue: runnerService },
      ],
    }).compile();
    controller = module.get(WorkflowRunController);
  });

  describe('list', () => {
    it('verifies book access and returns statuses for the book', async () => {
      const user = makeUser();
      const statuses = [{ workflowId: 10, status: 'success' }];
      runnerService.listBookWorkflowStatuses.mockResolvedValue(statuses);

      await expect(controller.list(42, user)).resolves.toBe(statuses);

      expect(bookService.verifyBookAccess).toHaveBeenCalledWith(42, user);
      expect(runnerService.listBookWorkflowStatuses).toHaveBeenCalledWith(42);
    });
  });

  describe('run', () => {
    it('verifies book access and enqueues a single run', async () => {
      const user = makeUser();
      bookService.verifyBookAccess.mockResolvedValue(undefined);
      runnerService.enqueueRun.mockResolvedValue({ id: 50, status: 'pending' });

      await expect(controller.run(42, 10, user)).resolves.toBeUndefined();

      expect(bookService.verifyBookAccess).toHaveBeenCalledWith(42, user);
      expect(runnerService.enqueueRun).toHaveBeenCalledWith(42, 10);
    });

    it('does not enqueue when book access fails', async () => {
      const user = makeUser();
      bookService.verifyBookAccess.mockRejectedValue(new Error('access denied'));

      await expect(controller.run(42, 10, user)).rejects.toThrow('access denied');
      expect(runnerService.enqueueRun).not.toHaveBeenCalled();
    });
  });
});

describe('WorkflowBulkRunController', () => {
  let controller: WorkflowBulkRunController;
  let bookService: MockBookService;
  let runnerService: MockRunnerService;

  beforeEach(async () => {
    bookService = makeBookService();
    runnerService = makeRunnerService();
    const module = await Test.createTestingModule({
      controllers: [WorkflowBulkRunController],
      providers: [
        { provide: BookService, useValue: bookService },
        { provide: WorkflowRunnerService, useValue: runnerService },
      ],
    }).compile();
    controller = module.get(WorkflowBulkRunController);
  });

  describe('runBulk', () => {
    it('resolves the selection via the shared bulk endpoint pattern and forwards ids verbatim', async () => {
      const user = makeUser();
      const dto = { bookIds: [7, 9] };
      bookService.resolveSelectionToIds.mockResolvedValue([7, 9]);
      const expected = {
        queued: [7],
        skipped: [{ bookId: 9, reason: 'book has no primary content file' }],
      };
      runnerService.enqueueRunBulk.mockResolvedValue(expected);

      await expect(controller.runBulk(10, dto, user)).resolves.toBe(expected);

      expect(bookService.resolveSelectionToIds).toHaveBeenCalledWith(dto, user);
      expect(bookService.resolveSelectionToIds).toHaveBeenCalledTimes(1);
      expect(runnerService.enqueueRunBulk).toHaveBeenCalledWith([7, 9], 10);
    });

    it('never calls per-book access checks directly', async () => {
      const user = makeUser();
      bookService.resolveSelectionToIds.mockResolvedValue([]);

      await controller.runBulk(10, { bookIds: [7] }, user);

      expect(bookService.verifyBookAccess).not.toHaveBeenCalled();
    });

    it('passes query-shaped selections through unchanged', async () => {
      const user = makeUser();
      const dto = { query: { libraryId: 5, q: 'dune' } };
      bookService.resolveSelectionToIds.mockResolvedValue([1, 2]);
      runnerService.enqueueRunBulk.mockResolvedValue({ queued: [1, 2], skipped: [] });

      await controller.runBulk(10, dto, user);

      expect(bookService.resolveSelectionToIds).toHaveBeenCalledWith(dto, user);
      expect(runnerService.enqueueRunBulk).toHaveBeenCalledWith([1, 2], 10);
    });
  });

  describe('getRunStatusCounts', () => {
    it('returns the zero-filled status counts for the workflow', async () => {
      const counts = { pending: 0, running: 2, success: 14, failed: 1 };
      runnerService.getRunStatusCounts.mockResolvedValue(counts);

      await expect(controller.getRunStatusCounts(10)).resolves.toBe(counts);

      expect(runnerService.getRunStatusCounts).toHaveBeenCalledWith(10);
    });
  });
});
