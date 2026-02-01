import { useState, useEffect } from 'react';
import { testsApi, type CertificateInfo } from '@/services/api/tests';
import { Input } from '@/components/shared/ui/Input';
import { Button } from '@/components/shared/ui/Button';
import { Spinner } from '@/components/shared/ui/Spinner';
import { Alert } from '@/components/shared/ui/Alert';

interface CertificateConfigProps {
  onStatusChange?: (exists: boolean) => void;
}

export function CertificateConfig({ onStatusChange }: CertificateConfigProps) {
  const [certInfo, setCertInfo] = useState<CertificateInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form fields
  const [commonName, setCommonName] = useState('Microsoft Windows');
  const [organization, setOrganization] = useState('Microsoft Corporation');
  const [country, setCountry] = useState('US');

  useEffect(() => {
    testsApi.getCertificate()
      .then((info) => {
        setCertInfo(info);
        onStatusChange?.(info.exists);
      })
      .catch(() => {
        setCertInfo({ exists: false });
        onStatusChange?.(false);
      })
      .finally(() => setLoading(false));
  }, [onStatusChange]);

  const handleGenerate = async () => {
    setError(null);
    setGenerating(true);
    try {
      const info = await testsApi.generateCertificate({ commonName, organization, country });
      setCertInfo(info);
      onStatusChange?.(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate certificate');
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async () => {
    setError(null);
    setDeleting(true);
    try {
      await testsApi.deleteCertificate();
      setCertInfo({ exists: false });
      onStatusChange?.(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete certificate');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  // Certificate exists - show info
  if (certInfo?.exists) {
    return (
      <div className="space-y-4">
        <div className="space-y-3">
          <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
            <span className="text-muted-foreground">Common Name</span>
            <span className="font-mono">{certInfo.subject?.commonName}</span>

            <span className="text-muted-foreground">Organization</span>
            <span className="font-mono">{certInfo.subject?.organization}</span>

            <span className="text-muted-foreground">Country</span>
            <span className="font-mono">{certInfo.subject?.country}</span>

            <span className="text-muted-foreground">Expires</span>
            <span className="font-mono">
              {certInfo.expiry ? new Date(certInfo.expiry).toLocaleDateString() : 'N/A'}
            </span>

            <span className="text-muted-foreground">Fingerprint</span>
            <span className="font-mono text-xs break-all">
              {certInfo.fingerprint
                ? certInfo.fingerprint.length > 40
                  ? certInfo.fingerprint.slice(0, 40) + '...'
                  : certInfo.fingerprint
                : 'N/A'}
            </span>

            <span className="text-muted-foreground">Created</span>
            <span className="font-mono">
              {certInfo.createdAt ? new Date(certInfo.createdAt).toLocaleDateString() : 'N/A'}
            </span>
          </div>
        </div>

        {error && <Alert variant="destructive">{error}</Alert>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleDelete} disabled={deleting}>
            {deleting ? <><Spinner size="sm" /> Deleting...</> : 'Delete Certificate'}
          </Button>
          <Button variant="destructive" onClick={handleGenerate} disabled={generating}>
            {generating ? <><Spinner size="sm" /> Regenerating...</> : 'Regenerate Certificate'}
          </Button>
        </div>
      </div>
    );
  }

  // No certificate - show generation form
  return (
    <div className="space-y-4">
      <Input
        label="Common Name"
        value={commonName}
        onChange={(e) => setCommonName(e.target.value)}
        placeholder="Microsoft Windows"
      />
      <Input
        label="Organization"
        value={organization}
        onChange={(e) => setOrganization(e.target.value)}
        placeholder="Microsoft Corporation"
      />
      <Input
        label="Country (2-letter code)"
        value={country}
        onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
        placeholder="US"
        maxLength={2}
      />

      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="flex justify-end">
        <Button
          onClick={handleGenerate}
          disabled={generating || !commonName || !organization || country.length !== 2}
        >
          {generating ? (
            <><Spinner size="sm" /> Generating...</>
          ) : (
            'Generate Certificate'
          )}
        </Button>
      </div>
    </div>
  );
}
