import { useState, useEffect, useCallback } from 'react';
import { testsApi, type CertificateInfo, type CertificateListResponse } from '@/services/api/tests';
import { Input } from '@/components/shared/ui/Input';
import { Button } from '@/components/shared/ui/Button';
import { Spinner } from '@/components/shared/ui/Spinner';
import { Alert } from '@/components/shared/ui/Alert';
import { Badge } from '@/components/shared/ui/Badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/shared/ui/Tabs';
import { Download, Trash2, Upload, KeyRound } from 'lucide-react';

interface CertificateConfigProps {
  canDelete?: boolean;
  onStatusChange?: (exists: boolean) => void;
}

export function CertificateConfig({ canDelete = true, onStatusChange }: CertificateConfigProps) {
  const [data, setData] = useState<CertificateListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Upload form
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPassword, setUploadPassword] = useState('');
  const [uploadLabel, setUploadLabel] = useState('');
  const [uploading, setUploading] = useState(false);

  // Generate form
  const [commonName, setCommonName] = useState('Microsoft Windows');
  const [organization, setOrganization] = useState('Microsoft Corporation');
  const [country, setCountry] = useState('US');
  const [generateLabel, setGenerateLabel] = useState('');
  const [generatePassword, setGeneratePassword] = useState('');
  const [generating, setGenerating] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [settingActiveId, setSettingActiveId] = useState<string | null>(null);

  const loadCertificates = useCallback(async () => {
    try {
      const result = await testsApi.listCertificates();
      setData(result);
      onStatusChange?.(result.certificates.length > 0 && result.activeCertId !== null);
    } catch {
      setData({ certificates: [], activeCertId: null });
      onStatusChange?.(false);
    } finally {
      setLoading(false);
    }
  }, [onStatusChange]);

  useEffect(() => {
    loadCertificates();
  }, [loadCertificates]);

  const atLimit = (data?.certificates.length ?? 0) >= 5;

  const handleUpload = async () => {
    if (!uploadFile || !uploadPassword) return;
    setError(null);
    setUploading(true);
    try {
      await testsApi.uploadCertificate(uploadFile, uploadPassword, uploadLabel || undefined);
      setUploadFile(null);
      setUploadPassword('');
      setUploadLabel('');
      await loadCertificates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload certificate');
    } finally {
      setUploading(false);
    }
  };

  const handleGenerate = async () => {
    setError(null);
    setGenerating(true);
    try {
      await testsApi.generateCertificateWithLabel(
        { commonName, organization, country },
        generateLabel || undefined,
        generatePassword || undefined,
      );
      setGenerateLabel('');
      setGeneratePassword('');
      await loadCertificates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate certificate');
    } finally {
      setGenerating(false);
    }
  };

  const handleSetActive = async (id: string) => {
    setError(null);
    setSettingActiveId(id);
    try {
      await testsApi.setActiveCertificate(id);
      await loadCertificates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set active certificate');
    } finally {
      setSettingActiveId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    setDeletingId(id);
    try {
      await testsApi.deleteCertificateById(id);
      await loadCertificates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete certificate');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownload = async (id: string) => {
    setError(null);
    setDownloadingId(id);
    try {
      await testsApi.downloadCertificate(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download certificate');
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  const certificates = data?.certificates ?? [];
  const activeCertId = data?.activeCertId ?? null;

  return (
    <div className="space-y-5">
      {/* Certificate List */}
      {certificates.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {certificates.length} certificate{certificates.length !== 1 ? 's' : ''} — select one for build signing
          </p>
          <div className="space-y-2">
            {certificates.map((cert) => (
              <CertificateListItem
                key={cert.id}
                cert={cert}
                isActive={cert.id === activeCertId}
                canDelete={canDelete}
                onSetActive={handleSetActive}
                onDelete={handleDelete}
                onDownload={handleDownload}
                isSettingActive={settingActiveId === cert.id}
                isDeleting={deletingId === cert.id}
                isDownloading={downloadingId === cert.id}
              />
            ))}
          </div>
        </div>
      )}

      {error && <Alert variant="destructive">{error}</Alert>}

      {/* Add Certificate Tabs */}
      {atLimit ? (
        <p className="text-sm text-muted-foreground">
          Maximum of 5 certificates reached. Delete one to add another.
        </p>
      ) : (
        <Tabs defaultValue="upload">
          <TabsList>
            <TabsTrigger value="upload">
              <Upload className="h-4 w-4" />
              Upload Certificate
            </TabsTrigger>
            <TabsTrigger value="generate">
              <KeyRound className="h-4 w-4" />
              Generate Certificate
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">PFX/P12 File</label>
                <input
                  type="file"
                  accept=".pfx,.p12"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-muted-foreground
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-md file:border-0
                    file:text-sm file:font-medium
                    file:bg-primary/10 file:text-primary
                    hover:file:bg-primary/20
                    cursor-pointer"
                />
              </div>
              <Input
                label="Certificate Password"
                type="password"
                value={uploadPassword}
                onChange={(e) => setUploadPassword(e.target.value)}
                placeholder="Password for the PFX file"
              />
              <Input
                label="Label (optional)"
                value={uploadLabel}
                onChange={(e) => setUploadLabel(e.target.value)}
                placeholder="e.g. Production Cert, Test Cert"
              />
              <div className="flex justify-end">
                <Button
                  onClick={handleUpload}
                  disabled={uploading || !uploadFile || !uploadPassword}
                >
                  {uploading ? (
                    <><Spinner size="sm" /> Uploading...</>
                  ) : (
                    'Upload Certificate'
                  )}
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="generate">
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
              <Input
                label="Password (optional)"
                type="password"
                value={generatePassword}
                onChange={(e) => setGeneratePassword(e.target.value)}
                placeholder="Leave blank for auto-generated password"
              />
              <Input
                label="Label (optional)"
                value={generateLabel}
                onChange={(e) => setGenerateLabel(e.target.value)}
                placeholder="e.g. Dev Signing Cert"
              />
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
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ── Certificate List Item ───────────────────────────────────

interface CertificateListItemProps {
  cert: CertificateInfo;
  isActive: boolean;
  canDelete?: boolean;
  onSetActive: (id: string) => void;
  onDelete: (id: string) => void;
  onDownload: (id: string) => void;
  isSettingActive: boolean;
  isDeleting: boolean;
  isDownloading: boolean;
}

function CertificateListItem({
  cert,
  isActive,
  canDelete = true,
  onSetActive,
  onDelete,
  onDownload,
  isSettingActive,
  isDeleting,
  isDownloading,
}: CertificateListItemProps) {
  const displayName = cert.label || cert.subject?.commonName || cert.id;

  return (
    <div
      className={`
        flex items-center gap-3 p-3 rounded-lg border transition-colors
        ${isActive ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-border/80'}
      `}
    >
      {/* Radio button */}
      <button
        type="button"
        onClick={() => !isActive && onSetActive(cert.id)}
        disabled={isActive || isSettingActive}
        className="shrink-0"
        title={isActive ? 'Active certificate' : 'Set as active'}
      >
        {isSettingActive ? (
          <Spinner size="sm" />
        ) : (
          <div
            className={`
              w-4 h-4 rounded-full border-2 flex items-center justify-center
              ${isActive ? 'border-primary' : 'border-muted-foreground/40 hover:border-muted-foreground'}
            `}
          >
            {isActive && <div className="w-2 h-2 rounded-full bg-primary" />}
          </div>
        )}
      </button>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{displayName}</span>
          <Badge variant={cert.source === 'uploaded' ? 'primary' : 'default'}>
            {cert.source === 'uploaded' ? 'Uploaded' : 'Generated'}
          </Badge>
          {isActive && <Badge variant="success">Active</Badge>}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
          {cert.subject && (
            <span>
              {cert.subject.organization} ({cert.subject.country})
            </span>
          )}
          {cert.expiry && (
            <span>Expires {new Date(cert.expiry).toLocaleDateString()}</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => onDownload(cert.id)}
          disabled={isDownloading}
          className="p-1.5 rounded-md transition-colors text-muted-foreground hover:text-primary hover:bg-primary/10"
          title="Download certificate"
        >
          {isDownloading ? <Spinner size="sm" /> : <Download className="h-4 w-4" />}
        </button>
        {canDelete && (
          <button
            type="button"
            onClick={() => onDelete(cert.id)}
            disabled={isActive || isDeleting}
            className={`
              p-1.5 rounded-md transition-colors
              ${isActive
                ? 'text-muted-foreground/30 cursor-not-allowed'
                : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
              }
            `}
            title={isActive ? 'Cannot delete the active certificate' : 'Delete certificate'}
          >
            {isDeleting ? <Spinner size="sm" /> : <Trash2 className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}
