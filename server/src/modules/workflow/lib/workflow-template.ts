import { WORKFLOW_TEMPLATE_KEYS, type WorkflowTemplateKey } from '@bookorbit/types';

export { WORKFLOW_TEMPLATE_KEYS, type WorkflowTemplateKey };

const TEMPLATE_REGEX = /\{\{(\w+)\}\}/g;

/**
 * Extracts all unique placeholder keys found within an array of command arguments.
 * Placeholders are enclosed in double braces, e.g. `{{input}}`, `{{output}}`.
 */
export function extractTemplateKeys(args: string[]): string[] {
  const keys = new Set<string>();
  for (const arg of args) {
    let match: RegExpExecArray | null;
    const regex = new RegExp(TEMPLATE_REGEX);
    while ((match = regex.exec(arg)) !== null) {
      keys.add(match[1]);
    }
  }
  return [...keys];
}

/**
 * Substitutes known template placeholders in an array of command arguments with their
 * corresponding string values from the supplied context. Placeholders not present in
 * the context are left untouched.
 */
export function substituteTemplate(args: string[], context: Partial<Record<WorkflowTemplateKey, string>>): string[] {
  return args.map((arg) =>
    arg.replace(TEMPLATE_REGEX, (fullMatch, key: string) => {
      if (key in context) {
        return context[key as WorkflowTemplateKey] ?? '';
      }
      return fullMatch;
    }),
  );
}
