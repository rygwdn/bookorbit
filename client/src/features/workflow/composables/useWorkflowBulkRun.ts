import { onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'
import type { BookSelectionPayload, WorkflowBulkRunFailure, WorkflowBulkRunResult, WorkflowDetail, WorkflowRunStatusCounts } from '@bookorbit/types'
import { getWorkflowRunBatchFailures, getWorkflowRunBatchStatusCounts, listWorkflows, runBookWorkflowsBulk } from '../api/workflow'

const POLL_INTERVAL_MS = 5000

export function useWorkflowBulkRun() {
  const workflows: Ref<WorkflowDetail[]> = ref([])
  const loading = ref(false)
  const submitting = ref(false)
  const error = ref<string | null>(null)
  const statusCounts: Ref<WorkflowRunStatusCounts | null> = ref(null)
  const runBatchId: Ref<string | null> = ref(null)
  const queuedCount: Ref<number> = ref(0)
  const failures: Ref<WorkflowBulkRunFailure[]> = ref([])

  let pollTimer: number | null = null

  async function loadWorkflows(): Promise<void> {
    loading.value = true
    try {
      workflows.value = await listWorkflows()
    } finally {
      loading.value = false
    }
  }

  async function run(workflowId: number, selection: BookSelectionPayload): Promise<WorkflowBulkRunResult> {
    return runBookWorkflowsBulk(workflowId, selection)
  }

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  function pollStatusCounts(batchId: string, totalQueued: number): void {
    stopPolling()
    statusCounts.value = null
    failures.value = []
    runBatchId.value = batchId
    queuedCount.value = totalQueued
    const tick = (): void => {
      void getWorkflowRunBatchStatusCounts(batchId)
        .then(async (counts) => {
          statusCounts.value = counts
          if (counts.pending + counts.running === 0) stopPolling()
          if (counts.failed > 0) {
            failures.value = await getWorkflowRunBatchFailures(batchId)
          }
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
    runBatchId.value = null
    queuedCount.value = 0
    failures.value = []
  }

  onUnmounted(stopPolling)

  return {
    workflows,
    loading,
    submitting,
    error,
    statusCounts,
    runBatchId,
    queuedCount,
    failures,
    loadWorkflows,
    run,
    pollStatusCounts,
    stopPolling,
    reset,
  }
}
