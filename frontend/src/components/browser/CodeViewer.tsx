import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { CSSProperties } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { Copy, Check, Code } from 'lucide-react';
import { useState } from 'react';

// GitHub Light theme - official Primer colors for maximum readability
const githubLight: { [key: string]: CSSProperties } = {
  // Base styles - ensure all text defaults to dark
  'code[class*="language-"]': {
    color: '#1f2328',  // GitHub's darkest text color
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    textAlign: 'left',
    whiteSpace: 'pre',
    wordSpacing: 'normal',
    wordBreak: 'normal',
    wordWrap: 'normal',
    lineHeight: '1.5',
    tabSize: 4,
    hyphens: 'none',
  },
  'pre[class*="language-"]': {
    color: '#1f2328',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    textAlign: 'left',
    whiteSpace: 'pre',
    wordSpacing: 'normal',
    wordBreak: 'normal',
    wordWrap: 'normal',
    lineHeight: '1.5',
    tabSize: 4,
    hyphens: 'none',
    padding: '1em',
    margin: '0',
    overflow: 'auto',
  },
  // Comments - gray italic
  'comment': { color: '#57606a', fontStyle: 'italic' },
  'prolog': { color: '#57606a' },
  'doctype': { color: '#57606a' },
  'cdata': { color: '#57606a' },
  'block-comment': { color: '#57606a', fontStyle: 'italic' },
  // Punctuation - dark
  'punctuation': { color: '#1f2328' },
  // Keywords - red (if, else, func, type, return, etc.)
  'keyword': { color: '#cf222e' },
  'control-flow': { color: '#cf222e' },
  'directive': { color: '#cf222e' },
  'important': { color: '#cf222e', fontWeight: 'bold' },
  'atrule': { color: '#cf222e' },
  // Strings - dark blue
  'string': { color: '#0a3069' },
  'char': { color: '#0a3069' },
  'template-string': { color: '#0a3069' },
  'attr-value': { color: '#0a3069' },
  'regex': { color: '#0a3069' },
  // Functions - purple
  'function': { color: '#8250df' },
  'function-name': { color: '#8250df' },
  'method': { color: '#8250df' },
  'builtin': { color: '#8250df' },
  'entity': { color: '#8250df' },
  // Types and classes - orange/brown
  'class-name': { color: '#953800' },
  'type': { color: '#953800' },
  'namespace': { color: '#953800' },
  'maybe-class-name': { color: '#953800' },
  // Constants, numbers, booleans - blue
  'boolean': { color: '#0550ae' },
  'number': { color: '#0550ae' },
  'constant': { color: '#0550ae' },
  'symbol': { color: '#0550ae' },
  'property': { color: '#0550ae' },
  'attr-name': { color: '#0550ae' },
  // Variables and parameters - dark (readable!)
  'variable': { color: '#1f2328' },
  'parameter': { color: '#1f2328' },
  'property-access': { color: '#1f2328' },
  'plain-text': { color: '#1f2328' },
  'plain': { color: '#1f2328' },
  // Operators - red
  'operator': { color: '#cf222e' },
  // Tags (HTML/XML) - green
  'tag': { color: '#116329' },
  'selector': { color: '#116329' },
  'inserted': { color: '#116329', backgroundColor: '#dafbe1' },
  // Deleted - red with background
  'deleted': { color: '#82071e', backgroundColor: '#ffebe9' },
  // URL
  'url': { color: '#0550ae', textDecoration: 'underline' },
  // Formatting
  'bold': { fontWeight: 'bold' },
  'italic': { fontStyle: 'italic' },
  // Go-specific tokens
  'package': { color: '#cf222e' },
  'imports': { color: '#0a3069' },
};

interface CodeViewerProps {
  content: string;
  language: string;
  filename?: string;
}

export default function CodeViewer({ content, language, filename }: CodeViewerProps) {
  const { theme } = useTheme();
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
          style={theme === 'dark' ? vscDarkPlus : githubLight}
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
            color: theme === 'dark' ? '#858585' : '#57606a',
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
