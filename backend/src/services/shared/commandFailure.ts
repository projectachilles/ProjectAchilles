// Turns a failed child-process run (promisified execFile) into a message an
// operator can act on. Shown verbatim in the UI for test and agent builds.
//
// Prefer stderr; when a script wrote its error to stdout (common in bash:
// an error printed inside $(...) before `set -e` exits), show the end of
// stdout instead of nothing. Never echo Node's own err.message for an exit:
// it is "Command failed: <cmd>\n<stderr>", which only repeats the command.

const MAX_LINES = 40;
const MAX_CHARS = 4_000;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

function outputText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return '';
}

/** Last MAX_LINES lines (and at most MAX_CHARS) of a stream, colour codes removed. */
function tail(value: unknown): string {
  const lines = outputText(value).replace(ANSI, '').trimEnd().split('\n');
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  if (lines.length === 0) return '';

  const omitted = Math.max(0, lines.length - MAX_LINES);
  let text = lines.slice(omitted).join('\n');
  if (text.length > MAX_CHARS) text = '…' + text.slice(-MAX_CHARS);
  return omitted > 0 ? `… (${omitted} earlier lines omitted)\n${text}` : text;
}

/** Why the process ended: exit code, signal, or a spawn error's system message. */
function status(err: { code?: unknown; signal?: unknown; killed?: unknown; message?: unknown }): string {
  if (typeof err.code === 'number') return `exit code ${err.code}`;
  if (typeof err.signal === 'string') {
    return err.killed ? `killed by ${err.signal}, timed out?` : `killed by ${err.signal}`;
  }
  // String codes (ENOENT, EACCES, ...) mean the process never started.
  if (typeof err.code === 'string' && typeof err.message === 'string') return err.message;
  return '';
}

export function describeCommandFailure(cmd: string, args: string[], err: unknown): string {
  const e = (err !== null && typeof err === 'object' ? err : {}) as {
    stdout?: unknown; stderr?: unknown; code?: unknown; signal?: unknown; killed?: unknown; message?: unknown;
  };
  const why = status(e);
  const head = `Command failed: ${[cmd, ...args].join(' ')}${why ? ` (${why})` : ''}`;

  const stderr = tail(e.stderr);
  if (stderr) return `${head}\n${stderr}`;

  const stdout = tail(e.stdout);
  if (stdout) return `${head}\nNo error output; last lines of standard output:\n${stdout}`;

  return head;
}
