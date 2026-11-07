import type { TestDetails, TestFile } from '@/types/test';
import { pillClass } from '@/components/shared/ui/pillStyles';
import { fileDisplayName, type TestTabId } from '../testTabs';
import Panel from './Panel';

interface ShipsWithPanelProps {
  test: TestDetails;
  onOpen: (tab: TestTabId, file: string) => void;
}

function Group({ label, tab, files, uuid, onOpen }: {
  label: string;
  tab: TestTabId;
  files: TestFile[];
  uuid: string;
  onOpen: ShipsWithPanelProps['onOpen'];
}) {
  if (files.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">{label}</h3>
      <div className="flex flex-wrap gap-1.5">
        {files.map((file) => (
          <button
            key={file.name}
            type="button"
            title={file.name}
            onClick={() => onOpen(tab, file.name)}
            className={pillClass(false, 'h-7 px-2.5 text-xs')}
          >
            {fileDisplayName(file, uuid)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Detection rules and defense/hardening files the test comes with. */
export default function ShipsWithPanel({ test, onOpen }: ShipsWithPanelProps) {
  const files = test.files ?? [];
  const detection = files.filter((f) => f.category === 'detection');
  const defense = files.filter((f) => f.category === 'defense');

  return (
    <Panel title="Ships with" hidden={detection.length === 0 && defense.length === 0}>
      <div className="space-y-3">
        <Group label="Detection" tab="detection" files={detection} uuid={test.uuid} onOpen={onOpen} />
        <Group label="Defense" tab="defense" files={defense} uuid={test.uuid} onOpen={onOpen} />
      </div>
    </Panel>
  );
}
