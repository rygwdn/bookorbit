import { ref } from 'vue'
import type { BookWorkflowStatus } from '@bookorbit/types'
import { getBookWorkflowStatuses, runBookWorkflow } from '../api/workflow'

const statuses = ref<BookWorkflowStatus[]>([])
const loading = ref(false)

export function useBookWorkflows() {
  async function refresh(bookId: number): Promise<void> {
    loading.value = true
    try {
      statuses.value = await getBookWorkflowStatuses(bookId)
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

  return { statuses, loading, refresh, run }
}
