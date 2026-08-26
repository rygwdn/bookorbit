import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowBulkRunFailure, WorkflowBulkRunResult, WorkflowDetail } from '@bookorbit/types'
import WorkflowBulkRunDialog from '../WorkflowBulkRunDialog.vue'

const workflowApi = vi.hoisted(() => ({
  listWorkflows: vi.fn<() => Promise<unknown>>(),
  runBookWorkflowsBulk: vi.fn<(workflowId: number, selection: unknown) => Promise<WorkflowBulkRunResult>>(),
  getWorkflowRunBatchStatusCounts: vi.fn<() => Promise<unknown>>(),
  getWorkflowRunBatchFailures: vi.fn<() => Promise<WorkflowBulkRunFailure[]>>(),
}))

vi.mock('../../api/workflow', () => workflowApi)

const toastMocks = vi.hoisted(() => ({
  success: vi.fn<(message: string) => void>(),
  warning: vi.fn<(message: string) => void>(),
}))

vi.mock('vue-sonner', () => ({ toast: toastMocks }))

const workflows: WorkflowDetail[] = [
  {
    id: 1,
    name: 'Shrink for e-ink',
    description: null,
    outputFormat: 'epub',
    inputFormats: [],
    outputFilenameTemplate: null,
    createdAt: '',
    updatedAt: '',
    steps: [],
  },
  {
    id: 2,
    name: 'KCC manga',
    description: null,
    outputFormat: 'cbz',
    inputFormats: [],
    outputFilenameTemplate: null,
    createdAt: '',
    updatedAt: '',
    steps: [],
  },
]

const selection = { bookIds: [7, 8] }

let wrapper: VueWrapper | undefined

function mountDialog(props: Record<string, unknown> = {}) {
  wrapper = mount(WorkflowBulkRunDialog, {
    props: {
      open: true,
      selection,
      selectionCount: 2,
      ...props,
    },
    global: {
      stubs: {
        Teleport: true,
      },
    },
  })
  return wrapper
}

