import { ref } from 'vue'
import type { CreateWorkflowRequest, UpdateWorkflowRequest, WorkflowDetail } from '@bookorbit/types'
import { createWorkflow, deleteWorkflow, listWorkflows, updateWorkflow } from '../api/workflow'

const workflows = ref<WorkflowDetail[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

export function useWorkflows() {
  async function refresh() {
    loading.value = true
    error.value = null
    try {
      workflows.value = await listWorkflows()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load workflows'
    } finally {
      loading.value = false
    }
  }

  async function create(body: CreateWorkflowRequest): Promise<WorkflowDetail> {
    const workflow = await createWorkflow(body)
    await refresh()
    return workflow
  }

  async function update(id: number, body: UpdateWorkflowRequest): Promise<WorkflowDetail> {
    const workflow = await updateWorkflow(id, body)
    await refresh()
    return workflow
  }

  async function remove(id: number): Promise<void> {
    await deleteWorkflow(id)
    await refresh()
  }

  return { workflows, loading, error, refresh, create, update, remove }
}
