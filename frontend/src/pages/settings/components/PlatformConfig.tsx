import { useState, useEffect, useCallback } from 'react';
import { testsApi, type PlatformSettings } from '@/services/api/tests';
import { Select } from '@/components/shared/ui/Select';
import { Spinner } from '@/components/shared/ui/Spinner';
import { Alert } from '@/components/shared/ui/Alert';

const OS_OPTIONS = [
  { value: 'windows', label: 'Windows' },
  { value: 'linux', label: 'Linux' },
  { value: 'darwin', label: 'macOS' },
];

const ALL_ARCH_OPTIONS = [
  { value: 'amd64', label: 'x86_64 (amd64)' },
  { value: '386', label: 'x86 (386)' },
  { value: 'arm64', label: 'ARM64' },
];

function getArchOptions(os: string) {
  if (os === 'darwin') {
    return ALL_ARCH_OPTIONS.filter((a) => a.value !== '386');
  }
  return ALL_ARCH_OPTIONS;
}

export function PlatformConfig() {
  const [platform, setPlatform] = useState<PlatformSettings>({ os: 'windows', arch: 'amd64' });
  const [loading, setLoading] = useState(true);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    testsApi.getPlatform()
      .then((data) => setPlatform(data))
      .catch(() => {/* use defaults */})
      .finally(() => setLoading(false));
  }, []);

  const save = useCallback(async (updated: PlatformSettings) => {
    setError(null);
    setSaveMessage(null);
    try {
      await testsApi.savePlatform(updated);
      setSaveMessage('Saved');
      setTimeout(() => setSaveMessage(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  }, []);

  const handleOsChange = useCallback((newOs: string) => {
    const os = newOs as PlatformSettings['os'];
    // If current arch is invalid for new OS, reset to amd64
    let arch = platform.arch;
    if (os === 'darwin' && arch === '386') {
      arch = 'amd64';
    }
    const updated = { os, arch };
    setPlatform(updated);
    save(updated);
  }, [platform.arch, save]);

  const handleArchChange = useCallback((newArch: string) => {
    const updated = { ...platform, arch: newArch as PlatformSettings['arch'] };
    setPlatform(updated);
    save(updated);
  }, [platform, save]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Select
          label="Operating System"
          options={OS_OPTIONS}
          value={platform.os}
          onChange={(e) => handleOsChange(e.target.value)}
        />
        <Select
          label="Architecture"
          options={getArchOptions(platform.os)}
          value={platform.arch}
          onChange={(e) => handleArchChange(e.target.value)}
        />
      </div>

      {saveMessage && (
        <p className="text-sm text-green-500">{saveMessage}</p>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
    </div>
  );
}
