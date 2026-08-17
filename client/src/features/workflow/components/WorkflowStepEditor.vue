<script setup lang="ts">
import { ChevronDown, ChevronUp, Plus, Trash2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { WorkflowStepInput } from '@bookorbit/types'

const DEFAULT_TIMEOUT_SECONDS = 300

const steps = defineModel<WorkflowStepInput[]>({ required: true })

const { t } = useI18n()

function emptyStep(): WorkflowStepInput {
  return { command: '', args: [], outputExtension: null, inPlace: false, timeoutSeconds: DEFAULT_TIMEOUT_SECONDS }
}

function updateStep(index: number, patch: Partial<WorkflowStepInput>) {
  steps.value = steps.value.map((step, i) => (i === index ? { ...step, ...patch } : step))
}

function addStep() {
  steps.value = [...steps.value, emptyStep()]
}

function removeStep(index: number) {
  steps.value = steps.value.filter((_, i) => i !== index)
}

function moveStep(index: number, dir: -1 | 1) {
  const next = [...steps.value]
  const target = index + dir
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  steps.value = next
}

function setCommand(index: number, value: string) {
  updateStep(index, { command: value })
}

function setInPlace(index: number, value: boolean) {
  updateStep(index, value ? { inPlace: true, outputExtension: null } : { inPlace: false })
}

function setOutputExtension(index: number, value: string) {
  updateStep(index, { outputExtension: value.trim() === '' ? null : value.trim() })
}

function setTimeoutSeconds(index: number, value: string) {
  const parsed = parseInt(value, 10)
  updateStep(index, { timeoutSeconds: Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_SECONDS })
}

function addArg(index: number) {
  updateStep(index, { args: [...steps.value[index]!.args, ''] })
}

function removeArg(index: number, argIndex: number) {
  updateStep(index, { args: steps.value[index]!.args.filter((_, i) => i !== argIndex) })
}

function setArg(index: number, argIndex: number, value: string) {
  updateStep(index, { args: steps.value[index]!.args.map((arg, i) => (i === argIndex ? value : arg)) })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-for="(step, index) in steps" :key="index" class="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div class="flex items-start gap-2">
        <div class="flex flex-col shrink-0 pt-1">
          <button
            type="button"
            :disabled="index === 0"
            class="flex h-5 w-5 items-center justify-center rounded text-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-25"
            :aria-label="t('settings.admin.workflows.stepEditor.moveUp')"
            @click="moveStep(index, -1)"
          >
            <ChevronUp :size="14" stroke-width="2.5" />
          </button>
          <button
            type="button"
            :disabled="index === steps.length - 1"
            class="flex h-5 w-5 items-center justify-center rounded text-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-25"
            :aria-label="t('settings.admin.workflows.stepEditor.moveDown')"
            @click="moveStep(index, 1)"
          >
            <ChevronDown :size="14" stroke-width="2.5" />
          </button>
        </div>

        <div class="min-w-0 flex-1 space-y-2.5">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {{ t('settings.admin.workflows.stepEditor.stepLabel', { number: index + 1 }) }}
            </span>
            <button
              type="button"
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              :aria-label="t('settings.admin.workflows.stepEditor.removeStep')"
              @click="removeStep(index)"
            >
              <Trash2 :size="13" />
            </button>
          </div>

          <div>
            <label :for="`workflow-step-${index}-command`" class="mb-1 block text-xs font-medium text-foreground">
              {{ t('settings.admin.workflows.stepEditor.command') }}
            </label>
            <input
              :id="`workflow-step-${index}-command`"
              :value="step.command"
              type="text"
              class="input-field w-full"
              :placeholder="t('settings.admin.workflows.stepEditor.commandPlaceholder')"
              @input="setCommand(index, ($event.target as HTMLInputElement).value)"
            />
          </div>

          <div>
            <span class="mb-1 block text-xs font-medium text-foreground">{{ t('settings.admin.workflows.stepEditor.args') }}</span>
            <div class="flex flex-col gap-1.5">
              <div v-for="(arg, argIndex) in step.args" :key="argIndex" class="flex items-center gap-1.5">
                <input
                  :value="arg"
                  type="text"
                  class="input-field w-full"
                  :placeholder="t('settings.admin.workflows.stepEditor.argPlaceholder', { number: argIndex + 1 })"
                  @input="setArg(index, argIndex, ($event.target as HTMLInputElement).value)"
                />
                <button
                  type="button"
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  :aria-label="t('settings.admin.workflows.stepEditor.removeArg')"
                  @click="removeArg(index, argIndex)"
                >
                  <Trash2 :size="13" />
                </button>
              </div>
            </div>
            <button
              type="button"
              class="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              @click="addArg(index)"
            >
              <Plus :size="12" />
              {{ t('settings.admin.workflows.stepEditor.addArg') }}
            </button>
            <p class="mt-1 text-xs text-muted-foreground">{{ t('settings.admin.workflows.stepEditor.argsHint') }}</p>
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            <div>
              <label :for="`workflow-step-${index}-output-extension`" class="mb-1 block text-xs font-medium text-foreground">
                {{ t('settings.admin.workflows.stepEditor.outputExtension') }}
              </label>
              <input
                :id="`workflow-step-${index}-output-extension`"
                :value="step.outputExtension ?? ''"
                type="text"
                :disabled="step.inPlace"
                class="input-field w-full"
                :placeholder="t('settings.admin.workflows.stepEditor.outputExtensionPlaceholder')"
                @input="setOutputExtension(index, ($event.target as HTMLInputElement).value)"
              />
            </div>
            <div>
              <label :for="`workflow-step-${index}-timeout`" class="mb-1 block text-xs font-medium text-foreground">
                {{ t('settings.admin.workflows.stepEditor.timeoutSeconds') }}
              </label>
              <input
                :id="`workflow-step-${index}-timeout`"
                :value="step.timeoutSeconds"
                type="number"
                min="1"
                max="3600"
                class="input-field w-full"
                @input="setTimeoutSeconds(index, ($event.target as HTMLInputElement).value)"
              />
            </div>
          </div>

          <label class="flex items-center gap-2 text-xs text-foreground">
            <input type="checkbox" :checked="step.inPlace" @change="setInPlace(index, ($event.target as HTMLInputElement).checked)" />
            {{ t('settings.admin.workflows.stepEditor.inPlace') }}
          </label>
        </div>
      </div>
    </div>

    <p v-if="steps.length === 0" class="text-sm text-muted-foreground">{{ t('settings.admin.workflows.stepEditor.emptyState') }}</p>

    <button
      type="button"
      class="flex items-center gap-1.5 self-start rounded-lg border border-dashed border-input px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-foreground hover:bg-muted/30 hover:text-foreground"
      @click="addStep"
    >
      <Plus :size="13" />
      {{ t('settings.admin.workflows.stepEditor.addStep') }}
    </button>
  </div>
</template>
