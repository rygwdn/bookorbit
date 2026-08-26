<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Pencil, Plus, Trash2, Workflow } from '@lucide/vue'
import type { CreateWorkflowRequest, WorkflowDetail } from '@bookorbit/types'
import { useWorkflows } from '@/features/workflow/composables/useWorkflows'
import WorkflowFormDialog from '@/features/workflow/components/WorkflowFormDialog.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'

withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const { t } = useI18n()

const { workflows, loading, error, refresh, create, update, remove } = useWorkflows()

const formOpen = ref(false)
const editingWorkflow = ref<WorkflowDetail | null>(null)
const saving = ref(false)
const formError = ref<string | null>(null)

const deleteConfirmId = ref<number | null>(null)
const deleting = ref(false)

refresh()

function openCreateForm() {
  editingWorkflow.value = null
  formError.value = null
  formOpen.value = true
}

function openEditForm(workflow: WorkflowDetail) {
  editingWorkflow.value = workflow
  formError.value = null
  formOpen.value = true
}

function closeForm() {
  if (!saving.value) formOpen.value = false
}

async function handleSubmit(payload: CreateWorkflowRequest) {
  saving.value = true
  formError.value = null
  try {
    if (editingWorkflow.value) {
      await update(editingWorkflow.value.id, payload)
    } else {
      await create(payload)
    }
    formOpen.value = false
  } catch (e) {
    formError.value = e instanceof Error ? e.message : t('settings.admin.workflows.errors.save')
  } finally {
    saving.value = false
  }
}

function requestDelete(id: number) {
  deleteConfirmId.value = id
}

function cancelDelete() {
  if (!deleting.value) deleteConfirmId.value = null
}

async function handleDelete() {
  if (deleteConfirmId.value === null || deleting.value) return
  deleting.value = true
  try {
    await remove(deleteConfirmId.value)
    deleteConfirmId.value = null
  } catch {
    error.value = t('settings.admin.workflows.errors.delete')
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div>
    <SettingsPageHeader v-if="!embedded" :title="t('settings.admin.workflows.title')" :subtitle="t('settings.admin.workflows.subtitle')">
      <Button @click="openCreateForm"><Plus :size="14" />{{ t('settings.admin.workflows.newWorkflow') }}</Button>
    </SettingsPageHeader>
    <template v-else>
      <div class="mb-5 flex items-center justify-between gap-4">
        <p class="text-sm text-muted-foreground">{{ t('settings.admin.workflows.subtitle') }}</p>
        <Button size="sm" class="shrink-0" @click="openCreateForm"><Plus :size="14" />{{ t('settings.admin.workflows.newWorkflow') }}</Button>
      </div>
    </template>

    <p v-if="error" role="alert" class="mb-4 text-sm text-destructive">{{ error }}</p>
    <p v-if="loading" role="status" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>

    <div v-else-if="workflows.length === 0" class="rounded-lg border border-dashed border-border px-5 py-8 text-center">
      <p class="text-sm font-medium text-foreground">{{ t('settings.admin.workflows.noWorkflowsYet') }}</p>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.admin.workflows.noWorkflowsHint') }}</p>
    </div>

    <div v-else class="space-y-3">
      <p class="settings-group-label">{{ t('settings.admin.workflows.listLabel') }}</p>
      <div v-for="workflow in workflows" :key="workflow.id" class="rounded-lg border border-border bg-card px-4 py-3.5 shadow-xs">
        <div class="flex items-start justify-between gap-4">
          <div class="flex min-w-0 items-start gap-3">
            <div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Workflow :size="16" class="text-primary" aria-hidden="true" />
            </div>
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-foreground">{{ workflow.name }}</p>
              <p v-if="workflow.description" class="mt-0.5 text-sm text-muted-foreground">{{ workflow.description }}</p>
              <p class="mt-1.5 text-xs text-muted-foreground">
                {{
                  t('settings.admin.workflows.summary', {
                    steps: workflow.steps.length,
                    input: workflow.inputFormats.length > 0 ? workflow.inputFormats.join(', ') : t('settings.admin.workflows.anyFormat'),
                    output: workflow.outputFormat,
                  })
                }}
              </p>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              :aria-label="t('settings.admin.workflows.edit')"
              @click="openEditForm(workflow)"
            >
              <Pencil :size="14" />
            </button>
            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              :aria-label="t('settings.admin.workflows.delete')"
              @click="requestDelete(workflow.id)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
      </div>
    </div>
    <WorkflowFormDialog :open="formOpen" :workflow="editingWorkflow" :saving="saving" :error="formError" @submit="handleSubmit" @cancel="closeForm" />

    <ConfirmDialog
      :open="deleteConfirmId !== null"
      :title="t('settings.admin.workflows.deleteDialog.title')"
      :description="t('settings.admin.workflows.deleteDialog.description')"
      :confirm-label="deleting ? t('settings.admin.workflows.deleteDialog.deleting') : t('settings.admin.workflows.deleteDialog.confirm')"
      :busy="deleting"
      @confirm="handleDelete"
      @cancel="cancelDelete"
    />
  </div>
</template>
