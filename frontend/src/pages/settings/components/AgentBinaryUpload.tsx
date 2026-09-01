import { useState, useRef, useEffect } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/shared/ui/Button';
import { Input } from '@/components/shared/ui/Input';
import { Select } from '@/components/shared/ui/Select';
import { Alert } from '@/components/shared/ui/Alert';
import { Spinner } from '@/components/shared/ui/Spinner';
import { agentApi } from '@/services/api/agent';
import { testsApi, type CertificateInfo } from '@/services/api/tests';
import { pushFlashNotification } from '@/lib/flashNotifications';

const OS_OPTIONS = [
  { value: 'linux', label: 'Linux' },
  { value: 'windows', label: 'Windows' },
  { value: 'darwin', label: 'macOS' },
];

const ARCH_OPTIONS = [
  { value: 'amd64', label: 'x86_64 (amd64)' },
  { value: 'arm64', label: 'ARM64' },
];

function certLabel(certs: CertificateInfo[], id: string): string {
  const c = certs.find((x) => x.id === id);
  return c?.label || c?.subject?.commonName || id;
}

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
  const [certificates, setCertificates] = useState<CertificateInfo[]>([]);
  const [activeCertId, setActiveCertId] = useState<string | null>(null);
  // '' means "use the active certificate" — the default, so the common case
  // needs no decision from the operator.
  const [certId, setCertId] = useState('');
  const [allowUnsigned, setAllowUnsigned] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Only Windows uploads take a certificate. macOS is ad-hoc signed (no cert
  // needed) and Linux has no signing ecosystem equivalent.
  const signable = os === 'windows';

  useEffect(() => {
    testsApi.listCertificates()
      .then((res) => {
        setCertificates(res.certificates.filter((c) => c.exists));
        setActiveCertId(res.activeCertId ?? null);
      })
      .catch(() => { /* picker just stays empty; the server still validates */ });
  }, []);

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
    if (signable && certId) formData.append('cert_id', certId);
    if (allowUnsigned) formData.append('allow_unsigned', 'true');
    formData.append('binary', file);

    try {
      await agentApi.uploadVersion(formData);
      setMessage({ type: 'success', text: `Version ${version} (${os}/${arch}) uploaded successfully` });
      pushFlashNotification(
        `Agent v${version} uploaded for ${os}/${arch}`,
        { detail: 'Agents running older versions should be updated', type: 'success' },
      );
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

      {/* Signing — Windows only. The upload is the point where a CI-built
          binary gets the tenant's own certificate, which is what the fleet's
          WDAC/EDR policy actually trusts. */}
      {signable && (
        <div className="rounded-lg border border-border bg-surface p-3 space-y-2.5">
          <div className="text-[11px] uppercase tracking-wider text-faint">code signing</div>
          {certificates.length === 0 ? (
            <Alert variant="warning">
              No code signing certificate is configured. Add one under Settings &rarr; Tests,
              or tick &ldquo;register unsigned&rdquo; below.
            </Alert>
          ) : (
            <Select
              label="Certificate"
              options={[
                {
                  value: '',
                  label: activeCertId
                    ? `Active certificate (${certLabel(certificates, activeCertId)})`
                    : 'Active certificate',
                },
                ...certificates.map((c) => ({
                  value: c.id,
                  label: `${c.label || c.subject?.commonName || c.id}${c.expiry ? ` — expires ${new Date(c.expiry).toLocaleDateString()}` : ''}`,
                })),
              ]}
              value={certId}
              onChange={(e) => setCertId(e.target.value)}
            />
          )}
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={allowUnsigned}
              onChange={(e) => setAllowUnsigned(e.target.checked)}
              className="rounded border-border"
            />
            Register unsigned if signing fails
          </label>
          {allowUnsigned && (
            <p className="text-[11px] text-warning">
              Endpoints enforcing WDAC or application control will refuse to run an unsigned agent.
            </p>
          )}
        </div>
      )}

      {os === 'darwin' && (
        <p className="text-xs text-faint">
          macOS binaries are ad-hoc signed automatically; no certificate is required.
        </p>
      )}
      {os === 'linux' && (
        <p className="text-xs text-faint">Code signing is not available for Linux binaries.</p>
      )}

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
