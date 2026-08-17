import type { BookWorkflowPreference, BookWorkflowStatus, CreateWorkflowRequest, UpdateWorkflowRequest, WorkflowDetail } from '@bookorbit/types'
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

export async function runBookWorkflowsBulk(
  workflowId: number,
  bookIds: number[],
): Promise<{ queued: number[]; skipped: { bookId: number; reason: string }[] }> {
  const res = await api(`/api/v1/books/workflows/${workflowId}/run-bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookIds }),
  })
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to run workflow'))
  return res.json()
}

export async function getBookWorkflowPreference(bookId: number): Promise<BookWorkflowPreference> {
  const res = await api(`/api/v1/books/${bookId}/workflows/preference`)
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to load preferred workflow'))
  return res.json()
}

export async function setBookWorkflowPreference(bookId: number, workflowId: number | null): Promise<void> {
  const res = await api(`/api/v1/books/${bookId}/workflows/preference`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId }),
  })
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to set preferred workflow'))
}
