import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { browserApi } from '@/services/api/browser';
import FileViewer from '@/components/browser/FileViewer';
import { pillClass } from '@/components/shared/ui/pillStyles';
import type { FileContent } from '@/types/test';
import { fileDisplayName, type TestTab } from './testTabs';

interface DocumentTabProps {
  uuid: string;
  testName: string;
  tab: TestTab;
  /** Resolved file of the tab (always one of `tab.files`). */
  file: string;
  onSelectFile: (file: string) => void;
}

interface Loaded {
  file: string;
  content: FileContent | null;
}

export default function DocumentTab({ uuid, testName, tab, file, onSelectFile }: DocumentTabProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let stale = false;
    browserApi
      .getFileContent(uuid, file)
      .then((content) => { if (!stale) setLoaded({ file, content }); })
      .catch((err) => {
        console.error('Failed to load file content:', err);
        if (!stale) setLoaded({ file, content: null });
      });
    return () => { stale = true; };
  }, [uuid, file]);

  // Derived, so switching files never shows the previous file's content.
  const current = loaded?.file === file ? loaded : null;

  return (
    <div className="min-w-0">
      {tab.files.length > 1 && (
        <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
          {tab.files.map((f) => (
            <button
              key={f.name}
              type="button"
              title={f.name}
              aria-pressed={f.name === file}
              onClick={() => onSelectFile(f.name)}
              className={pillClass(f.name === file, 'h-7 shrink-0 px-2.5 text-xs')}
            >
              {fileDisplayName(f, uuid)}
            </button>
          ))}
        </div>
      )}

      {!current ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : current.content ? (
        <FileViewer file={current.content} hideTitle={testName} />
      ) : (
        <p className="py-12 text-sm text-muted">This file could not be loaded.</p>
      )}
    </div>
  );
}
