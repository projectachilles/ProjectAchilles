/**
 * Structured JSON output for --json mode.
 * All JSON output follows a consistent envelope for LLM/agentic consumption.
 */

export interface JsonOutput<T = unknown> {
  data: T;
  meta?: {
    total?: number;
    limit?: number;
    offset?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
  };
  command: string;
  timestamp: string;
}

export interface JsonHelpOutput {
  name: string;
  description: string;
  subcommands?: Array<{
    name: string;
    description: string;
    args?: Array<{ name: string; required: boolean; description?: string }>;
    flags?: Array<{
      name: string;
      type: string;
      required?: boolean;
      default?: unknown;
      choices?: string[];
      description?: string;
    }>;
  }>;
}

export function jsonOutput<T>(data: T, command: string, meta?: JsonOutput['meta']): string {
  const output: JsonOutput<T> = {
    data,
    command,
    timestamp: new Date().toISOString(),
  };
  if (meta) output.meta = meta;
  return JSON.stringify(output, null, 2);
}

export function jsonError(error: string, command: string): string {
  return JSON.stringify({
    error,
    command,
    timestamp: new Date().toISOString(),
  }, null, 2);
}

export function jsonHelp(help: JsonHelpOutput): string {
  return JSON.stringify(help, null, 2);
}
