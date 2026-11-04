import { isAxiosError } from 'axios';
import { apiClient } from '@/hooks/useAuthenticatedApi';
import type { BuildInfo, EmbedDependency } from '@/types/test';

export interface PlatformSettings {
  os: 'windows' | 'linux' | 'darwin';
  arch: 'amd64' | '386' | 'arm64';
}

export interface CertificateSubject {
  commonName: string;
  organization: string;
  country: string;
}

export interface CertificateInfo {
  id: string;
  exists: boolean;
  label?: string;
  source: 'generated' | 'uploaded';
  subject?: CertificateSubject;
  expiry?: string;
  fingerprint?: string;
  createdAt?: string;
}

export interface CertificateListResponse {
  certificates: CertificateInfo[];
  activeCertId: string | null;
}

export const BUILD_POLL_INTERVAL_MS = 2000;
export const BUILD_INTERRUPTED_MESSAGE = 'Build was interrupted because the server restarted. Try again.';

// Poll failures worth retrying: rate limiting (the per-user API limit is
// shared with the rest of the dashboard), a restarting backend, or no response.
const TRANSIENT_POLL_STATUSES = new Set([429, 502, 503, 504]);
const MAX_CONSECUTIVE_POLL_FAILURES = 5;
// Each failed poll doubles the wait, up to 16x the interval. With the 2 s
// default, five server failures in a row span about a minute: long enough
// for a backend restart to finish and report the interrupted build.
const MAX_BACKOFF_STEPS = 4;

function isTransientPollError(err: unknown): boolean {
  if (!isAxiosError(err)) return false;
  return !err.response || TRANSIENT_POLL_STATUSES.has(err.response.status);
}

function isRateLimited(err: unknown): boolean {
  return isAxiosError(err) && err.response?.status === 429;
}

// A failed build *start* request is only worth retrying when the backend was
// momentarily unreachable — a network error, or the edge's 502/504 while the
// single instance restarts. A 503 is deliberate ("Go compilation not available
// on serverless — use Upload Binary") and a 429 is rate-limiting; propagate
// those immediately rather than masking them behind retries.
function isBackendUnreachable(err: unknown): boolean {
  if (!isAxiosError(err)) return false;
  return !err.response || err.response.status === 502 || err.response.status === 504;
}