describe('WorkflowBulkRunDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workflowApi.listWorkflows.mockResolvedValue(workflows)
    workflowApi.getWorkflowRunBatchStatusCounts.mockResolvedValue({ pending: 0, running: 0, success: 0, failed: 0 })
    workflowApi.getWorkflowRunBatchFailures.mockResolvedValue([])
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
  })

  it('renders workflow options once loaded', async () => {
    const dialog = mountDialog()
    await flushPromises()

    const options = dialog.find<HTMLSelectElement>('[data-testid="workflow-bulk-run-select"]').findAll('option')
    expect(options).toHaveLength(3)
    expect(options[0]?.text()).toBe('Select a workflow...')
    expect(options[1]?.text()).toBe('Shrink for e-ink')
    expect(options[2]?.text()).toContain('KCC manga')
  })

  it('keeps the run button disabled until a workflow is picked', async () => {
    const dialog = mountDialog()
    await flushPromises()

    const runButton = () => dialog.find('[data-testid="workflow-bulk-run-submit"]')
    expect((runButton().element as HTMLButtonElement).disabled).toBe(true)

    await dialog.find('[data-testid="workflow-bulk-run-select"]').setValue('2')
    expect((runButton().element as HTMLButtonElement).disabled).toBe(false)
  })

  it('runs the bulk run for the selected workflow with the given selection payload', async () => {
    workflowApi.runBookWorkflowsBulk.mockResolvedValue({ runBatchId: 'batch-1', queued: [7, 8], skipped: [] })
    const dialog = mountDialog()
    await flushPromises()

    await dialog.find('[data-testid="workflow-bulk-run-select"]').setValue('2')
    await dialog.find('[data-testid="workflow-bulk-run-submit"]').trigger('click')
    await flushPromises()

    expect(workflowApi.runBookWorkflowsBulk).toHaveBeenCalledTimes(1)
    expect(workflowApi.runBookWorkflowsBulk).toHaveBeenCalledWith(2, selection)
    expect(toastMocks.success).toHaveBeenCalledWith('Queued 2 books')
  })

  it('warns instead of celebrating when some books are skipped', async () => {
    workflowApi.runBookWorkflowsBulk.mockResolvedValue({
      runBatchId: 'batch-skip',
      queued: [7],
      skipped: [{ bookId: 8, reason: 'no matching input format' }],
    })
    const dialog = mountDialog()
    await flushPromises()

    await dialog.find('[data-testid="workflow-bulk-run-select"]').setValue('1')
    await dialog.find('[data-testid="workflow-bulk-run-submit"]').trigger('click')
    await flushPromises()

    expect(toastMocks.warning).toHaveBeenCalledTimes(1)
    expect(toastMocks.warning).toHaveBeenCalledWith(expect.stringContaining('skipped 1'))
    expect(toastMocks.success).not.toHaveBeenCalled()
  })

  it('surfaces request failures inline instead of closing', async () => {
    workflowApi.runBookWorkflowsBulk.mockRejectedValue(new Error('binary not found on PATH'))
    const dialog = mountDialog()
    await flushPromises()

    await dialog.find('[data-testid="workflow-bulk-run-select"]').setValue('1')
    await dialog.find('[data-testid="workflow-bulk-run-submit"]').trigger('click')
    await flushPromises()

    expect(dialog.find('[data-testid="workflow-bulk-run-error"]').text()).toBe('binary not found on PATH')
    expect(dialog.emitted('update:open')).toBeUndefined()
    expect(dialog.emitted('completed')).toBeUndefined()
  })

  it('polls batch-scoped status counts after queuing and reports completion when runs settle', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    workflowApi.runBookWorkflowsBulk.mockResolvedValue({ runBatchId: 'batch-1', queued: [7, 8], skipped: [] })
    workflowApi.getWorkflowRunBatchStatusCounts.mockResolvedValueOnce({ pending: 1, running: 1, success: 0, failed: 0 })

    const dialog = mountDialog()
    await flushPromises()

    await dialog.find('[data-testid="workflow-bulk-run-select"]').setValue('1')
    await dialog.find('[data-testid="workflow-bulk-run-submit"]').trigger('click')
    await flushPromises()

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000)
    expect(workflowApi.getWorkflowRunBatchStatusCounts).toHaveBeenCalledWith('batch-1')
    expect(workflowApi.getWorkflowRunBatchFailures).not.toHaveBeenCalled()
    expect(dialog.emitted('completed')).toBeUndefined()
    expect(dialog.find('[data-testid="workflow-bulk-run-count-running"]').text()).toBe('1')
    expect(dialog.find('[data-testid="workflow-bulk-run-progress-bar"]').attributes('style')).toContain('width: 0%')

    const pollCallback = setIntervalSpy.mock.calls[0]?.[0] as () => void

    workflowApi.getWorkflowRunBatchStatusCounts.mockResolvedValueOnce({ pending: 0, running: 0, success: 1, failed: 1 })
    workflowApi.getWorkflowRunBatchFailures.mockResolvedValueOnce([
      { bookId: 8, bookTitle: 'Dune', errorMessage: 'binary not found on PATH', finishedAt: '2026-01-01T00:00:00Z' },
    ])
    pollCallback()
    await flushPromises()
    expect(dialog.emitted('completed')).toHaveLength(1)
    expect(dialog.find('[data-testid="workflow-bulk-run-count-success"]').text()).toBe('1')
    expect(workflowApi.getWorkflowRunBatchFailures).toHaveBeenCalledWith('batch-1')
    expect(dialog.find('[data-testid="workflow-bulk-run-progress-bar"]').attributes('style')).toContain('width: 100%')
  })

  it('renders a progress bar and failure details while the batch settles', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    workflowApi.runBookWorkflowsBulk.mockResolvedValue({ runBatchId: 'batch-2', queued: [7, 8], skipped: [] })
    workflowApi.getWorkflowRunBatchStatusCounts.mockResolvedValue({ pending: 0, running: 1, success: 1, failed: 0 })

    const dialog = mountDialog()
    await flushPromises()

    await dialog.find('[data-testid="workflow-bulk-run-select"]').setValue('2')
    await dialog.find('[data-testid="workflow-bulk-run-submit"]').trigger('click')
    await flushPromises()

    expect(dialog.find('[data-testid="workflow-bulk-run-progress"]').text()).toContain('1 / 2 processed (50%)')
    expect(dialog.find('[data-testid="workflow-bulk-run-progress-bar"]').attributes('style')).toContain('width: 50%')
    expect(dialog.text()).not.toContain('Dune')

    workflowApi.getWorkflowRunBatchStatusCounts.mockResolvedValue({ pending: 0, running: 0, success: 1, failed: 1 })
    workflowApi.getWorkflowRunBatchFailures.mockResolvedValue([
      { bookId: 8, bookTitle: 'Dune', errorMessage: 'binary not found on PATH', finishedAt: '2026-01-01T00:00:00Z' },
    ])

    const pollCallback = setIntervalSpy.mock.calls[0]?.[0] as () => void
    pollCallback()
    await flushPromises()

    expect(dialog.find('[data-testid="workflow-bulk-run-progress"]').text()).toContain('2 / 2 processed (100%)')
    expect(dialog.text()).toContain('1 failure')
    expect(dialog.text()).toContain('Dune')
    expect(dialog.text()).toContain('binary not found on PATH')
  })

  it('labels the failures list as truncated when only some failed books are listed', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    workflowApi.runBookWorkflowsBulk.mockResolvedValue({ runBatchId: 'batch-3', queued: [7, 8], skipped: [] })
    workflowApi.getWorkflowRunBatchStatusCounts.mockResolvedValueOnce({ pending: 1, running: 0, success: 0, failed: 0 })

    const dialog = mountDialog()
    await flushPromises()

    await dialog.find('[data-testid="workflow-bulk-run-select"]').setValue('1')
    await dialog.find('[data-testid="workflow-bulk-run-submit"]').trigger('click')
    await flushPromises()

    workflowApi.getWorkflowRunBatchStatusCounts.mockResolvedValueOnce({ pending: 0, running: 0, success: 0, failed: 2 })
    workflowApi.getWorkflowRunBatchFailures.mockResolvedValueOnce([
      { bookId: 8, bookTitle: 'Dune', errorMessage: 'binary not found on PATH', finishedAt: '2026-01-01T00:00:00Z' },
    ])

    const pollCallback = setIntervalSpy.mock.calls[0]?.[0] as () => void
    pollCallback()
    await flushPromises()

    expect(dialog.text()).toContain('Showing latest 1 of 2')
  })

  it('skips polling entirely when every book was skipped', async () => {
    workflowApi.runBookWorkflowsBulk.mockResolvedValue({
      runBatchId: 'batch-empty',
      queued: [],
      skipped: [
        { bookId: 7, reason: 'no matching input format' },
        { bookId: 8, reason: 'no matching input format' },
      ],
    })
    const dialog = mountDialog()
    await flushPromises()

    await dialog.find('[data-testid="workflow-bulk-run-select"]').setValue('1')
    await dialog.find('[data-testid="workflow-bulk-run-submit"]').trigger('click')
    await flushPromises()

    expect(toastMocks.warning).toHaveBeenCalledTimes(1)
    expect(workflowApi.getWorkflowRunBatchStatusCounts).not.toHaveBeenCalled()
    expect(workflowApi.getWorkflowRunBatchFailures).not.toHaveBeenCalled()
    expect(dialog.find('[data-testid="workflow-bulk-run-progress"]').exists()).toBe(false)
    expect(dialog.emitted('completed')).toBeUndefined()
  })
})
