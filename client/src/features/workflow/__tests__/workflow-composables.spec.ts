import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookWorkflowStatus, CreateWorkflowRequest, WorkflowDetail } from '@bookorbit/types'
import { useWorkflows } from '../composables/useWorkflows'
import { useBookWorkflows } from '../composables/useBookWorkflows'
import * as apiModule from '../api/workflow'

vi.mock('../api/workflow', () => ({
  listWorkflows: vi.fn<() => Promise<WorkflowDetail[]>>(),
  getWorkflow: vi.fn<(id: number) => Promise<WorkflowDetail>>(),
  createWorkflow: vi.fn<(body: CreateWorkflowRequest) => Promise<WorkflowDetail>>(),
  updateWorkflow: vi.fn<(id: number, body: CreateWorkflowRequest) => Promise<WorkflowDetail>>(),
  deleteWorkflow: vi.fn<(id: number) => Promise<void>>(),
  getBookWorkflowStatuses: vi.fn<(bookId: number) => Promise<BookWorkflowStatus[]>>(),
  runBookWorkflow: vi.fn<(bookId: number, workflowId: number) => Promise<void>>(),
}))

const sampleWorkflow: WorkflowDetail = {
  id: 1,
  name: 'e-ink optimizer',
  description: 'Shrinks images',
  outputFormat: 'epub',
  inputFormats: ['epub', 'mobi'],
  outputFilenameTemplate: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  steps: [
    {
      id: 10,
      stepOrder: 1,
      command: 'optipng',
      args: ['-o7', '{{input}}'],
      outputExtension: null,
      inPlace: true,
      timeoutSeconds: 300,
    },
  ],
}

describe('useWorkflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads workflow list on refresh()', async () => {
    vi.mocked(apiModule.listWorkflows).mockResolvedValueOnce([sampleWorkflow])
    const { workflows, loading, error, refresh } = useWorkflows()

    await refresh()

    expect(loading.value).toBe(false)
    expect(error.value).toBeNull()
    expect(workflows.value).toEqual([sampleWorkflow])
  })

  it('captures errors on failed refresh', async () => {
    vi.mocked(apiModule.listWorkflows).mockRejectedValueOnce(new Error('Network error'))
    const { loading, error, refresh } = useWorkflows()

    await refresh()

    expect(loading.value).toBe(false)
    expect(error.value).toBe('Network error')
  })

  it('creates workflow and triggers refresh', async () => {
    const payload: CreateWorkflowRequest = {
      name: 'new-wf',
      description: null,
      outputFormat: 'epub',
      inputFormats: [],
      outputFilenameTemplate: null,
      steps: [{ command: 'echo', args: [], outputExtension: null, inPlace: false, timeoutSeconds: 300 }],
    }
    vi.mocked(apiModule.createWorkflow).mockResolvedValueOnce(sampleWorkflow)
    vi.mocked(apiModule.listWorkflows).mockResolvedValueOnce([sampleWorkflow])
    const { create, workflows } = useWorkflows()

    const result = await create(payload)

    expect(apiModule.createWorkflow).toHaveBeenCalledWith(payload)
    expect(result).toEqual(sampleWorkflow)
    expect(workflows.value).toEqual([sampleWorkflow])
  })

  it('removes workflow and triggers refresh', async () => {
    vi.mocked(apiModule.deleteWorkflow).mockResolvedValueOnce()
    vi.mocked(apiModule.listWorkflows).mockResolvedValueOnce([])
    const { remove, workflows } = useWorkflows()

    await remove(1)

    expect(apiModule.deleteWorkflow).toHaveBeenCalledWith(1)
    expect(workflows.value).toEqual([])
  })
})

describe('useBookWorkflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const sampleStatus: BookWorkflowStatus = {
    workflowId: 1,
    workflowName: 'e-ink optimizer',
    status: 'success',
    bookFileId: 42,
    errorMessage: null,
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:01:00Z',
    stale: false,
  }

  it('refreshes statuses', async () => {
    vi.mocked(apiModule.getBookWorkflowStatuses).mockResolvedValueOnce([sampleStatus])
    const { statuses, loading, refresh } = useBookWorkflows()

    await refresh(100)

    expect(loading.value).toBe(false)
    expect(statuses.value).toEqual([sampleStatus])
    expect(apiModule.getBookWorkflowStatuses).toHaveBeenCalledWith(100)
  })

  it('optimistically flips status to running during run() and refreshes afterward', async () => {
    vi.mocked(apiModule.getBookWorkflowStatuses).mockResolvedValue([sampleStatus])
    vi.mocked(apiModule.runBookWorkflow).mockImplementation(async () => {
      expect(statuses.value[0]?.status).toBe('running')
    })
    const { statuses, refresh, run } = useBookWorkflows()

    await refresh(100)
    expect(statuses.value[0]?.status).toBe('success')

    await run(100, 1)

    expect(apiModule.runBookWorkflow).toHaveBeenCalledWith(100, 1)
    expect(apiModule.getBookWorkflowStatuses).toHaveBeenCalledTimes(2)
  })

  it('refreshes even if run() throws', async () => {
    vi.mocked(apiModule.getBookWorkflowStatuses).mockResolvedValue([sampleStatus])
    vi.mocked(apiModule.runBookWorkflow).mockRejectedValueOnce(new Error('Server error'))
    const { refresh, run } = useBookWorkflows()

    await refresh(100)
    await expect(run(100, 1)).rejects.toThrow('Server error')

    expect(apiModule.getBookWorkflowStatuses).toHaveBeenCalledTimes(2)
  })
})
