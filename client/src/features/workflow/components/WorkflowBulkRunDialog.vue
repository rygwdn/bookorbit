<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { BOOK_WORKFLOW_STATUSES, type BookSelectionPayload, type BookWorkflowRunStatus } from '@bookorbit/types'
import { useWorkflowBulkRun } from '../composables/useWorkflowBulkRun'

const props = defineProps<{
  open: boolean
  selection: BookSelectionPayload
  selectionCount: number
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  completed: []
}>()

const { t } = useI18n()
const { workflows, loading, submitting, error, statusCounts, loadWorkflows, run, pollStatusCounts, stopPolling, reset } = useWorkflowBulkRun()

const STATUS_KEYS: readonly BookWorkflowRunStatus[] = BOOK_WORKFLOW_STATUSES
const SELECT_TESTID = 'workflow-bulk-run-select'

const selectedWorkflowId = ref<number | null>(null)
// True between a successful run() response and the moment polled counts settle; gates the one-shot `completed` emission.
let awaitingCompletion = false

const statusLabels = computed<Record<BookWorkflowRunStatus, string>>(() => ({
  pending: t('workflow.bulkRun.status.pending'),
  running: t('workflow.bulkRun.status.running'),
  success: t('workflow.bulkRun.status.success'),
  failed: t('workflow.bulkRun.status.failed'),
}))

const canRun = computed(() => selectedWorkflowId.value !== null && !submitting.value)

watch(
  () => props.open,
  (open) => {
    if (!open) {
      stopPolling()
      return
    }
    reset()
    selectedWorkflowId.value = null
    awaitingCompletion = false
    void loadWorkflows().catch((loadError) => {
      error.value = loadError instanceof Error ? loadError.message : t('workflow.bulkRun.loadError')
    })
  },
  { immediate: true },
)

watch(statusCounts, (counts) => {
  if (!awaitingCompletion || !counts) return
  if (counts.pending + counts.running > 0) return
  awaitingCompletion = false
  emit('completed')
})

async function handleRun() {
  const workflowId = selectedWorkflowId.value
  if (workflowId === null || submitting.value) return

  error.value = null
  submitting.value = true
  try {
    const result = await run(workflowId, props.selection)
    if (result.skipped.length === 0) {
      toast.success(t('workflow.bulkRun.toast.success', { queued: result.queued.length }))
    } else {
      toast.warning(t('workflow.bulkRun.toast.warning', { queued: result.queued.length, skipped: result.skipped.length }))
    }
    awaitingCompletion = true
    pollStatusCounts(workflowId)
  } catch (runError) {
    error.value = runError instanceof Error ? runError.message : t('workflow.bulkRun.runError')
  } finally {
    submitting.value = false
  }
}

function handleClose() {
  if (submitting.value) return
  stopPolling()
  emit('update:open', false)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="handleClose" />
      <div class="relative z-10 w-full max-w-lg mx-4 max-h-[90vh] bg-card border border-border rounded-lg shadow-2xl flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 class="text-base font-semibold text-foreground">{{ t('workflow.bulkRun.title', { count: selectionCount }) }}</h2>
          <button
            type="button"
            class="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            :disabled="submitting"
            @click="handleClose"
          >
            <X :size="18" />
          </button>
        </div>

        <!-- Scrollable body -->
        <div class="overflow-y-auto px-6 py-4 space-y-4 min-h-0">
          <div class="space-y-2">
            <label for="workflow-bulk-run-select" class="text-sm font-medium text-foreground">
              {{ t('workflow.bulkRun.workflowLabel') }}
            </label>
            <select
              id="workflow-bulk-run-select"
              v-model.number="selectedWorkflowId"
              :data-testid="SELECT_TESTID"
              class="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-40"
              :disabled="loading || submitting"
            >
              <option :value="undefined" disabled>{{ t('workflow.bulkRun.workflowPlaceholder') }}</option>
              <option v-for="workflow in workflows" :key="workflow.id" :value="workflow.id">{{ workflow.name }}</option>
            </select>
            <p v-if="loading" class="flex items-center gap-1.5 text-sm text-muted-foreground">
              <svg class="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {{ t('workflow.bulkRun.loadingWorkflows') }}
            </p>
            <p v-else-if="workflows.length === 0" class="text-sm text-muted-foreground">
              {{ t('workflow.bulkRun.noWorkflows') }}
            </p>
          </div>

          <!-- Inline request error -->
          <p v-if="error" class="text-sm text-destructive" data-testid="workflow-bulk-run-error">{{ error }}</p>

          <!-- Live status counts while polling -->
          <div v-if="statusCounts" class="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-border px-4 py-3">
            <div v-for="key in STATUS_KEYS" :key="key" class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">{{ statusLabels[key] }}</span>
              <span class="font-medium tabular-nums text-foreground" :data-testid="`workflow-bulk-run-count-${key}`">
                {{ statusCounts[key] }}
              </span>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
          <button
            type="button"
            class="h-9 px-4 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            :disabled="submitting"
            @click="handleClose"
          >
            {{ t('workflow.bulkRun.cancel') }}
          </button>
          <button
            type="button"
            data-testid="workflow-bulk-run-submit"
            :disabled="!canRun"
            class="h-9 px-4 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            @click="handleRun"
          >
            <svg v-if="submitting" class="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {{ submitting ? t('workflow.bulkRun.running') : t('workflow.bulkRun.runButton') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
