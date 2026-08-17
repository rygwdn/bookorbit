import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { Permission } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { WorkflowService } from './workflow.service';
import type { WorkflowRepository } from './workflow.repository';

const testUser: RequestUser = {
  id: 1,
  username: 'admin',
  name: 'Admin',
  email: 'admin@example.com',
  active: true,
  isSuperuser: true,
  isDefaultPassword: false,
  tokenVersion: 1,
  settings: {},
  avatarUrl: null,
  provisioningMethod: 'local',
  permissions: [Permission.ManageWorkflows, Permission.RunWorkflows],
  contentFilters: { adult: 'allow', excludedTags: [], excludedGenres: [] },
};

describe('WorkflowService', () => {
  let service: WorkflowService;
  const mockFindAll = vi.fn();
  const mockFindById = vi.fn();
  const mockCreate = vi.fn();
  const mockUpdate = vi.fn();
  const mockDelete = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    service = new WorkflowService({
      findAll: mockFindAll,
      findById: mockFindById,
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
    } as unknown as WorkflowRepository);
  });

  describe('validateSteps', () => {
    it('rejects an unknown placeholder (e.g. {{nope}})', () => {
      expect(() =>
        service.validateSteps([
          {
            command: 'tool',
            args: ['--input', '{{input}}', '--invalid', '{{nope}}'],
            outputExtension: 'epub',
            inPlace: false,
          },
        ]),
      ).toThrow(BadRequestException);
    });

    it('rejects inPlace: true combined with outputExtension set', () => {
      expect(() =>
        service.validateSteps([
          {
            command: 'tool',
            args: ['--input', '{{input}}'],
            outputExtension: 'mobi',
            inPlace: true,
          },
        ]),
      ).toThrow(BadRequestException);
    });

    it('passes for valid steps with allowed placeholders and proper inPlace/outputExtension settings', () => {
      expect(() =>
        service.validateSteps([
          {
            command: 'tool-step-1',
            args: ['{{input}}', '{{output}}', '{{workDir}}', '{{title}}', '{{authors}}', '{{series}}', '{{format}}', '{{bookId}}'],
            outputExtension: 'kepub.epub',
            inPlace: false,
          },
          {
            command: 'tool-step-2',
            args: ['--fix-in-place', '{{input}}'],
            outputExtension: null,
            inPlace: true,
          },
        ]),
      ).not.toThrow();
    });
  });

  describe('CRUD operations', () => {
    it('list returns all workflows', async () => {
      mockFindAll.mockResolvedValue([{ id: 1, name: 'E-ink optimize' }]);
      const result = await service.list();
      expect(result).toEqual([{ id: 1, name: 'E-ink optimize' }]);
    });

    it('get throws NotFoundException when workflow is missing', async () => {
      mockFindById.mockResolvedValue(undefined);
      await expect(service.get(999)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('create maps unique constraint violation code 23505 to ConflictException', async () => {
      mockCreate.mockRejectedValue({ code: '23505' });
      await expect(
        service.create(
          {
            name: 'Duplicate',
            outputFormat: 'epub',
            steps: [{ command: 'cp', args: ['{{input}}', '{{output}}'] }],
          },
          testUser,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('update throws NotFoundException if workflow does not exist', async () => {
      mockFindById.mockResolvedValue(undefined);
      await expect(
        service.update(999, {
          name: 'Updated',
          outputFormat: 'epub',
          steps: [{ command: 'cp', args: ['{{input}}', '{{output}}'] }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('update maps unique constraint violation code 23505 to ConflictException', async () => {
      mockFindById.mockResolvedValue({ id: 1, name: 'Existing' });
      mockUpdate.mockRejectedValue({ code: '23505' });
      await expect(
        service.update(1, {
          name: 'Duplicate Name',
          outputFormat: 'epub',
          steps: [{ command: 'cp', args: ['{{input}}', '{{output}}'] }],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('remove deletes workflow after asserting it exists', async () => {
      mockFindById.mockResolvedValue({ id: 1, name: 'To Delete' });
      mockDelete.mockResolvedValue(undefined);
      await service.remove(1);
      expect(mockDelete).toHaveBeenCalledWith(1);
    });
  });
});
