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
  outputFilenameTemplate: string | null;
  createdAt: string;
  updatedAt: string;
};
export type WorkflowDetail = WorkflowSummary & { steps: WorkflowStep[] };

export const DEFAULT_WORKFLOW_OUTPUT_FILENAME_PATTERN = "{title} - {workflow}";

export const WORKFLOW_OUTPUT_FILENAME_TOKENS = [
  { token: "title", description: "Book title" },
  { token: "authors", description: "Author(s), comma-separated" },
  { token: "series", description: "Series name" },
  { token: "seriesIndex", description: "Series index (zero-padded)" },
  { token: "workflow", description: "Workflow name" },
  { token: "originalFilename", description: "Original source filename (without extension)" },
  { token: "extension", description: "Output file extension (without dot)" },
] as const;

export const WORKFLOW_OUTPUT_EXAMPLE_METADATA: Record<string, string> = {
  title: "Neuromancer",
  authors: "William Gibson",
  series: "Sprawl",
  seriesIndex: "01",
  workflow: "Optimize for Kobo",
  originalFilename: "neuromancer",
  extension: "epub",
};

export type CreateWorkflowRequest = {
  name: string;
  description: string | null;
  outputFormat: string;
  inputFormats: string[];
  outputFilenameTemplate: string | null;
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

export type WorkflowRunStatusCounts = Record<BookWorkflowRunStatus, number>;

export type WorkflowBulkRunResult = {
  runBatchId: string;
  queued: number[];
  skipped: { bookId: number; reason: string }[];
};

export type WorkflowBulkRunFailure = {
  bookId: number;
  bookTitle: string;
  errorMessage: string | null;
  finishedAt: string | null; // ISO string
};

export type WorkflowDeliveryTarget =
  | { type: 'opds'; opdsUserId: number }
  | { type: 'koreader'; deviceId: string };

export type WorkflowDeliveryPreference = {
  id: number;
  workflowId: number;
  workflowName: string;
  outputFormat: string;
  inputFormats: string[];
  priority: number;
  target: WorkflowDeliveryTarget;
  createdAt: string;
  updatedAt: string;
};

export type CreateWorkflowDeliveryPreferenceRequest = {
  workflowId: number;
  target: WorkflowDeliveryTarget;
  priority?: number;
};
