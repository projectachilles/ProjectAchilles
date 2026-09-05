/**
 * Agent List — Command Rail table: rows grouped by primary tag, with inline
 * health bars and 24h heartbeat sparklines (per the approved redesign).
 */

import { MoreHorizontal, Power, PowerOff, Trash2, KeyRound, Download, Unplug, Eye } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../shared/ui/Table';
import { Checkbox } from '../../shared/ui/Checkbox';
import { Badge, StatusDot } from '../../shared/ui/Badge';
import { Button } from '../../shared/ui/Button';
import { HeartbeatSparkline } from './HeartbeatSparkline';
import type { AgentSummary } from '@/types/agent';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';

interface AgentListProps {
  agents: AgentSummary[];
  selectedAgents: string[];
  latestVersions: Map<string, string>;
  canDelete?: boolean;
  onToggleSelect: (agentId: string) => void;
  onToggleSelectAll: () => void;
  onAction: (agentId: string, action: 'enable' | 'disable' | 'decommission' | 'delete' | 'rotate-key' | 'update' | 'uninstall') => void;
  onSelectAgent: (agent: AgentSummary) => void;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';

  // SQLite datetime('now') returns UTC without a Z suffix.
  // Append Z so JS parses it as UTC rather than local time.
  const normalized = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
  const seconds = Math.floor((Date.now() - new Date(normalized).getTime()) / 1000);

