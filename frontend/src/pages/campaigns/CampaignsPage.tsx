import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, Play, ChevronDown, ChevronRight } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/endpoints/Layout';
import { TasksSectionTabs } from '@/components/endpoints/tasks/TasksSectionTabs';
import { Button } from '@/components/shared/ui/Button';
import { Badge } from '@/components/shared/ui/Badge';
import { Alert } from '@/components/shared/ui/Alert';
import { Spinner } from '@/components/shared/ui/Spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/shared/ui/Tabs';
import { useHasPermission } from '@/hooks/useAppRole';
import { campaignsApi, type AllRunsItem, type CampaignListItem, type PageParams } from '@/services/api/campaigns';
import { CampaignEditorDialog } from './CampaignEditorDialog';
import { RunCampaignDialog } from './RunCampaignDialog';
import { RunHistoryList } from './RunHistoryList';

/** One campaign's run history, newest first. */
function CampaignRuns({ campaign }: { campaign: CampaignListItem }) {
  const load = useCallback((page: PageParams) => campaignsApi.listRuns(campaign.id, page), [campaign.id]);
  return <RunHistoryList label={`Runs of ${campaign.name}`} load={load} />;
}

const loadAllRuns = (page: PageParams) => campaignsApi.listAllRuns(page);

function allRunsLead(r: AllRunsItem) {
  return (
    <span className="flex items-center gap-2">
      <span className="font-medium">{r.campaign_name}</span>
      {r.campaign_deleted && <Badge variant="warning">deleted campaign</Badge>}
    </span>
  );
}

export default function CampaignsPage() {
  const canWrite = useHasPermission('endpoints:tasks:create');
  const [campaigns, setCampaigns] = useState<CampaignListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CampaignListItem | null>(null);
  const [running, setRunning] = useState<CampaignListItem | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleRuns(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const load = useCallback(async () => {
    try {
      setCampaigns(await campaignsApi.list());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaigns');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete(c: CampaignListItem) {
    if (!window.confirm(`Delete campaign "${c.name}"? Past runs are kept under All runs.`)) return;
    try {
      await campaignsApi.remove(c.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete campaign');
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Tasks"
        titleAside={<TasksSectionTabs />}
        description="Saved test plans: run a set of tests against a set of hosts and collect the evidence"
        actions={canWrite ? (
          <Button onClick={() => { setEditing(null); setEditorOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" />
            New campaign
          </Button>
        ) : undefined}
      />

      {error && <Alert variant="destructive" className="mb-4">{error}</Alert>}

      <Tabs defaultValue="campaigns">
        <TabsList>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="runs">All runs</TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns">
          {campaigns === null && !error && (
            <div className="flex justify-center py-12"><Spinner /></div>
          )}

          {campaigns && campaigns.length === 0 && (
            <p className="py-12 text-center text-sm text-muted">No campaigns yet.</p>
          )}

          {campaigns && campaigns.length > 0 && (
            <ul className="divide-y divide-border rounded-[10px] border border-border bg-surface">
              {campaigns.map((c) => {
                const open = expanded.has(c.id);
                return (
                  <li key={c.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{c.name}</span>
                          {c.framework_label && <Badge variant="outline">{c.framework_label}</Badge>}
                        </div>
                        <div className="mt-1 text-sm text-muted">
                          {`${c.test_uuids.length} ${c.test_uuids.length === 1 ? 'test' : 'tests'} × ${c.agent_ids.length} ${c.agent_ids.length === 1 ? 'host' : 'hosts'}`}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        {c.last_run ? (
                          <Link to={`/tasks/campaigns/runs/${c.last_run.id}`} className="text-accent hover:underline">
                            {c.last_run.percent_protected === null
                              ? 'No conclusive results · '
                              : `${c.last_run.percent_protected}% protected · `}
                            {new Date(c.last_run.started_at).toLocaleDateString()}
                          </Link>
                        ) : (
                          <span className="text-muted">Not run yet</span>
                        )}
                        {c.last_run && (
                          <Button variant="ghost" size="sm" aria-label={`Runs of ${c.name}`}
                            aria-expanded={open} onClick={() => toggleRuns(c.id)}>
                            {open ? <ChevronDown className="w-4 h-4 mr-1" /> : <ChevronRight className="w-4 h-4 mr-1" />}
                            Runs
                          </Button>
                        )}
                        {canWrite && (
                          <>
                            <Button size="sm" aria-label={`Run ${c.name}`} onClick={() => setRunning(c)}>
                              <Play className="w-4 h-4 mr-1" />Run
                            </Button>
                            <Button variant="outline" size="sm" aria-label={`Edit ${c.name}`}
                              onClick={() => { setEditing(c); setEditorOpen(true); }}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button variant="outline" size="sm" aria-label={`Delete ${c.name}`}
                              onClick={() => void handleDelete(c)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    {open && (
                      <div className="mt-3 border-t border-border pt-1">
                        <CampaignRuns campaign={c} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="runs">
          <p className="mb-2 text-sm text-muted">
            Every run in your organization, newest first. Runs of deleted campaigns stay here as evidence.
          </p>
          <div className="rounded-[10px] border border-border bg-surface px-4 py-1">
            <RunHistoryList label="All runs" load={loadAllRuns} renderLead={allRunsLead} />
          </div>
        </TabsContent>
      </Tabs>

      <CampaignEditorDialog
        open={editorOpen}
        campaign={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={() => { setEditorOpen(false); void load(); }}
      />
      <RunCampaignDialog open={running !== null} campaign={running} onClose={() => setRunning(null)} />
    </PageContainer>
  );
}
