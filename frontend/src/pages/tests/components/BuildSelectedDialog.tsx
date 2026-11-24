import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/shared/ui/Dialog';
import { Button } from '@/components/shared/ui/Button';
import { tests as testCount } from '@/components/browser/detail/plural';
import { useBuildQueue } from '@/hooks/useBuildQueue';
import type { BuildQueueItem } from '@/lib/buildQueue';
import type { TestVersionRow } from '@/types/testVersion';

interface BuildSelectedDialogProps {
  open: boolean;
  /** The selected tests, in list order. */
  tests: BuildQueueItem[];
  /** The page's version rows; null when the console has none. */
  versions: Record<string, TestVersionRow> | null;
  onClose: () => void;
  /** The run started: the page leaves select mode. */
  onStarted: () => void;
}

function uploadedLine(uploaded: number): string {
  return uploaded === 1
    ? '1 test has an uploaded binary and is left as it is.'
    : `${uploaded} tests have an uploaded binary and are left as they are.`;
}

/** Confirms a build run of the selected tests. */
export function BuildSelectedDialog({ open, tests, versions, onClose, onStarted }: BuildSelectedDialogProps) {
  const { state, start } = useBuildQueue();
  if (!open) return null;

  // The runner re-checks each test right before building it; this only says up front what it will leave alone.
  const isUploaded = (t: BuildQueueItem) => versions?.[t.uuid]?.status === 'uploaded';
  const toBuild = tests.filter((t) => !isUploaded(t));
  const uploaded = tests.length - toBuild.length;
  const running = state.status === 'running' || state.status === 'stopping';

  const confirm = () => {
    if (start(toBuild.map(({ uuid, name }) => ({ uuid, name })))) onStarted();
    else onClose();
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{`Build and sign ${testCount(toBuild.length)}`}</DialogTitle>
      </DialogHeader>
      <DialogContent className="flex flex-col gap-1.5 text-xs text-muted">
        <p>One at a time. Each takes a few minutes.</p>
        <p>Keeps running while this console stays open in this tab.</p>
        {versions == null ? (
          <p>Tests with an uploaded binary are left as they are.</p>
        ) : (
          uploaded > 0 && <p>{uploadedLine(uploaded)}</p>
        )}
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={confirm} disabled={toBuild.length === 0 || running}>
          Build and sign
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
