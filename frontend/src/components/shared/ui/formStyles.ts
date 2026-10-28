// Field styles shared by the shared/ui primitives and the hand-written native
// <label>/<select>/<textarea> fields in forms and dialogs, so both match the
// components/ui kit (h-9, text-sm, bg-raised, small uppercase labels). Change
// them here rather than copying the class strings into another form.

export const fieldLabelClass = 'mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted';

const fieldBase =
  'w-full rounded-md border border-border bg-raised px-3 text-sm text-foreground placeholder:text-faint ' +
  'transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/** Single-line controls: <input>, <select>. */
export const fieldControlClass = `${fieldBase} h-9`;

/** Multi-line controls: <textarea> (height comes from rows / min-h). */
export const fieldTextareaClass = `${fieldBase} py-2`;

export const fieldHelpClass = 'mt-1.5 text-xs text-muted';

export const fieldErrorClass = 'mt-1.5 text-xs text-danger';
