import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import type * as ApiModule from '@/lib/api'
import WorkflowsSettings from '../WorkflowsSettings.vue'

type MockResponse = { ok: boolean; json: () => Promise<unknown> }
type ApiInit = { method?: string; body?: string }
const apiMock = vi.fn<(url: string, init?: ApiInit) => Promise<MockResponse>>()
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return { ...actual, api: (...args: [string, ApiInit?]) => apiMock(...args) }
})

function response(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) })
}

const workflow = {
  id: 1,
  name: 'Shrink for e-ink',
  description: null,
  outputFormat: 'epub',
  inputFormats: [],
  createdAt: '',
  updatedAt: '',
  steps: [],
}

describe('WorkflowsSettings', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.mockImplementation((url) => {
      if (url === '/api/v1/workflows') return response([workflow])
      if (url === '/api/v1/workflows/preferences') return response([])
      return response({})
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
  })

  it('opens the create-workflow dialog when "New workflow" is clicked', async () => {
    wrapper = mount(WorkflowsSettings, { props: { embedded: true } })
    await flushPromises()

    const newWorkflowButton = wrapper.findAll('button').find((b) => b.text().toLowerCase().includes('new workflow'))
    expect(newWorkflowButton).toBeTruthy()
    await newWorkflowButton!.trigger('click')
    await flushPromises()

    expect(document.body.querySelector('#workflow-name')).toBeTruthy()
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy()
  })

  it('opens the edit dialog pre-filled with the workflow name when the pencil icon is clicked', async () => {
    wrapper = mount(WorkflowsSettings, { props: { embedded: true } })
    await flushPromises()

    await wrapper.get('button[aria-label="Edit workflow"]').trigger('click')
    await flushPromises()

    const nameInput = document.body.querySelector<HTMLInputElement>('#workflow-name')
    expect(nameInput).toBeTruthy()
    expect(nameInput!.value).toBe('Shrink for e-ink')
  })
})
