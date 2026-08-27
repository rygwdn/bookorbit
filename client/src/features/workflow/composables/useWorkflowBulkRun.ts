import { onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'
import type { BookSelectionPayload, WorkflowDetail, WorkflowRunStatusCounts } from '@bookorbit/types'
import { getWorkflowRunStatusCounts, listWorkflows, runBookWorkflowsBulk } from '../api/workflow'

const POLL_INTERVAL_MS = 5000

export function useWorkflowBulkRun() {
  const workflows: Ref<WorkflowDetail[]> = ref([])
  const loading = ref(false)
  const submitting = ref(false)
  const error = ref<string | null>(null)
  const statusCounts: Ref<WorkflowRunStatusCounts | null> = ref(null)

  let pollTimer: number | null = null

  async function loadWorkflows(): Promise<void> {
    loading.value = true
    try {
      workflows.value = await listWorkflows()
    } finally {
      loading.value = false
    }
  }

  async function run(
    workflowId: number,
    selection: BookSelectionPayload,
  ): Promise<{ queued: number[]; skipped: { bookId: number; reason: string }[] }> {
    return runBookWorkflowsBulk(workflowId, selection)
  }

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  function pollStatusCounts(workflowId: number): void {
    stopPolling()
    statusCounts.value = null
    const tick = (): void => {
      void getWorkflowRunStatusCounts(workflowId)
        .then((counts) => {
          statusCounts.value = counts
          if (counts.pending + counts.running === 0) stopPolling()
        })
        .catch(() => stopPolling())
    }
    tick()
    pollTimer = window.setInterval(tick, POLL_INTERVAL_MS)
  }

  function reset(): void {
    stopPolling()
    workflows.value = []
    loading.value = false
    submitting.value = false
    error.value = null
    statusCounts.value = null
  }

  onUnmounted(stopPolling)

  return { workflows, loading, submitting, error, statusCounts, loadWorkflows, run, pollStatusCounts, stopPolling, reset }
}
