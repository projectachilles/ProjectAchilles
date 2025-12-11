/**
 * Task Execution Dialog - Run commands or deploy payloads to sensors
 */

import { useState, useEffect } from 'react';
import { Play, Upload, CheckCircle2, XCircle } from 'lucide-react';
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
} from '../../shared/ui/Dialog';
import { Button } from '../../shared/ui/Button';
import { Input } from '../../shared/ui/Input';
import { Alert } from '../../shared/ui/Alert';
import { Spinner } from '../../shared/ui/Spinner';
import { Badge } from '../../shared/ui/Badge';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '../../shared/ui/Tabs';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../shared/ui/Table';
import { api } from '../../../services/api/endpoints';
import type { Payload, TaskResults } from '../../../types/endpoints';

interface TaskExecutionDialogProps {
  open: boolean;
  onClose: () => void;
  selectedSensors: string[];
  sensorNames?: Record<string, string>;
}

export default function TaskExecutionDialog({
  open,
  onClose,
  selectedSensors,
  sensorNames = {},
}: TaskExecutionDialogProps) {
  const [activeTab, setActiveTab] = useState('command');
  const [command, setCommand] = useState('');
  const [selectedPayload, setSelectedPayload] = useState('');
  const [payloadPath, setPayloadPath] = useState('c:\\F0\\');
  const [investigationId, setInvestigationId] = useState('');
  const [payloads, setPayloads] = useState<Payload[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingPayloads, setLoadingPayloads] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<TaskResults | null>(null);

  useEffect(() => {
    if (open && activeTab === 'payload') {
      loadPayloads();
    }
  }, [open, activeTab]);

  const loadPayloads = async () => {
    setLoadingPayloads(true);
    try {
      const response = await api.listPayloads();
      if (response.success && response.data) {
        setPayloads(response.data.payloads);
      }
    } catch (err: any) {
      setError('Failed to load payloads');
    } finally {
      setLoadingPayloads(false);
    }
  };

  const handleRunCommand = async () => {
    if (!command.trim()) {
      setError('Please enter a command');
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const taskId = investigationId || `cmd_${Date.now()}`;
      const taskResults: Record<string, { id?: string; error?: string }> = {};
      let successCount = 0;
      let failedCount = 0;

      for (const sensorId of selectedSensors) {
        try {
          const response = await api.runCommandOnSensor(sensorId, command, taskId);

          if (response.success && response.data) {
            taskResults[sensorId] = response.data;
            successCount++;
          } else {
            taskResults[sensorId] = { error: response.error || 'Failed to execute' };
            failedCount++;
          }
        } catch (err: any) {
          taskResults[sensorId] = { error: err.message || 'Failed to execute' };
          failedCount++;
        }
      }

      setResults({
        results: taskResults,
        summary: {
          total: selectedSensors.length,
          successful: successCount,
          failed: failedCount,
        },
      });
    } catch (err: any) {
      setError(err.message || 'Failed to execute command');
    } finally {
      setLoading(false);
    }
  };

  const handleDeployPayload = async () => {
    if (!selectedPayload || !payloadPath.trim()) {
      setError('Please select a payload and enter a destination path');
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const taskId = investigationId || `deploy_${Date.now()}`;
      const taskResults: Record<string, { id?: string; error?: string }> = {};
      let successCount = 0;
      let failedCount = 0;

      for (const sensorId of selectedSensors) {
        try {
          const response = await api.putFileOnSensor(
            sensorId,
            selectedPayload,
            payloadPath,
            taskId
          );

          if (response.success && response.data) {
            taskResults[sensorId] = response.data;
            successCount++;
          } else {
            taskResults[sensorId] = { error: response.error || 'Failed to deploy' };
            failedCount++;
          }
        } catch (err: any) {
          taskResults[sensorId] = { error: err.message || 'Failed to deploy' };
          failedCount++;
        }
      }

      setResults({
        results: taskResults,
        summary: {
          total: selectedSensors.length,
          successful: successCount,
          failed: failedCount,
        },
      });
    } catch (err: any) {
      setError(err.message || 'Failed to deploy payload');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setCommand('');
    setSelectedPayload('');
    setPayloadPath('');
    setInvestigationId('');
    setError(null);
    setResults(null);
    setActiveTab('command');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} className="max-w-2xl">
      <DialogHeader onClose={handleClose}>
        <DialogTitle>
          Execute Task on {selectedSensors.length} Sensor{selectedSensors.length !== 1 ? 's' : ''}
        </DialogTitle>
        <DialogDescription>
          Run a command or deploy a payload to the selected sensors
        </DialogDescription>
      </DialogHeader>

      <DialogContent>
        <Tabs defaultValue="command" onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="command">
              <Play className="w-4 h-4 mr-2" />
              Run Command
            </TabsTrigger>
            <TabsTrigger value="payload">
              <Upload className="w-4 h-4 mr-2" />
              Deploy Payload
            </TabsTrigger>
          </TabsList>

          {error && (
            <Alert variant="destructive" className="mt-4" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {results && (
            <Alert variant="success" className="mt-4">
              Successfully executed on {results.summary.successful} of {results.summary.total} sensors
              {results.summary.failed > 0 && ` (${results.summary.failed} failed)`}
            </Alert>
          )}

          <TabsContent value="command">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Command</label>
                <textarea
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-24 font-mono text-sm"
                  placeholder="e.g., whoami, ps, dir"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  disabled={loading}
                />
              </div>

              <Input
                label="Investigation ID (optional)"
                placeholder="Auto-generated if not provided"
                value={investigationId}
                onChange={(e) => setInvestigationId(e.target.value)}
                disabled={loading}
              />

              <p className="text-xs text-muted-foreground">
                Command will be executed on all selected sensors
              </p>
            </div>
          </TabsContent>

          <TabsContent value="payload">
            {loadingPayloads ? (
              <div className="flex justify-center py-8">
                <Spinner size="lg" />
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">Select Payload</label>
                  <select
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    value={selectedPayload}
                    onChange={(e) => {
                      const payloadName = e.target.value;
                      setSelectedPayload(payloadName);
                      // Auto-populate destination path with default base path + payload name
                      if (payloadName) {
                        setPayloadPath(`c:\\F0\\${payloadName}`);
                        // Auto-populate investigation ID with payload name without extension
                        const nameWithoutExt = payloadName.replace(/\.[^/.]+$/, '');
                        setInvestigationId(nameWithoutExt);
                      } else {
                        setPayloadPath('c:\\F0\\');
                        setInvestigationId('');
                      }
                    }}
                    disabled={loading}
                  >
                    <option value="">Choose a payload...</option>
                    {payloads.map((payload) => (
                      <option key={payload.name} value={payload.name}>
                        {payload.name}
                      </option>
                    ))}
                  </select>
                </div>

                <Input
                  label="Destination Path"
                  placeholder="e.g., C:\temp\payload.exe or /tmp/payload.sh"
                  value={payloadPath}
                  onChange={(e) => setPayloadPath(e.target.value)}
                  disabled={loading}
                />

                <Input
                  label="Investigation ID (optional)"
                  placeholder="Auto-generated if not provided"
                  value={investigationId}
                  onChange={(e) => setInvestigationId(e.target.value)}
                  disabled={loading}
                />

                <p className="text-xs text-muted-foreground">
                  Payload will be deployed to all selected sensors
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Results Table */}
        {results && results.results && Object.keys(results.results).length > 0 && (
          <div className="mt-6">
            <h4 className="text-sm font-semibold mb-3">Execution Results</h4>
            <div className="border border-border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sensor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Task ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(results.results).map(([sensorId, result]) => (
                    <TableRow key={sensorId}>
                      <TableCell>
                        <span className="font-mono text-xs">
                          {sensorNames[sensorId] || sensorId}
                        </span>
                      </TableCell>
                      <TableCell>
                        {result.error ? (
                          <Badge variant="destructive" className="gap-1">
                            <XCircle className="w-3 h-3" />
                            Failed
                          </Badge>
                        ) : (
                          <Badge variant="success" className="gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            Success
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">
                          {result.id || result.error || 'N/A'}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </DialogContent>

      <DialogFooter>
        <Button variant="ghost" onClick={handleClose} disabled={loading}>
          {results ? 'Close' : 'Cancel'}
        </Button>
        {!results && (
          <Button
            onClick={activeTab === 'command' ? handleRunCommand : handleDeployPayload}
            disabled={
              loading ||
              (activeTab === 'command' && !command) ||
              (activeTab === 'payload' && (!selectedPayload || !payloadPath))
            }
          >
            {loading ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Executing...
              </>
            ) : activeTab === 'command' ? (
              <>
                <Play className="w-4 h-4 mr-2" />
                Run Command
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Deploy Payload
              </>
            )}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
