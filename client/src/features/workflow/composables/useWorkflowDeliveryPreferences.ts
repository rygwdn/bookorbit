import { ref } from 'vue'
import type { CreateWorkflowDeliveryPreferenceRequest, WorkflowDeliveryPreference } from '@bookorbit/types'
import { createWorkflowDeliveryPreference, deleteWorkflowDeliveryPreference, listWorkflowDeliveryPreferences } from '../api/workflow'

const preferences = ref<WorkflowDeliveryPreference[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

export function useWorkflowDeliveryPreferences() {
  async function refresh() {
    loading.value = true
    error.value = null
    try {
      preferences.value = await listWorkflowDeliveryPreferences()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load workflow delivery preferences'
    } finally {
      loading.value = false
    }
  }

  async function create(body: CreateWorkflowDeliveryPreferenceRequest): Promise<void> {
    await createWorkflowDeliveryPreference(body)
    await refresh()
  }

  async function remove(id: number): Promise<void> {
    await deleteWorkflowDeliveryPreference(id)
    preferences.value = preferences.value.filter((preference) => preference.id !== id)
  }

  return { preferences, loading, error, refresh, create, remove }
}
