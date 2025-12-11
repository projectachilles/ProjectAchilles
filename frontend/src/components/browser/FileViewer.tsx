import type { FileContent } from '@/types/test';
import CodeViewer from './CodeViewer';
import MarkdownViewer from './MarkdownViewer';
import { FileText } from 'lucide-react';

interface FileViewerProps {
  file: FileContent;
}

export default function FileViewer({ file }: FileViewerProps) {
  // Render markdown files
  if (file.type === 'markdown') {
    return <MarkdownViewer content={file.content} />;
  }

  // Render code files with syntax highlighting
  if (['go', 'powershell', 'bash', 'json', 'kql', 'yara', 'yaml'].includes(file.type)) {
    return <CodeViewer content={file.content} language={file.type} filename={file.name} />;
  }

  // Render plain text
  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-2 mb-4 text-muted-foreground">
          <FileText className="w-4 h-4" />
          <span className="text-sm">{file.name}</span>
        </div>
        <pre className="p-4 rounded-lg bg-muted text-sm font-mono whitespace-pre-wrap">
          {file.content}
        </pre>
      </div>
    </div>
  );
}
