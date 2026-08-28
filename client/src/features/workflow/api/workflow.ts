import type {
  BookSelectionPayload,
  BookWorkflowStatus,
  CreateWorkflowDeliveryPreferenceRequest,
  CreateWorkflowRequest,
  UpdateWorkflowRequest,
  WorkflowBulkRunFailure,
  WorkflowBulkRunResult,
  WorkflowDeliveryPreference,
  WorkflowDetail,
  WorkflowRunStatusCounts,
} from '@bookorbit/types'
import { api } from '@/lib/api'

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const err = await res.json().catch(() => ({}))
  return err.message ?? fallback
}

export async function listWorkflows(): Promise<WorkflowDetail[]> {
  const res = await api('/api/v1/workflows')
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to load workflows'))
  return res.json()
}

export async function getWorkflow(id: number): Promise<WorkflowDetail> {
  const res = await api(`/api/v1/workflows/${id}`)
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to load workflow'))
  return res.json()
}

export async function createWorkflow(body: CreateWorkflowRequest): Promise<WorkflowDetail> {
  const res = await api('/api/v1/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to create workflow'))
  return res.json()
}

export async function updateWorkflow(id: number, body: UpdateWorkflowRequest): Promise<WorkflowDetail> {
  const res = await api(`/api/v1/workflows/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to update workflow'))
  return res.json()
}

export async function deleteWorkflow(id: number): Promise<void> {
  const res = await api(`/api/v1/workflows/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to delete workflow'))
}

export async function getBookWorkflowStatuses(bookId: number): Promise<BookWorkflowStatus[]> {
  const res = await api(`/api/v1/books/${bookId}/workflows`)
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to load workflow statuses'))
  return res.json()
}

export async function runBookWorkflow(bookId: number, workflowId: number): Promise<void> {
  const res = await api(`/api/v1/books/${bookId}/workflows/${workflowId}/run`, { method: 'POST' })
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to run workflow'))
}

export async function runBookWorkflowsBulk(workflowId: number, selection: BookSelectionPayload): Promise<WorkflowBulkRunResult> {
  const res = await api(`/api/v1/books/workflows/${workflowId}/run-bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(selection),
  })
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to run workflow'))
  return res.json()
}

export async function getWorkflowRunBatchStatusCounts(runBatchId: string): Promise<WorkflowRunStatusCounts> {
  const res = await api(`/api/v1/books/workflow-runs/${runBatchId}/status-counts`)
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to load workflow run status counts'))
  return res.json()
}

export async function getWorkflowRunBatchFailures(runBatchId: string, limit = 20): Promise<WorkflowBulkRunFailure[]> {
  const res = await api(`/api/v1/books/workflow-runs/${runBatchId}/failures?limit=${limit}`)
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to load workflow run failures'))
  return res.json()
}

export async function listWorkflowDeliveryPreferences(): Promise<WorkflowDeliveryPreference[]> {
  const res = await api('/api/v1/workflows/preferences')
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to load workflow delivery preferences'))
  return res.json()
}

export async function createWorkflowDeliveryPreference(body: CreateWorkflowDeliveryPreferenceRequest): Promise<void> {
  const res = await api('/api/v1/workflows/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to create workflow delivery preference'))
}

export async function deleteWorkflowDeliveryPreference(id: number): Promise<void> {
  const res = await api(`/api/v1/workflows/preferences/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to delete workflow delivery preference'))
}
