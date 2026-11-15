import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { isNewer } from '@/lib/version';
import type { AboutResponse } from '@/types/about';
import type { FleetVersionCount, RegisteredVersion } from '@/hooks/useOutdatedAgentCount';
import { ReleaseNotes } from './ReleaseNotes';

const UPGRADE_GUIDE_URL = 'https://docs.projectachilles.io';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-15" or an ISO time → "Nov 15 2026". Read from the string, so no timezone shifts the day. */
export function formatDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${Number(match[3])} ${match[1]}` : value;
}

/** The newer agent version on offer, or null: the official one, when it is above everything registered here. */
export function newerAgentVersion(about: AboutResponse | null, registered: RegisteredVersion[]): string | null {
  const official = about?.agent.official?.version;
  if (!official) return null;
  return isNewer(official, registered[0]?.version ?? '0.0.0') ? official : null;
}

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  about: AboutResponse | null;
  loading: boolean;
  failed: boolean;
  /** endpoints:agents:read — registered versions and fleet counts. */
  canSeeFleet: boolean;
  /** Settings access — gets the link to Agents. */
  canManage: boolean;
  registeredVersions: RegisteredVersion[];
  fleetByVersion: FleetVersionCount[];
}

type NotesView = 'current' | 'platform' | 'agent';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-3 text-sm">
      <div className="font-mono text-xs uppercase tracking-wide text-faint">{label}</div>
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

function platformStatus(platform: AboutResponse['platform']): string | null {
  if (platform.status === 'official') return `Official release · ${formatDay(platform.releaseDate)}`;
  if (platform.status === 'ahead' && platform.aheadBy) {
    const commits = platform.aheadBy === 1 ? '1 commit' : `${platform.aheadBy} commits`;
    return `${platform.version} + ${commits} · not an official release`;
  }
  return null;
}

function checkLine(latest: AboutResponse['latest']): string {
  if (!latest.enabled) return 'Update check is off';
  if (!latest.checkedAt) return 'Last checked: never (no connection to GitHub)';
  return `Last checked: ${formatDay(latest.checkedAt)}`;
}

export function AboutDialog({
  open,
  onOpenChange,
  about,
  loading,
  failed,
  canSeeFleet,
  canManage,
  registeredVersions,
  fleetByVersion,
}: AboutDialogProps) {
  const [view, setView] = useState<NotesView>('current');
  useEffect(() => {
    if (!open) setView('current');
  }, [open]);

  let body: React.ReactNode;
  if (!about) {
    body = <p className="text-sm text-muted">{failed || !loading ? 'Version information is unavailable.' : 'Loading…'}</p>;
  } else {
    const { platform, agent, latest } = about;
    const status = platformStatus(platform);
    const newerPlatform = latest.platform?.newer ? latest.platform : null;
    const agentUpdate = canSeeFleet ? newerAgentVersion(about, registeredVersions) : null;
    const agentRemote = agentUpdate && latest.agent?.version === agentUpdate ? latest.agent : null;

    const notes =
      view === 'platform' && newerPlatform
        ? { heading: `What's new in ${newerPlatform.version}`, markdown: newerPlatform.notes, url: newerPlatform.url }
        : view === 'agent' && agentRemote
          ? { heading: `What's new in agent ${agentRemote.version}`, markdown: agentRemote.notes, url: agentRemote.url }
          : null;

    body = (
      <div className="flex flex-col gap-4">
        <Row label="Platform">
          <p className="font-mono text-foreground">{platform.version}</p>
          {status && <p className="text-muted">{status}</p>}
          {platform.commitShort && <p className="font-mono text-xs text-faint">commit {platform.commitShort}</p>}
          {newerPlatform && (
            <div className="rounded border border-accent/25 bg-accent-dim px-2.5 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-accent">{newerPlatform.version} is available</span>
                <Button variant="ghost" size="sm" onClick={() => setView('platform')}>
                  What's new
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted">
                Upgrading is described in the{' '}
                <a href={UPGRADE_GUIDE_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                  deployment guide
                </a>
                .
              </p>
            </div>
          )}
        </Row>

        <Row label="Agent">
          {agent.official && <p className="text-foreground">Official: {agent.official.version}</p>}
          {canSeeFleet && (
            <p className="text-muted">
              Registered here:{' '}
              {registeredVersions.length > 0
                ? `${registeredVersions[0].version} (${registeredVersions[0].platforms.join(', ')})`
                : 'none'}
            </p>
          )}
          {canSeeFleet && fleetByVersion.length > 0 && (
            <p className="text-muted">Fleet: {fleetByVersion.map((f) => `${f.count} on ${f.version}`).join(' · ')}</p>
          )}
          {agentUpdate && (
            <div className="rounded border border-accent/25 bg-accent-dim px-2.5 py-2">
              <p className="text-accent">
                Official {agentUpdate} is not registered on this install
                {canManage && (
                  <>
                    {' '}
                    (<Link to="/agents" className="underline-offset-4 hover:underline" onClick={() => onOpenChange(false)}>
                      Agents
                    </Link>
                    )
                  </>
                )}
              </p>
              {agentRemote && (
                <Button variant="ghost" size="sm" className="mt-1" onClick={() => setView('agent')}>
                  What's new in the agent
                </Button>
              )}
            </div>
          )}
        </Row>

        <div className="border-t border-border pt-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-foreground">{notes ? notes.heading : `Release notes for ${platform.version}`}</h3>
            {notes ? (
              <Button variant="ghost" size="sm" onClick={() => setView('current')}>
                Back to {platform.version}
              </Button>
            ) : (
              <a
                href={platform.releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent underline-offset-4 hover:underline"
              >
                Full changelog
              </a>
            )}
          </div>
          <div className="max-h-[45vh] overflow-y-auto pr-2">
            <ReleaseNotes markdown={notes ? notes.markdown : platform.notes} />
            {notes?.url && (
              <p className="mt-3 text-xs">
                <a href={notes.url} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-4 hover:underline">
                  Open this release on GitHub
                </a>
              </p>
            )}
          </div>
        </div>

        <p className="font-mono text-[10px] text-faint">{checkLine(latest)}</p>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>About ProjectAchilles</DialogTitle>
          <DialogDescription>What this install is running</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
