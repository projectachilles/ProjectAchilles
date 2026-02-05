/**
 * Payloads Page - Manage payload files for deployment to sensors
 * ACHILLES - Endpoint Management
 */

import { useEffect, useState } from 'react';
import { Upload, Trash2, RefreshCw, FileCode2, Download } from 'lucide-react';
import { api } from '../../services/api/endpoints';
import type { Payload } from '../../types/endpoints';
import SharedLayout from '../../components/shared/Layout';
import { PageContainer, PageHeader } from '../../components/endpoints/Layout';
import { Button } from '../../components/shared/ui/Button';
import { Alert, Toast } from '../../components/shared/ui/Alert';
import { Loading, Spinner } from '../../components/shared/ui/Spinner';
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
} from '../../components/shared/ui/Dialog';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/shared/ui/Table';

export default function PayloadsPage() {
  const [payloads, setPayloads] = useState<Payload[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    loadPayloads();
  }, []);

  const loadPayloads = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.listPayloads();
      if (response.success && response.data) {
        // Sort payloads by uploadedAt date, most recent first
        const sortedPayloads = [...response.data.payloads].sort((a, b) => {
          const dateA = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
          const dateB = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
          return dateB - dateA;
        });
        setPayloads(sortedPayloads);
      } else {
        setError(response.error || 'Failed to load payloads');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load payloads');
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Please select a file to upload');
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const response = await api.uploadPayload(selectedFile);
      if (response.success) {
        setSuccessMessage(`Payload "${selectedFile.name}" uploaded successfully`);
        setUploadDialogOpen(false);
        setSelectedFile(null);
        await loadPayloads();
        setTimeout(() => setSuccessMessage(null), 4000);
      } else {
        setError(response.error || 'Failed to upload payload');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to upload payload');
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (name: string) => {
    setDownloading(name);
    setError(null);
    try {
      // Use the backend's download endpoint which proxies the file
      // and sets the correct Content-Disposition header with the filename
      const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
      const downloadUrl = `${apiBaseUrl}/api/endpoints/payloads/${encodeURIComponent(name)}/download`;

      // Create a temporary link and trigger download
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setSuccessMessage(`Download started for "${name}"`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to download payload');
    } finally {
      setDownloading(null);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Are you sure you want to delete payload "${name}"?`)) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await api.deletePayload(name);
      if (response.success) {
        setSuccessMessage(`Payload "${name}" deleted successfully`);
        await loadPayloads();
        setTimeout(() => setSuccessMessage(null), 4000);
      } else {
        setError(response.error || 'Failed to delete payload');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete payload');
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return 'Unknown';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString?: string): string => {
    if (!dateString) return 'Unknown';
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return dateString;
    }
  };

  return (
    <SharedLayout>
      <PageContainer>
        <PageHeader
          title="Payload Management"
          description="Upload and manage payload files for deployment to sensors"
          actions={
            <div className="flex gap-2">
              <Button variant="outline" onClick={loadPayloads} disabled={loading}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
              <Button onClick={() => setUploadDialogOpen(true)}>
                <Upload className="w-4 h-4 mr-2" />
                Upload Payload
              </Button>
            </div>
          }
        />

        {error && (
          <Alert variant="destructive" className="mb-4" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Loading message="Loading payloads..." />
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Uploaded By</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payloads.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-12">
                      <div className="flex flex-col items-center gap-3">
                        <FileCode2 className="w-12 h-12 text-muted-foreground" />
                        <p className="text-muted-foreground">
                          No payloads found. Upload a payload to get started.
                        </p>
                        <Button onClick={() => setUploadDialogOpen(true)}>
                          <Upload className="w-4 h-4 mr-2" />
                          Upload Payload
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  payloads.map((payload) => (
                    <TableRow key={payload.name}>
                      <TableCell>
                        <span className="font-mono text-sm">{payload.name}</span>
                      </TableCell>
                      <TableCell>{formatFileSize(payload.size)}</TableCell>
                      <TableCell>
                        <span className="text-muted-foreground">
                          {payload.uploadedBy || 'Unknown'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground text-sm">
                          {formatDate(payload.uploadedAt)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-primary hover:text-primary hover:bg-primary/10"
                            onClick={() => handleDownload(payload.name)}
                            disabled={downloading === payload.name}
                            title="Download payload"
                          >
                            {downloading === payload.name ? (
                              <Spinner size="sm" />
                            ) : (
                              <Download className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleDelete(payload.name)}
                            title="Delete payload"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Upload Dialog */}
        <Dialog
          open={uploadDialogOpen}
          onClose={() => !uploading && setUploadDialogOpen(false)}
        >
          <DialogHeader onClose={() => !uploading && setUploadDialogOpen(false)}>
            <DialogTitle>Upload Payload</DialogTitle>
            <DialogDescription>
              Select a file to upload as a payload for deployment to sensors
            </DialogDescription>
          </DialogHeader>
          <DialogContent>
            <div className="space-y-4">
              <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                <input
                  type="file"
                  id="file-upload"
                  className="hidden"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                />
                <label
                  htmlFor="file-upload"
                  className="cursor-pointer flex flex-col items-center gap-2"
                >
                  <Upload className="w-10 h-10 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Click to select a file or drag and drop
                  </span>
                </label>
              </div>
              {selectedFile && (
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-sm">
                    <span className="font-medium">Selected:</span>{' '}
                    <span className="font-mono">{selectedFile.name}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Size: {formatFileSize(selectedFile.size)}
                  </p>
                </div>
              )}
            </div>
          </DialogContent>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setUploadDialogOpen(false)}
              disabled={uploading}
            >
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={!selectedFile || uploading}>
              {uploading ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload
                </>
              )}
            </Button>
          </DialogFooter>
        </Dialog>

        {/* Success Toast */}
        {successMessage && (
          <div className="fixed bottom-4 right-4 z-50">
            <Toast
              variant="success"
              message={successMessage}
              onClose={() => setSuccessMessage(null)}
            />
          </div>
        )}
      </PageContainer>
    </SharedLayout>
  );
}
