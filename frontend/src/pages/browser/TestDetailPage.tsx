import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, FileCode, FileText, AlertCircle, ExternalLink } from 'lucide-react';
import { browserApi } from '../../services/api/browser';
import type { TestDetails, TestFile } from '../../services/api/browser';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/shared/ui/Card';
import { Badge } from '../../components/shared/ui/Badge';
import { Button } from '../../components/shared/ui/Button';
import { Loading } from '../../components/shared/ui/Spinner';

export default function TestDetailPage() {
  const { uuid } = useParams<{ uuid: string }>();
  const [test, setTest] = useState<TestDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<TestFile | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [loadingFile, setLoadingFile] = useState(false);

  useEffect(() => {
    if (uuid) {
      loadTestDetails(uuid);
    }
  }, [uuid]);

  const loadTestDetails = async (testUuid: string) => {
    try {
      setLoading(true);
      setError(null);
      const data = await browserApi.getTestDetails(testUuid);
      setTest(data);
      // Auto-select README if available
      const readme = data.files.find(f => f.name.toLowerCase() === 'readme.md');
      if (readme) {
        loadFileContent(testUuid, readme);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load test details');
    } finally {
      setLoading(false);
    }
  };

  const loadFileContent = async (testUuid: string, file: TestFile) => {
    try {
      setLoadingFile(true);
      setSelectedFile(file);
      const content = await browserApi.getFileContent(testUuid, file.name);
      setFileContent(content);
    } catch (err) {
      setFileContent(`Error loading file: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoadingFile(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Loading message="Loading test details..." />
      </div>
    );
  }

  if (error || !test) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="flex items-center gap-4 p-6 bg-destructive/10 border-destructive/30">
          <AlertCircle className="w-8 h-8 text-destructive" />
          <div>
            <h2 className="font-semibold text-destructive">Failed to Load Test</h2>
            <p className="text-sm text-muted-foreground">{error || 'Test not found'}</p>
          </div>
        </Card>
        <Link to="/">
          <Button variant="ghost" className="mt-4 gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Tests
          </Button>
        </Link>
      </div>
    );
  }

  // Group files by category
  const filesByCategory = test.files.reduce((acc, file) => {
    const category = file.category || 'other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(file);
    return acc;
  }, {} as Record<string, TestFile[]>);

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Back Button */}
      <Link to="/">
        <Button variant="ghost" className="mb-6 gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back to Tests
        </Button>
      </Link>

      {/* Test Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{test.name}</h1>
        <p className="text-sm text-muted-foreground font-mono mb-4">{test.uuid}</p>

        {/* Techniques */}
        <div className="flex flex-wrap gap-2 mb-4">
          {test.techniques.map((technique) => (
            <Badge key={technique} variant="primary">
              {technique}
            </Badge>
          ))}
        </div>

        {/* Meta Info */}
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          {test.score !== undefined && (
            <span>Score: <span className="font-medium text-foreground">{test.score}/10</span></span>
          )}
          {test.category && (
            <span>Category: <span className="font-medium text-foreground">{test.category}</span></span>
          )}
          {test.severity && (
            <span>Severity: <Badge variant={test.severity === 'critical' ? 'destructive' : test.severity === 'high' ? 'warning' : 'default'}>{test.severity}</Badge></span>
          )}
          {test.isMultiStage && (
            <Badge variant="outline">Multi-stage ({test.stages?.length} stages)</Badge>
          )}
        </div>
      </div>

      {/* Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* File Browser Sidebar */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Files</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(filesByCategory).map(([category, files]) => (
                  <div key={category}>
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      {category.replace('_', ' ')}
                    </h4>
                    <div className="space-y-1">
                      {files.map((file) => (
                        <button
                          key={file.path}
                          onClick={() => uuid && loadFileContent(uuid, file)}
                          className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 transition-colors ${
                            selectedFile?.path === file.path
                              ? 'bg-primary/10 text-primary'
                              : 'hover:bg-accent text-foreground'
                          }`}
                        >
                          {file.name.endsWith('.md') ? (
                            <FileText className="w-4 h-4 flex-shrink-0" />
                          ) : (
                            <FileCode className="w-4 h-4 flex-shrink-0" />
                          )}
                          <span className="truncate">{file.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Attack Flow Link */}
              {test.hasAttackFlow && (
                <div className="mt-4 pt-4 border-t border-border">
                  <a
                    href={`/api/browser/tests/${uuid}/attack-flow`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <ExternalLink className="w-4 h-4" />
                    View Attack Flow Diagram
                  </a>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Content Viewer */}
        <div className="lg:col-span-3">
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                {selectedFile ? (
                  <>
                    <FileCode className="w-5 h-5" />
                    {selectedFile.name}
                  </>
                ) : (
                  'Select a file to view'
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingFile ? (
                <Loading message="Loading file..." />
              ) : selectedFile ? (
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm font-mono">
                  <code>{fileContent}</code>
                </pre>
              ) : (
                <p className="text-muted-foreground text-center py-8">
                  Select a file from the sidebar to view its contents.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
