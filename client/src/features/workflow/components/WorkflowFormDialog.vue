<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Loader2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { CreateWorkflowRequest, WorkflowDetail, WorkflowStepInput } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import WorkflowStepEditor from './WorkflowStepEditor.vue'

const DEFAULT_TIMEOUT_SECONDS = 300

const props = defineProps<{
  open: boolean
  workflow: WorkflowDetail | null
  saving: boolean
  error: string | null
}>()

const emit = defineEmits<{
  submit: [payload: CreateWorkflowRequest]
  cancel: []
}>()

const { t } = useI18n()

const name = ref('')
const description = ref('')
const outputFormat = ref('')
const inputFormatsText = ref('')
const steps = ref<WorkflowStepInput[]>([])

const isEdit = computed(() => props.workflow !== null)

const inputFormats = computed(() =>
  inputFormatsText.value
    .split(',')
    .map((f) => f.trim().toLowerCase())
    .filter((f) => f.length > 0),
)

const canSubmit = computed(
  () =>
    !props.saving &&
    name.value.trim().length > 0 &&
    /^[a-z0-9]{1,20}$/.test(outputFormat.value.trim()) &&
    steps.value.length > 0 &&
    steps.value.every((step) => step.command.trim().length > 0),
)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const workflow = props.workflow
    name.value = workflow?.name ?? ''
    description.value = workflow?.description ?? ''
    outputFormat.value = workflow?.outputFormat ?? ''
    inputFormatsText.value = workflow?.inputFormats.join(', ') ?? ''
    steps.value = workflow
      ? workflow.steps.map((step) => ({
          command: step.command,
          args: [...step.args],
          outputExtension: step.outputExtension,
          inPlace: step.inPlace,
          timeoutSeconds: step.timeoutSeconds,
        }))
      : [{ command: '', args: [], outputExtension: null, inPlace: false, timeoutSeconds: DEFAULT_TIMEOUT_SECONDS }]
  },
  { immediate: true },
)

function handleOpenChange(open: boolean): void {
  if (!open && !props.saving) emit('cancel')
}

function handleCancel(): void {
  if (!props.saving) emit('cancel')
}

function handleSubmit(): void {
  if (!canSubmit.value) return
  emit('submit', {
    name: name.value.trim(),
    description: description.value.trim() === '' ? null : description.value.trim(),
    outputFormat: outputFormat.value.trim().toLowerCase(),
    inputFormats: inputFormats.value,
    steps: steps.value,
  })
}
</script>

<template>
  <DialogRoot :open="props.open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-foreground/50" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-50 max-h-[calc(100%-4rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <DialogTitle class="text-lg font-semibold text-foreground">
          {{ isEdit ? t('settings.admin.workflows.formDialog.editTitle') : t('settings.admin.workflows.formDialog.createTitle') }}
        </DialogTitle>
        <DialogDescription class="mt-1 text-sm text-muted-foreground">
          {{ t('settings.admin.workflows.formDialog.description') }}
        </DialogDescription>

        <form class="mt-4 space-y-4" @submit.prevent="handleSubmit">
          <div>
            <label for="workflow-name" class="mb-1 block text-sm font-medium text-foreground">
              {{ t('settings.admin.workflows.formDialog.name') }}
            </label>
            <input id="workflow-name" v-model="name" type="text" maxlength="200" class="input-field w-full" />
          </div>

          <div>
            <label for="workflow-description" class="mb-1 block text-sm font-medium text-foreground">
              {{ t('settings.admin.workflows.formDialog.description') }}
              <span class="font-normal text-muted-foreground">{{ t('settings.admin.workflows.formDialog.optional') }}</span>
            </label>
            <textarea id="workflow-description" v-model="description" maxlength="2000" rows="2" class="input-field w-full h-auto py-2" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="workflow-output-format" class="mb-1 block text-sm font-medium text-foreground">
                {{ t('settings.admin.workflows.formDialog.outputFormat') }}
              </label>
              <input
                id="workflow-output-format"
                v-model="outputFormat"
                type="text"
                maxlength="20"
                :placeholder="t('settings.admin.workflows.formDialog.outputFormatPlaceholder')"
                class="input-field w-full"
              />
            </div>
            <div>
              <label for="workflow-input-formats" class="mb-1 block text-sm font-medium text-foreground">
                {{ t('settings.admin.workflows.formDialog.inputFormats') }}
                <span class="font-normal text-muted-foreground">{{ t('settings.admin.workflows.formDialog.optional') }}</span>
              </label>
              <input
                id="workflow-input-formats"
                v-model="inputFormatsText"
                type="text"
                :placeholder="t('settings.admin.workflows.formDialog.inputFormatsPlaceholder')"
                class="input-field w-full"
              />
            </div>
          </div>

          <div>
            <span class="mb-1.5 block text-sm font-medium text-foreground">{{ t('settings.admin.workflows.formDialog.steps') }}</span>
            <WorkflowStepEditor v-model="steps" />
          </div>

          <p v-if="props.error" role="alert" class="text-sm text-destructive">{{ props.error }}</p>

          <div class="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="outline" :disabled="props.saving" @click="handleCancel">{{ t('common.cancel') }}</Button>
            <Button type="submit" :disabled="!canSubmit">
              <Loader2 v-if="props.saving" class="animate-spin" aria-hidden="true" />
              {{
                props.saving
                  ? t('settings.admin.workflows.formDialog.saving')
                  : isEdit
                    ? t('settings.admin.workflows.formDialog.save')
                    : t('settings.admin.workflows.formDialog.create')
              }}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