function abortError(): DOMException {
  return new DOMException('Build polling aborted', 'AbortError');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export const testsApi = {
  async getPlatform(): Promise<PlatformSettings> {
    const response = await apiClient.get('/tests/platform');
    return response.data.data;
  },

  async savePlatform(settings: PlatformSettings): Promise<{ success: boolean }> {
    const response = await apiClient.post('/tests/platform', settings);
    return response.data;
  },

  async getCertificate(): Promise<CertificateInfo> {
    const response = await apiClient.get('/tests/certificate');
    return response.data.data;
  },

  async generateCertificate(subject: CertificateSubject): Promise<CertificateInfo> {
    const response = await apiClient.post('/tests/certificate', subject);
    return response.data.data;
  },

  async deleteCertificate(): Promise<{ success: boolean }> {
    const response = await apiClient.delete('/tests/certificate');
    return response.data;
  },

  // ── Multi-Certificate API ──────────────────────────────────

  async listCertificates(): Promise<CertificateListResponse> {
    const response = await apiClient.get('/tests/certificates');
    return response.data.data;
  },

  async uploadCertificate(file: File, password: string, label?: string): Promise<CertificateInfo> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('password', password);
    if (label) formData.append('label', label);
    const response = await apiClient.post('/tests/certificates/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data.data;
  },

  async generateCertificateWithLabel(
    subject: CertificateSubject,
    label?: string,
    password?: string,
  ): Promise<CertificateInfo> {
    const response = await apiClient.post('/tests/certificates/generate', {
      ...subject,
      label,
      password,
    });
    return response.data.data;
  },

  async setActiveCertificate(id: string): Promise<{ success: boolean }> {
    const response = await apiClient.put(`/tests/certificates/${id}/active`);
    return response.data;
  },

  async updateCertificateLabel(id: string, label: string): Promise<CertificateInfo> {
    const response = await apiClient.patch(`/tests/certificates/${id}`, { label });
    return response.data.data;
  },

  async deleteCertificateById(id: string): Promise<{ success: boolean }> {
    const response = await apiClient.delete(`/tests/certificates/${id}`);
    return response.data;
  },

  async downloadCertificate(id: string): Promise<void> {
    const response = await apiClient.get(`/tests/certificates/${id}/download`, {
      responseType: 'blob',
    });
    const blob = new Blob([response.data]);
    const contentDisposition = response.headers['content-disposition'] as string | undefined;
    let filename = `${id}.pfx`;
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^";\s]+)"?/);
      if (match) filename = match[1];
    }
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },

  // ── Build API ────────────────────────────────────────────

  async getBuildInfo(uuid: string): Promise<BuildInfo> {
    const response = await apiClient.get(`/tests/builds/${uuid}`);
    return response.data.data;
  },

  /**
   * Build & sign a test. The build runs in the background on the server
   * (a cold Go build outlasts proxy timeouts), so this starts it with
   * ?async=true and polls until it finishes.
   */
  async buildTest(uuid: string, opts: { signal?: AbortSignal } = {}): Promise<BuildInfo> {
    // The single backend instance can be briefly unavailable while it restarts
    // (a load spike recycles it). A transient failure on the *start* request
    // shouldn't surface as a build failure — retry a few times with backoff,
    // then hand off to waitForBuild, which has its own long-poll backoff.
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await apiClient.post(`/tests/builds/${uuid}`, null, {
          params: { async: 'true' },
          signal: opts.signal,
        });
        // A backend without background builds ignores ?async and answers 200
        // with the finished BuildInfo.
        if (response.status !== 202) return response.data.data;
        break;
      } catch (err) {
        if (opts.signal?.aborted || !isBackendUnreachable(err) || attempt >= MAX_CONSECUTIVE_POLL_FAILURES) throw err;
        await sleep(BUILD_POLL_INTERVAL_MS * 2 ** Math.min(attempt, MAX_BACKOFF_STEPS), opts.signal);
      }
    }
    return testsApi.waitForBuild(uuid, opts);
  },

  /**
   * Poll GET /tests/builds/:uuid until the test's build job finishes.
   * Resolves with BuildInfo on success. Rejects with the build's error on
   * failure, BUILD_INTERRUPTED_MESSAGE if the server lost the job (restart),
   * or an AbortError when `signal` aborts.
   */
  async waitForBuild(
    uuid: string,
    opts: { intervalMs?: number; signal?: AbortSignal } = {},
  ): Promise<BuildInfo> {
    const intervalMs = opts.intervalMs ?? BUILD_POLL_INTERVAL_MS;
    let delay = intervalMs;
    let streak = 0;   // consecutive failed polls of any transient kind (sets the backoff)
    let failures = 0; // consecutive server/network failures (decides when to give up)
    for (;;) {
      await sleep(delay, opts.signal);
      let info: BuildInfo;
      try {
        info = await testsApi.getBuildInfo(uuid);
      } catch (err) {
        if (!isTransientPollError(err)) throw err;
        // A 429 means "slow down", not "the build failed": the build keeps
        // running on the server, so keep waiting however long the limit lasts.
        if (!isRateLimited(err)) {
          failures += 1;
          if (failures >= MAX_CONSECUTIVE_POLL_FAILURES) throw err;
        }
        streak += 1;
        delay = intervalMs * 2 ** Math.min(streak, MAX_BACKOFF_STEPS);
        continue;
      }
      streak = 0;
      failures = 0;
      delay = intervalMs;
      if (opts.signal?.aborted) throw abortError();
      if (!info.job) throw new Error(BUILD_INTERRUPTED_MESSAGE);
      if (info.job.status === 'succeeded') return info;
      if (info.job.status === 'failed') throw new Error(info.job.error || 'Build failed');
    }
  },

  async deleteBuild(uuid: string): Promise<{ success: boolean }> {
    const response = await apiClient.delete(`/tests/builds/${uuid}`);
    return response.data;
  },

  async downloadBuild(uuid: string): Promise<void> {
    const response = await apiClient.get(`/tests/builds/${uuid}/download`, {
      responseType: 'blob',
    });
    const blob = new Blob([response.data]);
    const contentDisposition = response.headers['content-disposition'] as string | undefined;
    let filename = uuid;
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^";\s]+)"?/);
      if (match) filename = match[1];
    }
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },

  async getEmbedDependencies(uuid: string): Promise<EmbedDependency[]> {
    const response = await apiClient.get(`/tests/builds/${uuid}/dependencies`);
    return response.data.data;
  },

  async uploadEmbedFile(uuid: string, filename: string, file: File): Promise<{ success: boolean }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('filename', filename);
    const response = await apiClient.post(`/tests/builds/${uuid}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async uploadBinary(uuid: string, file: File): Promise<BuildInfo> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post(`/tests/builds/${uuid}/upload-binary`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data.data;
  },

  // ── Client-side Blob Upload (Vercel) ────────────────────

  async getUploadToken(uuid: string, filename: string): Promise<{ token: string; pathname: string }> {
    const response = await apiClient.post(`/tests/builds/${uuid}/upload-token`, { filename });
    return response.data.data;
  },

  async completeUpload(uuid: string, filename: string): Promise<BuildInfo> {
    const response = await apiClient.post(`/tests/builds/${uuid}/upload-complete`, { filename });
    return response.data.data;
  },
};
