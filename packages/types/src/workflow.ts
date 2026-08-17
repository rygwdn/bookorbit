export const WORKFLOW_TEMPLATE_KEYS = ["input", "output", "workDir", "title", "authors", "series", "format", "bookId"] as const;
export type WorkflowTemplateKey = (typeof WORKFLOW_TEMPLATE_KEYS)[number];

export type WorkflowStepInput = {
  command: string;
  args: string[];
  outputExtension: string | null;
  inPlace: boolean;
  timeoutSeconds: number;
};
export type WorkflowStep = WorkflowStepInput & { id: number; stepOrder: number };

export type WorkflowSummary = {
  id: number;
  name: string;
  description: string | null;
  outputFormat: string;
  inputFormats: string[];
  createdAt: string;
  updatedAt: string;
};
export type WorkflowDetail = WorkflowSummary & { steps: WorkflowStep[] };

export type CreateWorkflowRequest = {
  name: string;
  description: string | null;
  outputFormat: string;
  inputFormats: string[];
  steps: WorkflowStepInput[];
};
export type UpdateWorkflowRequest = CreateWorkflowRequest;

export const BOOK_WORKFLOW_STATUSES = ["pending", "running", "success", "failed"] as const;
export type BookWorkflowRunStatus = (typeof BOOK_WORKFLOW_STATUSES)[number];

export type BookWorkflowStatus = {
  workflowId: number;
  workflowName: string;
  status: BookWorkflowRunStatus;
  bookFileId: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  stale: boolean;
};

export type BookWorkflowPreference = { workflowId: number | null };
