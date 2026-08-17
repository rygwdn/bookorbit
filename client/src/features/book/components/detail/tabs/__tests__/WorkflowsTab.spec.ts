import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookDetail } from '@bookorbit/types'
import WorkflowsTab from '../WorkflowsTab.vue'

type MockResponse = { ok: boolean; json: () => Promise<unknown> }
type ApiInit = { method?: string; body?: string }
const api = vi.fn<(url: string, init?: ApiInit) => Promise<MockResponse>>()
vi.mock('@/lib/api', () => ({ api: (...args: [string, ApiInit?]) => api(...args) }))

function response(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) })
}

const book = { id: 42 } as BookDetail

const workflows = [
  { id: 1, name: 'Shrink for e-ink', description: null, outputFormat: 'epub', inputFormats: [], createdAt: '', updatedAt: '', steps: [] },
  { id: 2, name: 'KCC manga', description: null, outputFormat: 'cbz', inputFormats: [], createdAt: '', updatedAt: '', steps: [] },
  { id: 3, name: 'PDF crush', description: null, outputFormat: 'pdf', inputFormats: [], createdAt: '', updatedAt: '', steps: [] },
]

const statuses = [
  {
    workflowId: 1,
    workflowName: 'Shrink for e-ink',
    status: 'success',
    bookFileId: 10,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    stale: false,
  },
  {
    workflowId: 3,
    workflowName: 'PDF crush',
    status: 'failed',
    bookFileId: null,
    errorMessage: 'binary not found on PATH',
    startedAt: null,
    finishedAt: null,
    stale: true,
  },
]

describe('WorkflowsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.mockImplementation((url, init) => {
      if (url === '/api/v1/workflows') return response(workflows)
      if (url === '/api/v1/books/42/workflows') return response(statuses)
      if (url === '/api/v1/books/42/workflows/preference') {
        if (init?.method === 'PUT') return response({})
        return response({ workflowId: null })
      }
      if (url === '/api/v1/books/42/workflows/2/run' && init?.method === 'POST') return response(undefined)
      return response({})
    })
  })

  it('renders per-workflow status, marking unrun workflows and surfacing failure/stale info', async () => {
    const wrapper = mount(WorkflowsTab, { props: { book } })
    await flushPromises()

    expect(wrapper.text()).toContain('Shrink for e-ink')
    expect(wrapper.text()).toContain('Success')
    expect(wrapper.text()).toContain('KCC manga')
    expect(wrapper.text()).toContain('Never run')
    expect(wrapper.text()).toContain('PDF crush')
    expect(wrapper.text()).toContain('Failed')
    expect(wrapper.text()).toContain('binary not found on PATH')
    expect(wrapper.text()).toContain('Stale')
  })

  it('offers only successfully-run workflows as preference options and PUTs the choice', async () => {
    const wrapper = mount(WorkflowsTab, { props: { book } })
    await flushPromises()

    const select = wrapper.get('#workflow-preference')
    const optionLabels = select.findAll('option').map((o) => o.text())
    expect(optionLabels).toEqual(['None (original file)', 'Shrink for e-ink'])

    await select.setValue('1')
    await flushPromises()

    expect(api).toHaveBeenCalledWith(
      '/api/v1/books/42/workflows/preference',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ workflowId: 1 }) }),
    )
  })

  it('runs the workflow for the clicked row only', async () => {
    const wrapper = mount(WorkflowsTab, { props: { book } })
    await flushPromises()

    const kccRow = wrapper.findAll('.space-y-2').find((row) => row.text().includes('KCC manga'))
    expect(kccRow).toBeTruthy()
    await kccRow!.get('button').trigger('click')
    await flushPromises()

    expect(api).toHaveBeenCalledWith('/api/v1/books/42/workflows/2/run', expect.objectContaining({ method: 'POST' }))
    expect(api).not.toHaveBeenCalledWith('/api/v1/books/42/workflows/1/run', expect.anything())
  })
})
