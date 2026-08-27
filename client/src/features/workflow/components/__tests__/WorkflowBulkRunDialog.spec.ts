import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowDetail } from '@bookorbit/types'
import WorkflowBulkRunDialog from '../WorkflowBulkRunDialog.vue'

const workflowApi = vi.hoisted(() => ({
  listWorkflows: vi.fn<() => Promise<unknown>>(),
  runBookWorkflowsBulk:
    vi.fn<(workflowId: number, selection: unknown) => Promise<{ queued: number[]; skipped: { bookId: number; reason: string }[] }>>(),
  getWorkflowRunStatusCounts: vi.fn<() => Promise<unknown>>(),
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
    workflowApi.getWorkflowRunStatusCounts.mockResolvedValue({ pending: 0, running: 0, success: 0, failed: 0 })
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
    workflowApi.runBookWorkflowsBulk.mockResolvedValue({ queued: [7, 8], skipped: [] })
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

  it('polls status counts after queuing and reports completion when runs settle', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    workflowApi.runBookWorkflowsBulk.mockResolvedValue({ queued: [7, 8], skipped: [] })
    workflowApi.getWorkflowRunStatusCounts.mockResolvedValueOnce({ pending: 1, running: 1, success: 0, failed: 0 })

    const dialog = mountDialog()
    await flushPromises()

    await dialog.find('[data-testid="workflow-bulk-run-select"]').setValue('1')
    await dialog.find('[data-testid="workflow-bulk-run-submit"]').trigger('click')
    await flushPromises()

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000)
    expect(dialog.emitted('completed')).toBeUndefined()
    expect(dialog.find('[data-testid="workflow-bulk-run-count-running"]').text()).toBe('1')

    const pollCallback = setIntervalSpy.mock.calls[0]?.[0] as () => void

    workflowApi.getWorkflowRunStatusCounts.mockResolvedValueOnce({ pending: 0, running: 0, success: 1, failed: 1 })
    pollCallback()
    await flushPromises()
    expect(dialog.emitted('completed')).toHaveLength(1)
    expect(dialog.find('[data-testid="workflow-bulk-run-count-success"]').text()).toBe('1')
  })
})
