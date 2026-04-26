import { useState, useEffect, useRef, useCallback } from 'react';
import DOMPurify from 'dompurify';
import type { TestDetails, FileContent } from '@/types/test';
import { browserApi } from '@/services/api/browser';
import FileViewer from './FileViewer';
import { FileText, BookOpen, ShieldCheck, Workflow, Loader2 } from 'lucide-react';

interface TabbedViewerProps {
  test: TestDetails;
}

interface Tab {
  id: string;
  label: string;
  icon: React.ReactNode;
  type: 'file' | 'attack-flow';
  filename?: string;
  available: boolean;
}

export default function TabbedViewer({ test }: TabbedViewerProps) {
  const attackFlowIframeRef = useRef<HTMLIFrameElement>(null);
  const [activeTab, setActiveTab] = useState<string>('readme');
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [attackFlowHtml, setAttackFlowHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Tactical Green is dark-only; sync once when the iframe loads.
  const syncThemeToIframe = useCallback(() => {
    if (attackFlowIframeRef.current?.contentWindow) {
      attackFlowIframeRef.current.contentWindow.postMessage(
        { type: 'theme-change', theme: 'dark' },
        window.location.origin
      );
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'attack-flow' && attackFlowHtml) {
      syncThemeToIframe();
    }
  }, [activeTab, attackFlowHtml, syncThemeToIframe]);

  // Define available tabs based on test files
  const tabs: Tab[] = [
    {
      id: 'readme',
      label: 'README',
      icon: <FileText className="w-4 h-4" />,
      type: 'file' as const,
      filename: 'README.md',
      available: test.hasReadme,
    },
    {
      id: 'info',
      label: 'Info Card',
      icon: <BookOpen className="w-4 h-4" />,
      type: 'file' as const,
      filename: `${test.uuid}_info.md`,
      available: test.hasInfoCard,
    },
    {
      id: 'defense',
      label: 'Defense',
      icon: <ShieldCheck className="w-4 h-4" />,
      type: 'file' as const,
      filename: test.files.find(f => f.name.includes('_DEFENSE_GUIDANCE'))?.name,
      available: test.hasDefenseGuidance,
    },
    {
      id: 'attack-flow',
      label: 'Attack Flow',
      icon: <Workflow className="w-4 h-4" />,
      type: 'attack-flow' as const,
      available: test.hasAttackFlow,
    },
  ].filter(tab => tab.available);

  // Set initial active tab to first available
  useEffect(() => {
    if (tabs.length > 0 && !tabs.find(t => t.id === activeTab)) {
      setActiveTab(tabs[0].id);
    }
  }, [test.uuid]);

  // Load content when tab changes
  useEffect(() => {
    const currentTab = tabs.find(t => t.id === activeTab);
    if (!currentTab) return;

    if (currentTab.type === 'file' && currentTab.filename) {
      loadFileContent(currentTab.filename);
    } else if (currentTab.type === 'attack-flow') {
      loadAttackFlow();
    }
  }, [activeTab, test.uuid]);

  async function loadFileContent(filename: string) {
    try {
      setLoading(true);
      const content = await browserApi.getFileContent(test.uuid, filename);
      setFileContent(content);
    } catch (err) {
      console.error('Failed to load file content:', err);
      setFileContent(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadAttackFlow() {
    if (attackFlowHtml) return; // Already loaded

    try {
      setLoading(true);
      const html = await browserApi.getAttackFlow(test.uuid);
      const sanitized = DOMPurify.sanitize(html, {
        ADD_TAGS: ['style'],
        ADD_ATTR: ['class', 'style', 'viewBox', 'xmlns', 'fill', 'stroke', 'd', 'transform'],
        WHOLE_DOCUMENT: true,
      });
      setAttackFlowHtml(sanitized);
    } catch (err) {
      console.error('Failed to load attack flow:', err);
    } finally {
      setLoading(false);
    }
  }

  const currentTab = tabs.find(t => t.id === activeTab);

  return (
    <div className="h-full flex flex-col">
      {/* Tab Bar */}
      <div className="flex border-b border-border bg-muted/30">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
              activeTab === tab.id
                ? 'border-primary text-primary bg-background'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>Loading...</span>
            </div>
          </div>
        ) : currentTab?.type === 'attack-flow' && attackFlowHtml ? (
          <iframe
            ref={attackFlowIframeRef}
            srcDoc={attackFlowHtml}
            className="w-full h-full border-0"
            title="Attack Flow Diagram"
            sandbox=""
            onLoad={syncThemeToIframe}
          />
        ) : fileContent ? (
          <FileViewer file={fileContent} />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Select a tab to view content
          </div>
        )}
      </div>
    </div>
  );
}
