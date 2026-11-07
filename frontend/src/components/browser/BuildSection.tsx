import { useState, useEffect, useRef, useCallback } from 'react';
import { put } from '@vercel/blob/client';
import { testsApi } from '@/services/api/tests';
import { useCapabilities } from '@/hooks/useCapabilities';
import type { EmbedDependency } from '@/types/test';
import { useBuildInfo, type BuildInfoState } from '@/components/browser/detail/useBuildInfo';
import { embedDisplayName } from '@/components/browser/detail/testTabs';
import { Badge } from '@/components/shared/ui/Badge';
import { Button } from '@/components/shared/ui/Button';
import { Loader2, Download, RotateCw, Trash2, Upload, Check, X, Wrench } from 'lucide-react';

interface BuildSectionProps {
  uuid: string;
  /** Build state owned by the page; omit to let the section fetch its own. */
  build?: BuildInfoState;
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

export default function BuildSection({ uuid, build }: BuildSectionProps) {
  // Hooks stay unconditional: the own instance is inert when state is shared.
  const own = useBuildInfo(build ? null : uuid);
  const { buildInfo, setBuildInfo, loading: infoLoading, download: handleDownload } = build ?? own;
  const [deps, setDeps] = useState<EmbedDependency[]>([]);
  const [depsLoadedFor, setDepsLoadedFor] = useState<string | null>(null);
  const loading = infoLoading || depsLoadedFor !== uuid;
  const [building, setBuilding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const binaryInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadFilename = useRef<string | null>(null);
  // The build this section is following (started here, or resumed after a
  // page refresh). Aborted when the test changes or the section unmounts.
  const followRef = useRef<AbortController | null>(null);

  const capabilities = useCapabilities();

  const followBuild = useCallback(async (start: boolean) => {
    followRef.current?.abort();
    const controller = new AbortController();
    followRef.current = controller;
    setBuilding(true);
    setError(null);
    try {
      const info = start
        ? await testsApi.buildTest(uuid, { signal: controller.signal })
        : await testsApi.waitForBuild(uuid, { signal: controller.signal });
      setBuildInfo(info);
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : 'Build failed';
      const data = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
      // Prefer the server's `message` ("Cannot POST /api/…") over the bland
      // `error` ("Not Found") so a routing/404 failure names the failing route.
      setError(data?.message || data?.error || msg);
    } finally {
      // Only the build still being followed may clear the spinner.
      if (followRef.current === controller) {
        followRef.current = null;
        setBuilding(false);
      }
    }
  }, [uuid]);

  // Stop following (and drop the old test's error) when the test changes or
  // the section unmounts.
  useEffect(() => () => {
    followRef.current?.abort();
    followRef.current = null;
    setBuilding(false);
    setError(null);
  }, [uuid]);

  // Once the build info for this test has loaded, load its embed
  // dependencies and resume / explain the last build attempt.
  useEffect(() => {
    if (infoLoading) return;
    let stale = false;
    (async () => {
      try {
        // Only fetch deps if build system is available (needs Go source analysis)
        const embedDeps = capabilities.build ? await testsApi.getEmbedDependencies(uuid) : [];
        if (stale) return;
        setDeps(embedDeps);
        // The build survives page refreshes on the server: pick it back up, or
        // show why the last attempt failed.
        if (buildInfo?.job?.status === 'running') {
          void followBuild(false);
        } else if (buildInfo?.job?.status === 'failed' && !buildInfo.exists) {
          setError(buildInfo.job.error || 'Build failed');
        }
      } catch {
        // Non-critical — just show empty state
      } finally {
        if (!stale) setDepsLoadedFor(uuid);
      }
    })();
    return () => { stale = true; };
    // buildInfo intentionally omitted: react only to the load finishing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid, infoLoading, capabilities.build, followBuild]);

  async function handleBuild() {
    await followBuild(true);
  }

  async function handleDelete() {
    try {
      await testsApi.deleteBuild(uuid);
      setBuildInfo({ exists: false });
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
      const data = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
      setError(data?.message || data?.error || msg);
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
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading...
      </div>
    );
  }

  return (
    <div>
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
              <span className="flex items-center gap-1.5 font-mono truncate" title={dep.filename}>
                {dep.exists ? (
                  <Check className="w-3 h-3 text-green-500 flex-shrink-0" />
                ) : dep.sourceBuilt ? (
                  <Wrench className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                ) : (
                  <X className="w-3 h-3 text-red-500 flex-shrink-0" />
                )}
                {embedDisplayName(dep.filename, uuid)}
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
          {buildInfo?.detectedPlatform && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
              <span>Target:</span>
              <Badge variant="default">
                {buildInfo.detectedPlatform.os}/{buildInfo.detectedPlatform.arch}
              </Badge>
            </div>
          )}
          <pre className="text-xs text-red-500 font-mono whitespace-pre-wrap break-words max-h-48 overflow-auto rounded-md bg-red-500/5 p-2 leading-relaxed">{error}</pre>
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
          {buildInfo?.detectedPlatform && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
              <span>Target:</span>
              <Badge variant="default">
                {buildInfo.detectedPlatform.os}/{buildInfo.detectedPlatform.arch}
              </Badge>
            </div>
          )}
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
            className="w-full text-left text-sm font-mono px-3 py-2 rounded-md hover:bg-raised transition-colors truncate"
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
