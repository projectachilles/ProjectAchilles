import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogHeader, DialogTitle } from '@/components/shared/ui/Dialog';
import MarkdownViewer from '@/components/browser/MarkdownViewer';
import { browserApi } from '@/services/api/browser';

interface TestInfoModalProps {
  open: boolean;
  onClose: () => void;
  testUuid: string;
  testName: string;
  hasInfoCard: boolean;
  hasReadme: boolean;
  scrollToValidator?: string;
}

export default function TestInfoModal({
  open,
  onClose,
  testUuid,
  testName,
  hasInfoCard,
  hasReadme,
  scrollToValidator,
}: TestInfoModalProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const cache = useRef<Map<string, string>>(new Map());

  const fetchContent = useCallback(async () => {
    const cacheKey = testUuid;
    if (cache.current.has(cacheKey)) {
      setContent(cache.current.get(cacheKey)!);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Try _info.md first if available, then fall back to README.md
      const filename = hasInfoCard
        ? `${testUuid}_info.md`
        : hasReadme
          ? 'README.md'
          : null;

      if (!filename) {
        setError('No documentation available for this test.');
        return;
      }

      const file = await browserApi.getFileContent(testUuid, filename);
      cache.current.set(cacheKey, file.content);
      setContent(file.content);
    } catch {
      setError('Failed to load test documentation.');
    } finally {
      setLoading(false);
    }
  }, [testUuid, hasInfoCard, hasReadme]);

  // Fetch content when modal opens
  useEffect(() => {
    if (open && testUuid) {
      fetchContent();
    }
  }, [open, testUuid, fetchContent]);

  // Scroll to validator heading after content renders
  useEffect(() => {
    if (!loading && content && scrollToValidator && contentRef.current) {
      // Small delay to let MarkdownViewer render
      const timer = setTimeout(() => {
        if (!contentRef.current) return;
        const headings = contentRef.current.querySelectorAll('h3');
        for (const h of headings) {
          if (h.textContent?.includes(scrollToValidator)) {
            h.scrollIntoView({ behavior: 'smooth', block: 'start' });
            h.classList.add('bg-accent/50', 'rounded', 'transition-colors');
            setTimeout(() => h.classList.remove('bg-accent/50'), 2000);
            break;
          }
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [loading, content, scrollToValidator]);

  return (
    <Dialog open={open} onClose={onClose} className="max-w-3xl">
      <DialogHeader onClose={onClose}>
        <DialogTitle>{testName}</DialogTitle>
      </DialogHeader>
      <div ref={contentRef} className="max-h-[70vh] overflow-y-auto -mx-6 px-6">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <p className="text-muted-foreground text-sm py-8 text-center">{error}</p>
        )}
        {!loading && content && (
          <MarkdownViewer content={content} />
        )}
      </div>
    </Dialog>
  );
}
