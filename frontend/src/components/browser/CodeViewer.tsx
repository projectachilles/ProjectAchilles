import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, Code } from 'lucide-react';
import { useState } from 'react';

interface CodeViewerProps {
  content: string;
  language: string;
  filename?: string;
}

export default function CodeViewer({ content, language, filename }: CodeViewerProps) {
  const [copied, setCopied] = useState(false);

  const languageMap: Record<string, string> = {
    'go': 'go',
    'powershell': 'powershell',
    'bash': 'bash',
    'json': 'json',
    'kql': 'sql',  // KQL is similar to SQL
    'yara': 'clike',  // YARA has C-like syntax
    'sigma': 'yaml',  // Sigma rules are YAML
    'ndjson': 'json',  // NDJSON: per-line JSON, lex as JSON
    'yaml': 'yaml',
  };

  const syntaxLanguage = languageMap[language] || 'text';

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-muted/50">
        <div className="flex items-center gap-2 text-sm">
          <Code className="w-4 h-4 text-muted-foreground" />
          <span className="font-mono text-foreground">{filename || 'Code'}</span>
          <span className="text-muted-foreground">({syntaxLanguage})</span>
        </div>
        <button
          onClick={copyToClipboard}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-accent text-sm transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4 text-green-500" />
              <span>Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-4 h-4 text-foreground" />
              <span className="text-foreground">Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code Content */}
      <div className="flex-1 overflow-auto">
        <SyntaxHighlighter
          language={syntaxLanguage}
          style={vscDarkPlus}
          customStyle={{
            margin: 0,
            padding: '1.5rem',
            background: 'transparent',
            fontSize: '0.875rem',
            lineHeight: '1.5',
          }}
          showLineNumbers
          lineNumberStyle={{
            minWidth: '3em',
            paddingRight: '1em',
            color: '#858585',
            userSelect: 'none',
          }}
          wrapLines
        >
          {content}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