  if (seconds < 0) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const UNTAGGED = 'untagged';

function healthClasses(score: number): { bar: string; text: string } {
  if (score >= 70) return { bar: 'bg-accent', text: 'text-accent' };
  if (score >= 40) return { bar: 'bg-warning', text: 'text-warning' };
  return { bar: 'bg-danger', text: 'text-danger' };
}

export default function AgentList({
  agents,
  selectedAgents,
  latestVersions,
  canDelete = true,
  onToggleSelect,
  onToggleSelectAll,
  onAction,
  onSelectAgent,
}: AgentListProps) {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const allSelected =
    agents.length > 0 && agents.every((a) => selectedAgents.includes(a.id));

  // Group by primary (first) tag; groups sorted by size, untagged last.
  const groups = useMemo(() => {
    const map = new Map<string, AgentSummary[]>();
    for (const agent of agents) {
      const tag = agent.tags[0] ?? UNTAGGED;
      const list = map.get(tag);
      if (list) list.push(agent);
      else map.set(tag, [agent]);
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === UNTAGGED) return 1;
      if (b[0] === UNTAGGED) return -1;
      return b[1].length - a[1].length || a[0].localeCompare(b[0]);
    });
  }, [agents]);

  const renderActionsMenu = (agent: AgentSummary) => (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpenMenu(openMenu === agent.id ? null : agent.id)}
      >
        <MoreHorizontal className="w-4 h-4" />
      </Button>
      {openMenu === agent.id && (
        <div className="absolute right-0 top-8 z-50 w-40 rounded-md border border-border bg-overlay shadow-lg py-1">
          <button
            className="w-full text-left px-3 py-2 text-sm hover:bg-raised hover:text-accent flex items-center gap-2"
            onClick={() => { onSelectAgent(agent); setOpenMenu(null); }}
          >
            <Eye className="w-4 h-4" /> Quick View
          </button>
          {agent.status === 'active' ? (
            <button
              className="w-full text-left px-3 py-2 text-sm hover:bg-raised hover:text-accent flex items-center gap-2"
              onClick={() => { onAction(agent.id, 'disable'); setOpenMenu(null); }}
            >
              <PowerOff className="w-4 h-4" /> Disable
            </button>
          ) : (
            <button
              className="w-full text-left px-3 py-2 text-sm hover:bg-raised hover:text-accent flex items-center gap-2"
              onClick={() => { onAction(agent.id, 'enable'); setOpenMenu(null); }}
            >
              <Power className="w-4 h-4" /> Enable
            </button>
          )}
          <button
            className="w-full text-left px-3 py-2 text-sm hover:bg-raised hover:text-accent flex items-center gap-2"
            onClick={() => { onAction(agent.id, 'update'); setOpenMenu(null); }}
          >
            <Download className="w-4 h-4" /> Update
          </button>
          {canDelete && (
            <button
              className="w-full text-left px-3 py-2 text-sm hover:bg-raised hover:text-accent flex items-center gap-2"
              onClick={() => { onAction(agent.id, 'rotate-key'); setOpenMenu(null); }}
            >
              <KeyRound className="w-4 h-4" /> Rotate API Key
            </button>
          )}
          {canDelete && (
            <button
              className="w-full text-left px-3 py-2 text-sm hover:bg-raised text-danger flex items-center gap-2"
              onClick={() => { onAction(agent.id, 'uninstall'); setOpenMenu(null); }}
            >
              <Unplug className="w-4 h-4" /> Uninstall
            </button>
          )}
          {canDelete && (
            <button
              className="w-full text-left px-3 py-2 text-sm hover:bg-raised text-danger flex items-center gap-2"
              onClick={() => { onAction(agent.id, 'delete'); setOpenMenu(null); }}
            >
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          )}
        </div>
      )}
    </div>
  );

  const renderAgentRow = (agent: AgentSummary) => (
    <TableRow
      key={agent.id}
      className={selectedAgents.includes(agent.id) ? 'bg-accent-dim/40' : agent.is_online ? '' : 'opacity-60'}
    >
      <TableCell>
        <Checkbox
          checked={selectedAgents.includes(agent.id)}
          onChange={() => onToggleSelect(agent.id)}
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5" title={agent.is_online ? 'Online' : 'Offline'}>
          <StatusDot status={agent.is_online ? 'online' : 'offline'} />
          {agent.status === 'uninstalled' && <Badge variant="default" className="text-xs">Uninstalled</Badge>}
          {agent.status === 'decommissioned' && <Badge variant="destructive" className="text-xs">Decommissioned</Badge>}
          {agent.status === 'disabled' && <Badge variant="warning" className="text-xs">Disabled</Badge>}
        </div>
      </TableCell>
      <TableCell>
        <button
          className="block whitespace-nowrap text-left font-mono text-sm hover:text-accent transition-colors"
          onClick={() => navigate(`/agents/${agent.id}`)}
        >
          {agent.hostname}
        </button>
        <span className="text-[11px] text-faint">{agent.os} · {agent.arch}</span>
      </TableCell>
      <TableCell>
        {agent.health_score != null ? (
          <div className="flex items-center gap-2">
            <div className="h-[5px] w-16 rounded-full bg-raised">
              <div
                className={`h-full rounded-full ${healthClasses(agent.health_score).bar}`}
                style={{ width: `${Math.max(2, Math.min(100, agent.health_score))}%` }}
              />
            </div>
            <span className={`font-mono text-[11px] ${healthClasses(agent.health_score).text}`}>
              {agent.health_score}
            </span>
          </div>
        ) : (
          <span className="text-xs text-faint">—</span>
        )}
      </TableCell>
      <TableCell>
        <HeartbeatSparkline agentId={agent.id} online={agent.is_online} />
      </TableCell>
      <TableCell>
        <span className="font-mono text-xs text-muted">{agent.agent_version}</span>
        {(() => {
          const latest = latestVersions.get(`${agent.os}-${agent.arch}`);
          return latest && latest !== agent.agent_version ? (
            <Badge variant="warning" className="text-xs ml-1">outdated</Badge>
          ) : null;
        })()}
        {agent.is_stale && (
          <Badge variant="warning" className="text-xs ml-1">stale</Badge>
        )}
        {agent.rotation_pending && (
          <Badge variant="warning" className="text-xs ml-1">key rotating</Badge>
        )}
      </TableCell>
      <TableCell>
        <span className={`text-xs ${agent.is_online ? 'text-faint' : 'text-danger'}`}>
          {timeAgo(agent.last_heartbeat)}
        </span>
      </TableCell>
      <TableCell>
        {renderActionsMenu(agent)}
      </TableCell>
    </TableRow>
  );

  const renderAgentCard = (agent: AgentSummary) => {
    const latest = latestVersions.get(`${agent.os}-${agent.arch}`);
    const outdated = latest != null && latest !== agent.agent_version;
    return (
      <div
        key={agent.id}
        className={cn(
          'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 border-b border-border px-3 py-2.5 last:border-b-0',
          selectedAgents.includes(agent.id) ? 'bg-accent-dim/40' : !agent.is_online && 'opacity-60',
        )}
      >
        <Checkbox checked={selectedAgents.includes(agent.id)} onChange={() => onToggleSelect(agent.id)} />
        <button
          className="flex min-w-0 items-center gap-2 text-left"
          onClick={() => navigate(`/agents/${agent.id}`)}
          title={agent.is_online ? 'Online' : 'Offline'}
        >
          <StatusDot status={agent.is_online ? 'online' : 'offline'} />
          <span className="truncate font-mono text-sm">{agent.hostname}</span>
        </button>
        <div className="flex items-center gap-1">
          <HeartbeatSparkline agentId={agent.id} online={agent.is_online} />
          {renderActionsMenu(agent)}
        </div>
        <div className="col-span-2 col-start-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          {agent.health_score != null && (
            <span className="flex items-center gap-1.5">
              <span className="h-[5px] w-12 rounded-full bg-raised">
                <span
                  className={`block h-full rounded-full ${healthClasses(agent.health_score).bar}`}
                  style={{ width: `${Math.max(2, Math.min(100, agent.health_score))}%` }}
                />
              </span>
              <span className={`font-mono ${healthClasses(agent.health_score).text}`}>{agent.health_score}</span>
            </span>
          )}
          <span className="font-mono text-muted">{agent.agent_version}</span>
          <span className="text-faint">{agent.os} · {agent.arch}</span>
          {agent.status === 'uninstalled' && <Badge variant="default" className="text-xs">Uninstalled</Badge>}
          {agent.status === 'decommissioned' && <Badge variant="destructive" className="text-xs">Decommissioned</Badge>}
          {agent.status === 'disabled' && <Badge variant="warning" className="text-xs">Disabled</Badge>}
          {outdated && <Badge variant="warning" className="text-xs">outdated</Badge>}
          {agent.is_stale && <Badge variant="warning" className="text-xs">stale</Badge>}
          {agent.rotation_pending && <Badge variant="warning" className="text-xs">key rotating</Badge>}
          <span className={`ml-auto ${agent.is_online ? 'text-faint' : 'text-danger'}`}>{timeAgo(agent.last_heartbeat)}</span>
        </div>
      </div>
    );
  };

  if (!isDesktop) {
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2.5 border-b border-border px-3 py-2">
          <Checkbox checked={allSelected} onChange={onToggleSelectAll} />
          <span className="text-[11px] uppercase tracking-wider text-faint">select all on page</span>
        </div>
        {agents.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">No agents found</p>
        ) : (
          groups.map(([tag, members]) => (
            <Fragment key={tag}>
              <div className="bg-raised px-3 py-1.5">
                <span className="font-mono text-[11px] text-accent">{tag}</span>
                <span className="ml-2 font-mono text-[11px] text-faint">
                  · {members.length} agent{members.length !== 1 ? 's' : ''} · {members.filter((m) => m.is_online).length} online
                </span>
              </div>
              {members.map(renderAgentCard)}
            </Fragment>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10">
              <Checkbox checked={allSelected} onChange={onToggleSelectAll} />
            </TableHead>
            <TableHead className="w-10">Status</TableHead>
            <TableHead>Hostname</TableHead>
            <TableHead>Health</TableHead>
            <TableHead>Heartbeat · 24h</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Last Seen</TableHead>
            <TableHead className="w-16">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-8">
                <p className="text-muted-foreground">No agents found</p>
              </TableCell>
            </TableRow>
          ) : (
            groups.map(([tag, members]) => (
              <Fragment key={tag}>
                <TableRow className="bg-raised hover:bg-raised">
                  <TableCell colSpan={8} className="py-1.5">
                    <span className="font-mono text-[11px] text-accent">{tag}</span>
                    <span className="ml-2 font-mono text-[11px] text-faint">
                      · {members.length} agent{members.length !== 1 ? 's' : ''} · {members.filter((m) => m.is_online).length} online
                    </span>
                  </TableCell>
                </TableRow>
                {members.map(renderAgentRow)}
              </Fragment>
            ))
          )}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}
