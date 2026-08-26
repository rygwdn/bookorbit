<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Permission, type WorkflowDeliveryTarget, type WorkflowDetail } from '@bookorbit/types'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useWorkflowDeliveryPreferences } from '../composables/useWorkflowDeliveryPreferences'

const props = defineProps<{ target: WorkflowDeliveryTarget; workflows: WorkflowDetail[] }>()

const { t } = useI18n()
const { hasPermission } = usePermissions()
const { preferences, create, remove } = useWorkflowDeliveryPreferences()

const saving = ref(false)
const error = ref<string | null>(null)

function targetsMatch(a: WorkflowDeliveryTarget, b: WorkflowDeliveryTarget): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'opds' && b.type === 'opds') return a.opdsUserId === b.opdsUserId
  if (a.type === 'koreader' && b.type === 'koreader') return a.deviceId === b.deviceId
  return false
}

const matchingPreference = computed(
  () => preferences.value.filter((preference) => targetsMatch(preference.target, props.target)).sort((a, b) => a.priority - b.priority)[0] ?? null,
)

const selectedWorkflowId = ref<number | null>(matchingPreference.value?.workflowId ?? null)

watch(matchingPreference, (preference) => {
  selectedWorkflowId.value = preference?.workflowId ?? null
})

async function handleChange(event: Event): Promise<void> {
  if (saving.value) return
  const raw = (event.target as HTMLSelectElement).value
  const nextWorkflowId = raw === '' ? null : Number(raw)
  const previousWorkflowId = selectedWorkflowId.value
  const existing = matchingPreference.value
  saving.value = true
  error.value = null
  try {
    if (existing) await remove(existing.id)
    if (nextWorkflowId !== null) await create({ workflowId: nextWorkflowId, target: props.target })
    selectedWorkflowId.value = nextWorkflowId
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : t('settings.admin.workflows.delivery.createError')
    selectedWorkflowId.value = previousWorkflowId
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="hasPermission(Permission.RunWorkflows)" class="mt-2 space-y-1">
    <div class="flex items-center gap-2 text-xs">
      <span class="font-medium text-foreground">{{ t('settings.admin.workflows.delivery.inlineTitle') }}</span>
      <select
        :value="selectedWorkflowId ?? ''"
        class="input-field h-7 py-0 text-xs"
        :disabled="saving"
        :aria-label="t('settings.admin.workflows.delivery.inlineTitle')"
        @change="handleChange"
      >
        <option value="">{{ t('settings.admin.workflows.delivery.inlineNone') }}</option>
        <option v-for="workflow in props.workflows" :key="workflow.id" :value="workflow.id">{{ workflow.name }}</option>
      </select>
    </div>
    <p class="text-xs text-muted-foreground">
      {{ selectedWorkflowId === null ? t('settings.admin.workflows.delivery.inlineEmpty') : t('settings.admin.workflows.delivery.inlineHint') }}
    </p>
    <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>
  </div>
</template>
