import { ref } from 'vue'
import type { BookWorkflowStatus } from '@bookorbit/types'
import {
  getBookWorkflowPreference,
  getBookWorkflowStatuses,
  runBookWorkflow,
  setBookWorkflowPreference as apiSetBookWorkflowPreference,
} from '../api/workflow'

const statuses = ref<BookWorkflowStatus[]>([])
const preferenceWorkflowId = ref<number | null>(null)
const loading = ref(false)

export function useBookWorkflows() {
  async function refresh(bookId: number): Promise<void> {
    loading.value = true
    try {
      const [statusList, preference] = await Promise.all([getBookWorkflowStatuses(bookId), getBookWorkflowPreference(bookId)])
      statuses.value = statusList
      preferenceWorkflowId.value = preference.workflowId
    } finally {
      loading.value = false
    }
  }

  async function run(bookId: number, workflowId: number): Promise<void> {
    statuses.value = statuses.value.map((status) =>
      status.workflowId === workflowId ? { ...status, status: 'running', errorMessage: null } : status,
    )
    try {
      await runBookWorkflow(bookId, workflowId)
    } finally {
      await refresh(bookId)
    }
  }

  async function setPreference(bookId: number, workflowId: number | null): Promise<void> {
    await apiSetBookWorkflowPreference(bookId, workflowId)
    preferenceWorkflowId.value = workflowId
  }

  return { statuses, preferenceWorkflowId, loading, refresh, run, setPreference }
}
