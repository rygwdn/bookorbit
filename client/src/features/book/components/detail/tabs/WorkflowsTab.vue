<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Loader2, Play, Workflow as WorkflowIcon } from '@lucide/vue'
import type { BookDetail, WorkflowDetail } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { listWorkflows } from '@/features/workflow/api/workflow'
import { useBookWorkflows } from '@/features/workflow/composables/useBookWorkflows'

const props = defineProps<{ book: BookDetail }>()

const { t } = useI18n()

const { statuses, loading, refresh, run } = useBookWorkflows()

const workflows = ref<WorkflowDetail[]>([])
const workflowsLoading = ref(false)
const workflowsError = ref<string | null>(null)
const runningIds = ref<Set<number>>(new Set())
const runErrors = ref<Record<number, string>>({})
const statusLabels: Record<string, string> = {
  pending: t('book.detail.workflows.status.pending'),
  running: t('book.detail.workflows.status.running'),
  success: t('book.detail.workflows.status.success'),
  failed: t('book.detail.workflows.status.failed'),
}


const statusBadgeVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'secondary',
  running: 'outline',
  success: 'default',
  failed: 'destructive',
}

async function loadWorkflowDefinitions() {
  workflowsLoading.value = true
  workflowsError.value = null
  try {
    workflows.value = await listWorkflows()
  } catch (e) {
    workflowsError.value = e instanceof Error ? e.message : t('book.detail.workflows.loadError')
  } finally {
    workflowsLoading.value = false
  }
}

function statusFor(workflowId: number) {
  return statuses.value.find((s) => s.workflowId === workflowId) ?? null
}


async function handleRun(workflowId: number) {
  const next = new Set(runningIds.value)
  next.add(workflowId)
  runningIds.value = next
  if (runErrors.value[workflowId]) {
    const errors = { ...runErrors.value }
    delete errors[workflowId]
    runErrors.value = errors
  }
  try {
    await run(props.book.id, workflowId)
  } catch (e) {
    runErrors.value = { ...runErrors.value, [workflowId]: e instanceof Error ? e.message : t('book.detail.workflows.runError') }
  } finally {
    const after = new Set(runningIds.value)
    after.delete(workflowId)
    runningIds.value = after
  }
}


function loadForBook(bookId: number) {
  void refresh(bookId)
}

onMounted(() => {
  void loadWorkflowDefinitions()
  loadForBook(props.book.id)
})

watch(
  () => props.book.id,
  (id) => loadForBook(id),
)
</script>

<template>
  <div class="space-y-4">
    <div v-if="workflowsError" class="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {{ workflowsError }}
    </div>


    <div v-if="(workflowsLoading || loading) && workflows.length === 0" class="space-y-3">
      <div v-for="i in 3" :key="i" class="h-16 rounded-md bg-muted animate-shimmer" />
    </div>

    <div v-else-if="workflows.length === 0" class="flex flex-col items-center justify-center py-16 gap-3">
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <WorkflowIcon :size="20" class="text-muted-foreground" />
      </div>
      <p class="text-sm text-muted-foreground">{{ t('book.detail.workflows.empty') }}</p>
    </div>

    <div v-else class="space-y-3">
      <div v-for="wf in workflows" :key="wf.id" class="rounded-md border border-border px-4 py-3 space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="font-medium text-foreground truncate">{{ wf.name }}</span>
            <Badge :variant="statusFor(wf.id) ? statusBadgeVariant[statusFor(wf.id)!.status] : 'secondary'">
              {{ statusFor(wf.id) ? statusLabels[statusFor(wf.id)!.status] : t('book.detail.workflows.neverRun') }}
            </Badge>
            <Badge v-if="statusFor(wf.id)?.stale" variant="outline" class="gap-1">
              <AlertTriangle :size="12" />
              {{ t('book.detail.workflows.stale') }}
            </Badge>
          </div>
          <Button size="sm" class="gap-1.5" :disabled="statusFor(wf.id)?.status === 'running' || runningIds.has(wf.id)" @click="handleRun(wf.id)">
            <Loader2 v-if="runningIds.has(wf.id) || statusFor(wf.id)?.status === 'running'" :size="14" class="animate-spin" />
            <Play v-else :size="14" />
            {{
              statusFor(wf.id)?.status === 'running' || runningIds.has(wf.id) ? t('book.detail.workflows.running') : t('book.detail.workflows.run')
            }}
          </Button>
        </div>
        <p v-if="wf.description" class="text-xs text-muted-foreground">{{ wf.description }}</p>
        <p v-if="statusFor(wf.id)?.status === 'failed' && statusFor(wf.id)?.errorMessage" class="text-xs text-destructive">
          {{ statusFor(wf.id)?.errorMessage }}
        </p>
        <p v-if="runErrors[wf.id]" class="text-xs text-destructive">{{ runErrors[wf.id] }}</p>
      </div>
    </div>
  </div>
</template>
