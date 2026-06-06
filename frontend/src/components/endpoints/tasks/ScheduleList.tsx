import { Pause, Play, Trash2, Clock, Calendar } from 'lucide-react';
import { Button } from '@/components/shared/ui/Button';
import type { Schedule, RandomizeMode, ScheduleConfigDaily, ScheduleConfigWeekly, ScheduleConfigMonthly, ScheduleConfigOnce } from '@/types/agent';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Resolve effective randomization mode, bridging the legacy randomize_time flag. */
function resolveMode(c: { randomize_mode?: RandomizeMode; randomize_time?: boolean }): RandomizeMode {
  if (c.randomize_mode) return c.randomize_mode;
  return c.randomize_time ? 'fleet' : 'fixed';
}

/** Time phrase for the schedule description, e.g. "at 09:00 UTC" or a random-mode caption. */
function timePhrase(c: { time: string; randomize_mode?: RandomizeMode; randomize_time?: boolean }, tz: string): string {
  const mode = resolveMode(c);
  if (mode === 'per_machine') return `random time per machine (office hours) ${tz}`;
  if (mode === 'fleet') return `random time (office hours) ${tz}`;
  return `at ${c.time} ${tz}`;
}

function describeSchedule(schedule: Schedule): string {
  const config = schedule.schedule_config;
  const tz = schedule.timezone;

  switch (schedule.schedule_type) {
    case 'once': {
      const c = config as ScheduleConfigOnce;
      return `Once on ${c.date} at ${c.time} ${tz}`;
    }
    case 'daily': {
      const c = config as ScheduleConfigDaily;
      return `Daily, ${timePhrase(c, tz)}`;
    }
    case 'weekly': {
      const c = config as ScheduleConfigWeekly;
      const days = c.days.map((d) => DAY_LABELS[d]).join(', ');
      return `Weekly ${days}, ${timePhrase(c, tz)}`;
    }
    case 'monthly': {
      const c = config as ScheduleConfigMonthly;
      return `Monthly on day ${c.dayOfMonth}, ${timePhrase(c, tz)}`;
    }
  }
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - Date.now();
  const absDiff = Math.abs(diff);
  const past = diff < 0;

  if (absDiff < 60_000) return past ? 'just now' : 'in <1m';
  if (absDiff < 3_600_000) {
    const mins = Math.round(absDiff / 60_000);
    return past ? `${mins}m ago` : `in ${mins}m`;
  }
  if (absDiff < 86_400_000) {
    const hrs = Math.round(absDiff / 3_600_000);
    return past ? `${hrs}h ago` : `in ${hrs}h`;
  }
  const days = Math.round(absDiff / 86_400_000);
  return past ? `${days}d ago` : `in ${days}d`;
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-500/10 text-green-400 border-green-500/20',
  paused: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  completed: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
};

interface ScheduleListProps {
  schedules: Schedule[];
  onTogglePause?: (id: string, newStatus: 'active' | 'paused') => void;
  onDelete?: (id: string) => void;
}

export default function ScheduleList({ schedules, onTogglePause, onDelete }: ScheduleListProps) {
  if (schedules.length === 0) {
    return (
      <div className="border border-border rounded-lg bg-card p-8 text-center">
        <Calendar className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No scheduled tasks</p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg bg-card divide-y divide-border">
      {schedules.map((schedule) => (
        <div key={schedule.id} className="p-4 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium truncate">
                {schedule.name || schedule.test_name}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${STATUS_STYLES[schedule.status] ?? ''}`}>
                {schedule.status}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border capitalize">
                {schedule.schedule_type}
              </span>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {describeSchedule(schedule)}
            </p>
            <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Next: {relativeTime(schedule.next_run_at)}
              </span>
              {schedule.last_run_at && (
                <span>Last: {relativeTime(schedule.last_run_at)}</span>
              )}
              <span>{schedule.agent_ids.length} agent{schedule.agent_ids.length !== 1 ? 's' : ''}</span>
            </div>
          </div>

          <div className="flex gap-1 shrink-0">
            {onTogglePause && schedule.status !== 'completed' && (
              <Button
                variant="outline"
                className="px-2 py-1 h-8"
                onClick={() => onTogglePause(schedule.id, schedule.status === 'active' ? 'paused' : 'active')}
                title={schedule.status === 'active' ? 'Pause' : 'Resume'}
              >
                {schedule.status === 'active' ? (
                  <Pause className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
            {onDelete && (
              <Button
                variant="outline"
                className="px-2 py-1 h-8 text-red-400 hover:text-red-300 hover:border-red-500/30"
                onClick={() => onDelete(schedule.id)}
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
