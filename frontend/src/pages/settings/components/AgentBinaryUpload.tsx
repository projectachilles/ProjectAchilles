import { useState, useRef } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/shared/ui/Button';
import { Input } from '@/components/shared/ui/Input';
import { Select } from '@/components/shared/ui/Select';
import { Alert } from '@/components/shared/ui/Alert';
import { Spinner } from '@/components/shared/ui/Spinner';
import { agentApi } from '@/services/api/agent';

const OS_OPTIONS = [
  { value: 'linux', label: 'Linux' },
  { value: 'windows', label: 'Windows' },
  { value: 'darwin', label: 'macOS' },
];

const ARCH_OPTIONS = [
  { value: 'amd64', label: 'x86_64 (amd64)' },
  { value: 'arm64', label: 'ARM64' },
];

interface AgentBinaryUploadProps {
  onUploaded: () => void;
}

export function AgentBinaryUpload({ onUploaded }: AgentBinaryUploadProps) {
  const [version, setVersion] = useState('');
  const [os, setOs] = useState('linux');
  const [arch, setArch] = useState('amd64');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [mandatory, setMandatory] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file || !version) return;

    setUploading(true);
    setMessage(null);

    const formData = new FormData();
    formData.append('version', version);
    formData.append('os', os);
    formData.append('arch', arch);
    formData.append('release_notes', releaseNotes);
    formData.append('mandatory', String(mandatory));
    formData.append('binary', file);

    try {
      await agentApi.uploadVersion(formData);
      setMessage({ type: 'success', text: `Version ${version} (${os}/${arch}) uploaded successfully` });
      setVersion('');
      setReleaseNotes('');
      setMandatory(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onUploaded();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setMessage({ type: 'error', text: msg });
    } finally {
      setUploading(false);
    }
  }

  const file = fileInputRef.current?.files?.[0];
  const canUpload = !!version && !!file && !uploading;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Input
          label="Version"
          placeholder="1.0.0"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
        />
        <Select
          label="Operating System"
          options={OS_OPTIONS}
          value={os}
          onChange={(e) => setOs(e.target.value)}
        />
        <Select
          label="Architecture"
          options={ARCH_OPTIONS}
          value={arch}
          onChange={(e) => setArch(e.target.value)}
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5 text-foreground">
          Binary File
        </label>
        <input
          ref={fileInputRef}
          type="file"
          onChange={() => setMessage(null)}
          className="block w-full text-sm text-foreground file:mr-4 file:py-2 file:px-4
            file:rounded-lg file:border-0 file:text-sm file:font-medium
            file:bg-primary/10 file:text-primary hover:file:bg-primary/20
            file:cursor-pointer cursor-pointer"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5 text-foreground">
          Release Notes
        </label>
        <textarea
          value={releaseNotes}
          onChange={(e) => setReleaseNotes(e.target.value)}
          placeholder="Optional release notes..."
          rows={2}
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5
            text-foreground text-sm
            focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary
            resize-none"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={mandatory}
          onChange={(e) => setMandatory(e.target.checked)}
          className="rounded border-border"
        />
        Mandatory update
      </label>

      <div className="flex items-center gap-3">
        <Button onClick={handleUpload} disabled={!canUpload}>
          {uploading ? (
            <>
              <Spinner size="sm" className="mr-2" />
              Uploading...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4 mr-2" />
              Upload Binary
            </>
          )}
        </Button>
      </div>

      {message && (
        <Alert variant={message.type === 'success' ? 'default' : 'destructive'}>
          {message.text}
        </Alert>
      )}
    </div>
  );
}
