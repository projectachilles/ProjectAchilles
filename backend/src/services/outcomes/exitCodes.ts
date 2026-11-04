// Canonical error code → name mapping
// Categories: protected, failed, inconclusive, contextual, error
export const ERROR_CODE_MAP: Record<number, { name: string; description: string; category: string }> = {
  0:   { name: 'NormalExit',                description: 'Normal exit - varies by context',              category: 'inconclusive' },
  1:   { name: 'BinaryNotRecognized',       description: 'Binary not recognized or permission denied',   category: 'contextual' },
  101: { name: 'Unprotected',               description: 'Attack succeeded - endpoint unprotected',      category: 'failed' },
  105: { name: 'FileQuarantinedOnExtraction', description: 'File quarantined during extraction',          category: 'protected' },
  126: { name: 'ExecutionPrevented',         description: 'Execution blocked/prevented by AV/EDR',       category: 'protected' },
  127: { name: 'QuarantinedOnExecution',     description: 'Quarantined on execution attempt',            category: 'protected' },
  200: { name: 'NoOutput',                   description: 'No output - quick AV block before execution', category: 'inconclusive' },
  259: { name: 'StillActive',               description: 'Windows STILL_ACTIVE - process timeout',      category: 'inconclusive' },
  260: { name: 'BlockedPreExecution',      description: 'Blocked before execution (access denied) by an EDR/AV or an app-control rule such as Defender ASR - technique not evaluated; Protected (126) once the EDR\'s own alert confirms it', category: 'inconclusive' },
  999: { name: 'UnexpectedTestError',        description: 'Test error - prerequisites not met',          category: 'error' },
};

/** Resolve an error code to its canonical name, with optional fallback to f0rtika.error_name */
export function resolveErrorName(errorCode: number | undefined, storedName?: string): string {
  if (errorCode !== undefined && ERROR_CODE_MAP[errorCode]) {
    return ERROR_CODE_MAP[errorCode].name;
  }
  if (storedName) return storedName;
  return `Unknown (${errorCode ?? '?'})`;
}
