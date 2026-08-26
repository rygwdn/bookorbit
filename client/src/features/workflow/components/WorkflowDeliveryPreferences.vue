<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Trash2 } from '@lucide/vue'
import {
  Permission,
  type KoreaderDeviceInfo,
  type OpdsUser,
  type WorkflowDeliveryPreference,
  type WorkflowDeliveryTarget,
  type WorkflowDetail,
} from '@bookorbit/types'
import { api } from '@/lib/api'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { createWorkflowDeliveryPreference, deleteWorkflowDeliveryPreference, listWorkflowDeliveryPreferences } from '../api/workflow'

const props = defineProps<{ workflows: WorkflowDetail[] }>()
const { t } = useI18n()
const { hasPermission } = usePermissions()
const canUseOpds = hasPermission(Permission.OpdsAccess)
const canUseKoreader = hasPermission(Permission.KoreaderSync)

const preferences = ref<WorkflowDeliveryPreference[]>([])
const opdsUsers = ref<OpdsUser[]>([])
const devices = ref<KoreaderDeviceInfo[]>([])
const targetType = ref<'opds' | 'koreader'>(canUseOpds ? 'opds' : 'koreader')
const targetId = ref('')
const workflowId = ref<number | null>(null)
const priority = ref(0)
const loading = ref(true)
const saving = ref(false)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    const [preferenceList, opdsResponse, koreaderResponse] = await Promise.all([
      listWorkflowDeliveryPreferences(),
      canUseOpds ? api('/api/v1/opds-users') : Promise.resolve(null),
      canUseKoreader ? api('/api/v1/koreader/sync-status') : Promise.resolve(null),
    ])
    preferences.value = preferenceList
    opdsUsers.value = opdsResponse?.ok ? await opdsResponse.json() : []
    const syncStatus = koreaderResponse?.ok ? await koreaderResponse.json() : null
    devices.value = syncStatus?.devices ?? []
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : t('settings.admin.workflows.delivery.loadError')
  } finally {
    loading.value = false
  }
}

function targetLabel(preference: WorkflowDeliveryPreference): string {
  const target = preference.target
  if (target.type === 'opds') {
    return opdsUsers.value.find((user) => user.id === target.opdsUserId)?.username ?? `OPDS #${target.opdsUserId}`
  }
  return devices.value.find((device) => device.deviceId === target.deviceId)?.device ?? target.deviceId
}

function selectedTarget(): WorkflowDeliveryTarget | null {
  if (!targetId.value) return null
  return targetType.value === 'opds' ? { type: 'opds', opdsUserId: Number(targetId.value) } : { type: 'koreader', deviceId: targetId.value }
}

async function addPreference() {
  const target = selectedTarget()
  if (!target || workflowId.value === null || saving.value) return
  saving.value = true
  error.value = null
  try {
    await createWorkflowDeliveryPreference({ workflowId: workflowId.value, target, priority: priority.value })
    targetId.value = ''
    workflowId.value = null
    priority.value = 0
    await load()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : t('settings.admin.workflows.delivery.createError')
  } finally {
    saving.value = false
  }
}

async function removePreference(id: number) {
  if (saving.value) return
  saving.value = true
  try {
    await deleteWorkflowDeliveryPreference(id)
    preferences.value = preferences.value.filter((preference) => preference.id !== id)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : t('settings.admin.workflows.delivery.deleteError')
  } finally {
    saving.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <section class="mt-8 space-y-3">
    <div>
      <h2 class="text-sm font-semibold text-foreground">{{ t('settings.admin.workflows.delivery.title') }}</h2>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.admin.workflows.delivery.subtitle') }}</p>
    </div>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
    <p v-if="loading" role="status" class="text-sm text-muted-foreground">{{ t('settings.admin.workflows.delivery.loading') }}</p>
    <div v-else class="space-y-3">
      <div
        v-for="preference in preferences"
        :key="preference.id"
        class="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
      >
        <div class="min-w-0 text-sm">
          <p class="truncate font-medium text-foreground">{{ preference.workflowName }}</p>
          <p class="text-xs text-muted-foreground">
            {{ preference.target.type === 'opds' ? t('settings.admin.workflows.delivery.opds') : t('settings.admin.workflows.delivery.koreader') }}:
            {{ targetLabel(preference) }} · {{ t('settings.admin.workflows.delivery.priority', { priority: preference.priority }) }}
          </p>
        </div>
        <button
          type="button"
          class="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          :aria-label="t('settings.admin.workflows.delivery.remove')"
          @click="removePreference(preference.id)"
        >
          <Trash2 :size="14" />
        </button>
      </div>
      <div
        v-if="canUseOpds || canUseKoreader"
        class="grid gap-2 rounded-lg border border-dashed border-border p-3 md:grid-cols-[auto_1fr_1fr_auto_auto]"
      >
        <select v-model="targetType" class="input-field">
          <option v-if="canUseOpds" value="opds">{{ t('settings.admin.workflows.delivery.opds') }}</option>
          <option v-if="canUseKoreader" value="koreader">{{ t('settings.admin.workflows.delivery.koreader') }}</option>
        </select>
        <select v-if="targetType === 'opds'" v-model="targetId" class="input-field">
          <option value="">{{ t('settings.admin.workflows.delivery.selectAccount') }}</option>
          <option v-for="user in opdsUsers" :key="user.id" :value="String(user.id)">{{ user.username }}</option>
        </select>
        <select v-else v-model="targetId" class="input-field">
          <option value="">{{ t('settings.admin.workflows.delivery.selectDevice') }}</option>
          <option v-for="device in devices" :key="device.deviceId" :value="device.deviceId">{{ device.device }}</option>
        </select>
        <select v-model="workflowId" class="input-field">
          <option :value="null">{{ t('settings.admin.workflows.delivery.selectWorkflow') }}</option>
          <option v-for="workflow in props.workflows" :key="workflow.id" :value="workflow.id">{{ workflow.name }}</option>
        </select>
        <input
          v-model.number="priority"
          type="number"
          min="0"
          class="input-field w-24"
          :aria-label="t('settings.admin.workflows.delivery.priorityInput')"
        />
        <button
          type="button"
          class="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          :disabled="saving || !targetId || workflowId === null"
          @click="addPreference"
        >
          {{ t('settings.admin.workflows.delivery.add') }}
        </button>
      </div>
      <p v-else class="text-sm text-muted-foreground">{{ t('settings.admin.workflows.delivery.noTargets') }}</p>
    </div>
  </section>
</template>
