import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { browserApi } from '@/services/api/browser';
import type { TestDetails, FileContent } from '@/types/test';
import TechniqueBadge from '@/components/browser/TechniqueBadge';
import FileViewer from '@/components/browser/FileViewer';
import DefenseDashboard from '@/components/browser/DefenseDashboard';
import { useTheme } from '@/hooks/useTheme';
import BuildSection from '@/components/browser/BuildSection';
import { useTestPreferences } from '@/hooks/useTestPreferences';
import { ArrowLeft, Calendar, Layers, Star, Loader2, FileText, Code, Shield, AlertTriangle, Workflow, ShieldCheck, Minimize2, Heart, Tag, User, Clock } from 'lucide-react';
import { formatRelativeDate, formatFullDate } from '@/utils/dateFormatters';

export default function TestDetailPage() {
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const attackFlowIframeRef = useRef<HTMLIFrameElement>(null);
  const [test, setTest] = useState<TestDetails | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [attackFlowHtml, setAttackFlowHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'file' | 'attack-flow'>('file');
  const [hasUserInteracted, setHasUserInteracted] = useState(false); // Track if user clicked something
  const { isFavorite, toggleFavorite, trackView } = useTestPreferences();

  // Sync theme to attack flow iframe via postMessage
  const syncThemeToIframe = useCallback(() => {
    if (attackFlowIframeRef.current?.contentWindow) {
      attackFlowIframeRef.current.contentWindow.postMessage(
        { type: 'theme-change', theme },
        window.location.origin
      );
    }
  }, [theme]);

  // Sync theme when it changes or when iframe loads
  useEffect(() => {
    syncThemeToIframe();
  }, [theme, attackFlowHtml, syncThemeToIframe]);

  useEffect(() => {
    if (uuid) {
      loadTestDetails(uuid);
      setHasUserInteracted(false); // Reset on test change
    }
  }, [uuid]);

  useEffect(() => {
    if (selectedFile && uuid && activeView === 'file') {
      const controller = new AbortController();
      loadFileContent(uuid, selectedFile);

      return () => {
        controller.abort();
      };
    }
  }, [selectedFile, uuid, activeView]);

  async function loadTestDetails(testUuid: string) {
    try {
      setLoading(true);
      const data = await browserApi.getTestDetails(testUuid);
      setTest(data);
      trackView(testUuid, data.name);

      // Auto-select README if available
      if (data.hasReadme) {
        setSelectedFile('README.md');
      } else if (data.files.length > 0) {
        setSelectedFile(data.files[0].name);
      }
    } catch (err) {
      setError('Failed to load test details');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadFileContent(testUuid: string, filename: string) {
    try {
      setFileLoading(true);
      const content = await browserApi.getFileContent(testUuid, filename);
      setFileContent(content);
    } catch (err) {
      console.error('Failed to load file content:', err);
      setFileContent(null);
    } finally {
      setFileLoading(false);
    }
  }

  async function loadAttackFlow() {
    if (!uuid || !test?.hasAttackFlow) return;

    try {
      setFileLoading(true);
      const html = await browserApi.getAttackFlow(uuid);
      setAttackFlowHtml(html);
      setActiveView('attack-flow');
    } catch (err) {
      console.error('Failed to load attack flow:', err);
    } finally {
      setFileLoading(false);
    }
  }

  function handleFileSelect(filename: string) {
    setSelectedFile(filename);
    setActiveView('file');
    setHasUserInteracted(true); // User clicked a file
  }

  function handleAttackFlowClick() {
    setHasUserInteracted(true); // User clicked attack flow
    if (!attackFlowHtml) {
      loadAttackFlow();
    } else {
      setActiveView('attack-flow');
    }
  }

  // Helper to get clean display name for defense files
  function getDefenseFileDisplayName(filename: string): string {
    if (filename.includes('DEFENSE_GUIDANCE')) return 'Defense Guide';
    if (filename.includes('_dr_rules')) return 'D&R Rules';
    if (filename.includes('_hardening')) return 'Hardening Script';
    if (filename.includes('_detections.kql')) return 'KQL Detections';
    if (filename.includes('_rules.yar')) return 'YARA Rules';
    // Fallback: get extension
    const ext = filename.split('.').pop() || '';
    return ext.toUpperCase() + ' File';
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span>Loading test details...</span>
        </div>
      </div>
    );
  }

  if (error || !test) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error || 'Test not found'}</p>
          <button
            onClick={() => navigate('/browser')}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
          >
            Back to Tests
          </button>
        </div>
      </div>
    );
  }

  // Categorize files
  const documentationFiles = test.files.filter(f => f.category === 'documentation');
  const defenseFiles = test.files.filter(f => f.category === 'defense');
  const sourceFiles = test.files.filter(f => f.category === 'source');
  const detectionFiles = test.files.filter(f => f.category === 'detection');
  const configFiles = test.files.filter(f => f.category === 'config');

  // Determine if we should use compact header
  // Show compact header after user clicks any file/view (not on initial load)
  const isCompactMode = hasUserInteracted;

  // Function to exit compact mode and show full header again
  function handleExitCompactMode() {
    setHasUserInteracted(false);
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header - Compact or Full */}
      {isCompactMode ? (
        /* Compact Header for Attack Flow View */
        <div className="border-b border-border bg-background/95 backdrop-blur">
          <div className="container mx-auto px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/browser')}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Back</span>
              </button>
              <div className="h-4 w-px bg-border" />
              <h1 className="text-lg font-semibold truncate max-w-md lg:max-w-xl text-foreground">{test.name}</h1>
              <span className="hidden md:inline text-xs font-mono text-muted-foreground">
                {test.uuid.slice(0, 8)}...
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => toggleFavorite(test.uuid)}
                className="p-1.5 rounded-md hover:bg-accent transition-colors"
                title={isFavorite(test.uuid) ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Heart className={`w-4 h-4 transition-colors ${isFavorite(test.uuid) ? 'fill-red-500 text-red-500' : 'text-muted-foreground hover:text-red-400'}`} />
              </button>
              {test.score && (
                <div className="flex items-center gap-1 text-amber-500">
                  <Star className="w-4 h-4 fill-current" />
                  <span className="font-bold">{test.score.toFixed(1)}</span>
                </div>
              )}
              <button
                onClick={handleExitCompactMode}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent transition-colors"
                title="Exit fullscreen view"
              >
                <Minimize2 className="w-4 h-4" />
                <span className="hidden sm:inline">Exit</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Full Header for File/Document Views */
        <div className="border-b border-border bg-background/95 backdrop-blur">
          <div className="container mx-auto px-4 py-4">
            <button
              onClick={() => navigate('/browser')}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-3"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to tests
            </button>

            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex-1">
                <h1 className="text-2xl font-bold mb-2 text-foreground">{test.name}</h1>
                <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                  {test.severity && (
                    <span className="font-medium uppercase text-orange-500">
                      {test.severity}
                    </span>
                  )}
                  {test.isMultiStage && (
                    <div className="flex items-center gap-1">
                      <Layers className="w-4 h-4" />
                      <span>{test.stages.length} stages</span>
                    </div>
                  )}
                  {test.version && (
                    <div className="flex items-center gap-1">
                      <Tag className="w-4 h-4" />
                      <span>v{test.version}</span>
                    </div>
                  )}
                  {test.author && (
                    <div className="flex items-center gap-1">
                      <User className="w-4 h-4" />
                      <span>{test.author}</span>
                    </div>
                  )}
                  {test.createdDate && (
                    <div className="flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      <span>{test.createdDate}</span>
                    </div>
                  )}
                  {test.lastModifiedDate && (
                    <div
                      className="flex items-center gap-1"
                      title={test.lastCommitMessage
                        ? `${formatFullDate(test.lastModifiedDate)} — ${test.lastCommitMessage}`
                        : formatFullDate(test.lastModifiedDate)}
                    >
                      <Clock className="w-4 h-4" />
                      <span>Modified {formatRelativeDate(test.lastModifiedDate)}</span>
                    </div>
                  )}
                  <span className="font-mono text-xs">{test.uuid}</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggleFavorite(test.uuid)}
                  className="p-2 rounded-lg hover:bg-accent transition-colors"
                  title={isFavorite(test.uuid) ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <Heart className={`w-5 h-5 transition-colors ${isFavorite(test.uuid) ? 'fill-red-500 text-red-500' : 'text-muted-foreground hover:text-red-400'}`} />
                </button>
                {test.score && (
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <Star className="w-5 h-5 text-amber-500 fill-current" />
                    <div>
                      <div className="text-2xl font-bold text-amber-500">{test.score.toFixed(1)}</div>
                      <div className="text-xs text-muted-foreground">Test Score</div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Techniques */}
            <div className="flex flex-wrap gap-2 mb-3">
              {test.techniques.map(technique => (
                <TechniqueBadge key={technique} technique={technique} />
              ))}
            </div>

            {/* Description */}
            {test.description && (
              <p className="text-sm text-muted-foreground">{test.description}</p>
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - File Browser */}
        <div className="w-80 border-r border-border bg-muted/30 overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Documentation Files */}
            {documentationFiles.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-2">
                  <FileText className="w-3 h-3" />
                  Documentation
                </h3>
                <div className="space-y-1">
                  {documentationFiles.map(file => (
                    <button
                      key={file.name}
                      onClick={() => handleFileSelect(file.name)}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                        selectedFile === file.name && activeView === 'file'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-foreground hover:bg-accent'
                      }`}
                    >
                      {file.name === 'SAFETY.md' && <AlertTriangle className="w-3 h-3 inline mr-2 text-orange-500" />}
                      {file.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Attack Flow */}
            {test.hasAttackFlow && (
              <div>
                <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-2">
                  <Workflow className="w-3 h-3" />
                  Visualization
                </h3>
                <button
                  onClick={handleAttackFlowClick}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    activeView === 'attack-flow'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground hover:bg-accent'
                  }`}
                >
                  Attack Flow Diagram
                </button>
              </div>
            )}

            {/* Defense Guidance */}
            {defenseFiles.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-2">
                  <ShieldCheck className="w-3 h-3" />
                  Defense Guidance
                </h3>
                <div className="space-y-1">
                  {defenseFiles.map(file => (
                    <button
                      key={file.name}
                      onClick={() => handleFileSelect(file.name)}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-2 ${
                        selectedFile === file.name && activeView === 'file'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-foreground hover:bg-accent'
                      }`}
                    >
                      {file.name.includes('DEFENSE_GUIDANCE') && <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />}
                      {file.name.includes('_dr_rules') && <span className="w-2 h-2 rounded-full bg-cyan-500 flex-shrink-0" />}
                      {file.name.includes('_hardening') && <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" />}
                      {getDefenseFileDisplayName(file.name)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Source Files */}
            {sourceFiles.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-2">
                  <Code className="w-3 h-3" />
                  Source Code
                </h3>
                <div className="space-y-1">
                  {sourceFiles.map(file => (
                    <button
                      key={file.name}
                      onClick={() => handleFileSelect(file.name)}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm font-mono transition-colors ${
                        selectedFile === file.name && activeView === 'file'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-foreground hover:bg-accent'
                      }`}
                    >
                      {file.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Build */}
            {sourceFiles.length > 0 && uuid && (
              <BuildSection uuid={uuid} />
            )}

            {/* Detection Rules */}
            {detectionFiles.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-2">
                  <Shield className="w-3 h-3" />
                  Detection Rules
                </h3>
                <div className="space-y-1">
                  {detectionFiles.map(file => (
                    <button
                      key={file.name}
                      onClick={() => handleFileSelect(file.name)}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm font-mono transition-colors ${
                        selectedFile === file.name && activeView === 'file'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-foreground hover:bg-accent'
                      }`}
                    >
                      {file.type === 'kql' && <span className="text-xs text-blue-500 mr-2">KQL</span>}
                      {file.type === 'yara' && <span className="text-xs text-purple-500 mr-2">YARA</span>}
                      {file.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Config Files */}
            {configFiles.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-2">
                  <Shield className="w-3 h-3" />
                  Configuration
                </h3>
                <div className="space-y-1">
                  {configFiles.map(file => (
                    <button
                      key={file.name}
                      onClick={() => handleFileSelect(file.name)}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm font-mono transition-colors ${
                        selectedFile === file.name && activeView === 'file'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-foreground hover:bg-accent'
                      }`}
                    >
                      {file.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Content Viewer */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Defense Dashboard (hidden in compact mode for attack flow) */}
          {test.hasDefenseGuidance && !isCompactMode && (
            <div className="p-4 pb-0">
              <DefenseDashboard test={test} />
            </div>
          )}

          {/* Main Content Area */}
          <div className="flex-1 overflow-hidden">
            {fileLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span>Loading...</span>
                </div>
              </div>
            ) : activeView === 'attack-flow' && attackFlowHtml ? (
              <iframe
                ref={attackFlowIframeRef}
                srcDoc={attackFlowHtml}
                className="w-full h-full border-0"
                title="Attack Flow Diagram"
                sandbox="allow-scripts"
                onLoad={syncThemeToIframe}
              />
            ) : fileContent ? (
              <FileViewer file={fileContent} />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Select a file to view its content
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
