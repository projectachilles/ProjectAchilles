import type { FileContent } from '@/types/test';
import CodeViewer from './CodeViewer';
import MarkdownViewer from './MarkdownViewer';
import { FileText } from 'lucide-react';

interface FileViewerProps {
  file: FileContent;
}

function prettyPrintNdjson(content: string): string {
  return content
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        return line;
      }
    })
    .filter(Boolean)
    .join('\n\n');
}

export default function FileViewer({ file }: FileViewerProps) {
  // Render markdown files
  if (file.type === 'markdown') {
    return <MarkdownViewer content={file.content} />;
  }

  // Render code files with syntax highlighting
  if (['go', 'powershell', 'bash', 'json', 'kql', 'yara', 'sigma', 'ndjson', 'yaml'].includes(file.type)) {
    const displayContent = file.type === 'ndjson' ? prettyPrintNdjson(file.content) : file.content;
    return <CodeViewer content={displayContent} language={file.type} filename={file.name} />;
  }

  // Render plain text
  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-2 mb-4 text-muted-foreground">
          <FileText className="w-4 h-4" />
          <span className="text-sm">{file.name}</span>
        </div>
        <pre className="p-4 rounded-base bg-muted text-sm font-mono whitespace-pre-wrap text-foreground">
          {file.content}
        </pre>
      </div>
    </div>
  );
}
