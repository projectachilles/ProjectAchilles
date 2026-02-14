/**
 * Agent List Component - Table view of agents
 */

import { MoreHorizontal, Power, PowerOff, Trash2, KeyRound } from 'lucide-react';
import { useState } from 'react';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../shared/ui/Table';
import { Checkbox } from '../../shared/ui/Checkbox';
import { Badge, PlatformBadge, StatusDot } from '../../shared/ui/Badge';
import { Button } from '../../shared/ui/Button';
import type { AgentSummary } from '@/types/agent';

interface AgentListProps {
  agents: AgentSummary[];
  selectedAgents: string[];
  latestVersions: Map<string, string>;
  canDelete?: boolean;
  onToggleSelect: (agentId: string) => void;
  onToggleSelectAll: () => void;
  onAction: (agentId: string, action: 'enable' | 'disable' | 'decommission' | 'delete' | 'rotate-key') => void;
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
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const allSelected =
    agents.length > 0 && agents.every((a) => selectedAgents.includes(a.id));

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10">
              <Checkbox checked={allSelected} onChange={onToggleSelectAll} />
            </TableHead>
            <TableHead className="w-10">Status</TableHead>
            <TableHead>Hostname</TableHead>
            <TableHead>OS</TableHead>
            <TableHead>Arch</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Last Seen</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead className="w-16">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center py-8">
                <p className="text-muted-foreground">No agents found</p>
              </TableCell>
            </TableRow>
          ) : (
            agents.map((agent) => (
              <TableRow
                key={agent.id}
                className={selectedAgents.includes(agent.id) ? 'bg-primary/5' : ''}
              >
                <TableCell>
                  <Checkbox
                    checked={selectedAgents.includes(agent.id)}
                    onChange={() => onToggleSelect(agent.id)}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center" title={agent.is_online ? 'Online' : 'Offline'}>
                    <StatusDot status={agent.is_online ? 'online' : 'offline'} />
                  </div>
                </TableCell>
                <TableCell>
                  <button
                    className="text-left hover:text-primary transition-colors font-medium"
                    onClick={() => onSelectAgent(agent)}
                  >
                    {agent.hostname}
                  </button>
                </TableCell>
                <TableCell>
                  <PlatformBadge platform={agent.os} />
                </TableCell>
                <TableCell className="text-muted-foreground">{agent.arch}</TableCell>
                <TableCell>
                  <span className="font-mono text-xs">{agent.agent_version}</span>
                  {(() => {
                    const latest = latestVersions.get(`${agent.os}-${agent.arch}`);
                    return latest && latest !== agent.agent_version ? (
                      <Badge variant="warning" className="text-xs ml-1">outdated</Badge>
                    ) : null;
                  })()}
                  {agent.rotation_pending && (
                    <Badge variant="warning" className="text-xs ml-1">key rotating</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground">
                    {timeAgo(agent.last_heartbeat)}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {agent.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                    {agent.tags.length > 3 && (
                      <Badge variant="default" className="text-xs">
                        +{agent.tags.length - 3}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="relative">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setOpenMenu(openMenu === agent.id ? null : agent.id)}
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                    {openMenu === agent.id && (
                      <div className="absolute right-0 top-8 z-50 w-40 rounded-lg border border-border bg-card shadow-lg py-1">
                        {agent.status === 'active' ? (
                          <button
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                            onClick={() => { onAction(agent.id, 'disable'); setOpenMenu(null); }}
                          >
                            <PowerOff className="w-4 h-4" /> Disable
                          </button>
                        ) : (
                          <button
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                            onClick={() => { onAction(agent.id, 'enable'); setOpenMenu(null); }}
                          >
                            <Power className="w-4 h-4" /> Enable
                          </button>
                        )}
                        {canDelete && (
                          <button
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                            onClick={() => { onAction(agent.id, 'rotate-key'); setOpenMenu(null); }}
                          >
                            <KeyRound className="w-4 h-4" /> Rotate API Key
                          </button>
                        )}
                        {canDelete && (
                          <button
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted text-destructive flex items-center gap-2"
                            onClick={() => { onAction(agent.id, 'delete'); setOpenMenu(null); }}
                          >
                            <Trash2 className="w-4 h-4" /> Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
