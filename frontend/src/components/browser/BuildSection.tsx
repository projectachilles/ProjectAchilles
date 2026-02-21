import { useState, useEffect, useRef, useCallback } from 'react';
import { put } from '@vercel/blob/client';
import { testsApi } from '@/services/api/tests';
import { useCapabilities } from '@/hooks/useCapabilities';
import type { BuildInfo, EmbedDependency } from '@/types/test';
import { Badge } from '@/components/shared/ui/Badge';
import { Button } from '@/components/shared/ui/Button';
import { Hammer, Loader2, Download, RotateCw, Trash2, Upload, Check, X, Wrench } from 'lucide-react';

interface BuildSectionProps {
  uuid: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function BuildSection({ uuid }: BuildSectionProps) {
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  const [deps, setDeps] = useState<EmbedDependency[]>([]);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const binaryInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadFilename = useRef<string | null>(null);

  const capabilities = useCapabilities();

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const promises: [Promise<BuildInfo>, Promise<EmbedDependency[]>] = [
        testsApi.getBuildInfo(uuid),
        // Only fetch deps if build system is available (needs Go source analysis)
        capabilities.build
          ? testsApi.getEmbedDependencies(uuid)
          : Promise.resolve([]),
      ];
      const [info, embedDeps] = await Promise.all(promises);
      setBuildInfo(info);
      setDeps(embedDeps);
    } catch {
      // Non-critical — just show empty state
    } finally {
      setLoading(false);
    }
  }, [uuid, capabilities.build]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleBuild() {
    setBuilding(true);
    setError(null);
    try {
      const info = await testsApi.buildTest(uuid);
      setBuildInfo(info);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Build failed';
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr?.response?.data?.error || msg);
    } finally {
      setBuilding(false);
    }
  }

  async function handleDelete() {
    try {
      await testsApi.deleteBuild(uuid);
      setBuildInfo({ exists: false });
    } catch {
      // ignore
    }
  }

  async function handleDownload() {
    try {
      await testsApi.downloadBuild(uuid);
    } catch {
      // ignore
    }
  }

  function handleUploadClick(filename: string) {
    pendingUploadFilename.current = filename;
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const filename = pendingUploadFilename.current;
    if (!file || !filename) return;

    setUploadingFile(filename);
    try {
      await testsApi.uploadEmbedFile(uuid, filename, file);
      const embedDeps = await testsApi.getEmbedDependencies(uuid);
      setDeps(embedDeps);
    } catch {
      // ignore
    } finally {
      setUploadingFile(null);
      pendingUploadFilename.current = null;
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleUploadBinaryClick() {
    binaryInputRef.current?.click();
  }

  async function handleBinarySelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      // Client-side MZ header validation (instant feedback, no network round-trip)
      const header = new Uint8Array(await file.slice(0, 2).arrayBuffer());
      if (header[0] !== 0x4D || header[1] !== 0x5A) {
        throw new Error('File does not appear to be a valid Windows executable (missing MZ header)');
      }

      if (capabilities.platform === 'vercel') {
        // Client-side Blob upload — bypasses 4.5 MB serverless function body limit
        const filename = `${uuid}.exe`;
        const { token, pathname } = await testsApi.getUploadToken(uuid, filename);
        await put(pathname, file, {
          access: 'public',
          token,
          multipart: true,
        });
        const info = await testsApi.completeUpload(uuid, filename);
        setBuildInfo(info);
      } else {
        // Server-side upload (Docker/Railway/Render — no body size limit)
        const info = await testsApi.uploadBinary(uuid, file);
        setBuildInfo(info);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr?.response?.data?.error || msg);
    } finally {
      setUploading(false);
      if (binaryInputRef.current) binaryInputRef.current.value = '';
    }
  }

  const missingExternalDeps = deps.filter(d => !d.exists && !d.sourceBuilt);
  const hasMissingDeps = missingExternalDeps.length > 0;
  const canBuild = capabilities.build;
  const canUpload = capabilities.buildUpload;

  if (loading) {
    return (
      <div>
        <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-2">
          <Hammer className="w-3 h-3" />
          Build
        </h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-2">
        <Hammer className="w-3 h-3" />
        Build
      </h3>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileSelected}
      />
      <input
        ref={binaryInputRef}
        type="file"
        accept=".exe"
        className="hidden"
        onChange={handleBinarySelected}
      />

      {/* Embed dependencies (only shown when build system is available) */}
      {deps.length > 0 && (
        <div className="mb-2 space-y-1">
          {deps.map(dep => (
            <div key={dep.filename} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-mono truncate">
                {dep.exists ? (
                  <Check className="w-3 h-3 text-green-500 flex-shrink-0" />
                ) : dep.sourceBuilt ? (
                  <Wrench className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                ) : (
                  <X className="w-3 h-3 text-red-500 flex-shrink-0" />
                )}
                {dep.filename}
                {!dep.exists && dep.sourceBuilt && (
                  <span className="text-muted-foreground ml-1">Auto-built</span>
                )}
              </span>
              {!dep.exists && !dep.sourceBuilt && (
                <button
                  onClick={() => handleUploadClick(dep.filename)}
                  disabled={uploadingFile === dep.filename}
                  className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 disabled:opacity-50 ml-2 flex-shrink-0"
                >
                  {uploadingFile === dep.filename ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Upload className="w-3 h-3" />
                  )}
                  Upload
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Building/Uploading state */}
      {(building || uploading) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          {building ? 'Building...' : 'Uploading...'}
        </div>
      )}

      {/* Error state */}
      {error && !building && !uploading && (
        <div className="space-y-2">
          <p className="text-xs text-red-500 line-clamp-3">{error}</p>
          {canBuild && (
            <Button variant="outline" size="sm" onClick={handleBuild} className="w-full">
              Retry Build
            </Button>
          )}
          {canUpload && (
            <Button variant="outline" size="sm" onClick={handleUploadBinaryClick} className="w-full">
              <Upload className="w-3 h-3" />
              Upload Binary
            </Button>
          )}
        </div>
      )}

      {/* No build exists — show action buttons */}
      {!building && !uploading && !error && (!buildInfo || !buildInfo.exists) && (
        <div className="space-y-1.5">
          {canBuild && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleBuild}
              disabled={hasMissingDeps}
              className="w-full"
            >
              Build & Sign
            </Button>
          )}
          {canUpload && (
            <Button
              variant={canBuild ? 'outline' : 'primary'}
              size="sm"
              onClick={handleUploadBinaryClick}
              className="w-full"
            >
              <Upload className="w-3 h-3" />
              Upload Binary
            </Button>
          )}
        </div>
      )}

      {/* Build exists */}
      {!building && !uploading && !error && buildInfo?.exists && (
        <div className="space-y-2">
          {/* Filename — clickable for download */}
          <button
            onClick={handleDownload}
            className="w-full text-left text-sm font-mono px-3 py-2 rounded-md hover:bg-accent transition-colors truncate"
          >
            {buildInfo.filename}
          </button>

          {/* Badges */}
          <div className="flex flex-wrap gap-1">
            {buildInfo.platform && (
              <Badge variant="default">
                {buildInfo.platform.os}/{buildInfo.platform.arch}
              </Badge>
            )}
            {buildInfo.signed ? (
              <Badge variant="success">Signed</Badge>
            ) : (
              <Badge variant="warning">Unsigned</Badge>
            )}
            {buildInfo.source === 'uploaded' && (
              <Badge variant="default">Uploaded</Badge>
            )}
          </div>

          {/* Size & date */}
          <p className="text-xs text-muted-foreground">
            {buildInfo.fileSize != null && formatBytes(buildInfo.fileSize)}
            {buildInfo.builtAt && ` · ${formatDate(buildInfo.builtAt)}`}
          </p>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={handleDownload} className="flex-1">
              <Download className="w-3 h-3" />
              Download
            </Button>
            {canBuild && (
              <Button variant="ghost" size="icon" onClick={handleBuild} title="Rebuild" className="h-8 w-8">
                <RotateCw className="w-3 h-3" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={handleDelete} title="Delete build" className="h-8 w-8">
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
