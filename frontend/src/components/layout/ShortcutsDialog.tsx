import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** [key, label] rows for the route bindings, in nav order. */
  routeBindings: Array<[string, string]>;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-raised px-1.5 py-0.5 font-mono text-xs text-foreground">
      {children}
    </kbd>
  );
}

export function ShortcutsDialog({ open, onOpenChange, routeBindings }: ShortcutsDialogProps) {
  const rows: Array<[React.ReactNode, string]> = [
    ...routeBindings.map(([key, label]): [React.ReactNode, string] => [<Kbd key={key}>{key}</Kbd>, `Go to ${label}`]),
    [<Kbd key="/">/</Kbd>, 'Focus page search'],
    [<Kbd key="cmdk">⌘K</Kbd>, 'Global search'],
    [<Kbd key="?">?</Kbd>, 'Show this dialog'],
    [<Kbd key="esc">Esc</Kbd>, 'Close dialogs'],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Navigate the console without the mouse</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {rows.map(([key, label], i) => (
            <li key={i} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-muted">{label}</span>
              {key}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
