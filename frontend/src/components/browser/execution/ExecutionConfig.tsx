import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/shared/ui/Tabs';
import { Input } from '@/components/shared/ui/Input';
import { Switch } from '@/components/shared/ui/Switch';
import { Play, Calendar } from 'lucide-react';
import type { ScheduleType } from '@/types/agent';
import type { IndexInfo } from '@/services/api/analytics';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Australia/Sydney',
];

export interface ExecutionConfigState {
  activeTab: 'run-now' | 'schedule';
  timeout: string;
  priority: string;
  targetIndex: string;
  scheduleName: string;
  scheduleType: ScheduleType;
  scheduleTime: string;
  scheduleDate: string;
  scheduleDays: number[];
  scheduleDayOfMonth: number;
  scheduleTimezone: string;
  randomizeTime: boolean;
}

export function getDefaultConfigState(): ExecutionConfigState {
  return {
    activeTab: 'run-now',
    timeout: '300',
    priority: '1',
    targetIndex: '',
    scheduleName: '',
    scheduleType: 'daily',
    scheduleTime: '09:00',
    scheduleDate: '',
    scheduleDays: [1, 2, 3, 4, 5],
    scheduleDayOfMonth: 1,
    scheduleTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    randomizeTime: false,
  };
}

interface ExecutionConfigProps {
  config: ExecutionConfigState;
  onChange: (updates: Partial<ExecutionConfigState>) => void;
  availableIndices: IndexInfo[];
  indicesLoading?: boolean;
}

export default function ExecutionConfig({ config, onChange, availableIndices, indicesLoading }: ExecutionConfigProps) {
  function toggleDay(day: number) {
    const days = config.scheduleDays.includes(day)
      ? config.scheduleDays.filter((d) => d !== day)
      : [...config.scheduleDays, day].sort();
    onChange({ scheduleDays: days });
  }

  return (
    <Tabs defaultValue="run-now" onValueChange={(v) => onChange({ activeTab: v as 'run-now' | 'schedule' })}>
      <TabsList>
        <TabsTrigger value="run-now">
          <Play className="h-3.5 w-3.5" />
          Run Now
        </TabsTrigger>
        <TabsTrigger value="schedule">
          <Calendar className="h-3.5 w-3.5" />
          Schedule
        </TabsTrigger>
      </TabsList>

      <TabsContent value="run-now">
        <div className="grid grid-cols-3 gap-4">
          <Input
            label="Timeout (seconds)"
            type="number"
            value={config.timeout}
            onChange={(e) => onChange({ timeout: e.target.value })}
          />
          <div>
            <label className="block text-sm font-medium mb-1.5">Priority</label>
            <select
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
              value={config.priority}
              onChange={(e) => onChange({ priority: e.target.value })}
            >
              <option value="1">Normal (1)</option>
              <option value="2">Medium (2)</option>
              <option value="3">High (3)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Target Index</label>
            <select
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
              value={config.targetIndex}
              onChange={(e) => onChange({ targetIndex: e.target.value })}
              disabled={indicesLoading}
            >
              <option value="">Default (global)</option>
              {availableIndices.map((idx) => (
                <option key={idx.name} value={idx.name}>{idx.name}</option>
              ))}
            </select>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="schedule">
        <div className="space-y-4">
          <Input
            label="Schedule Name (optional)"
            placeholder="e.g. Daily persistence check"
            value={config.scheduleName}
            onChange={(e) => onChange({ scheduleName: e.target.value })}
          />

          {/* Frequency pills */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Frequency</label>
            <div className="flex gap-2">
              {(['once', 'daily', 'weekly', 'monthly'] as ScheduleType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { onChange({ scheduleType: t }); if (t === 'once') onChange({ randomizeTime: false }); }}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors capitalize ${
                    config.scheduleType === t
                      ? 'bg-primary/10 text-primary border-primary/30'
                      : 'bg-muted text-muted-foreground border-border hover:border-primary/20'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Once → date picker */}
          {config.scheduleType === 'once' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Date</label>
                <input
                  type="date"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
                  value={config.scheduleDate}
                  onChange={(e) => onChange({ scheduleDate: e.target.value })}
                  min={new Date().toISOString().slice(0, 10)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Time</label>
                <input
                  type="time"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
                  value={config.scheduleTime}
                  onChange={(e) => onChange({ scheduleTime: e.target.value })}
                />
              </div>
            </div>
          )}

          {/* Daily → time or randomize */}
          {config.scheduleType === 'daily' && (
            <div className="space-y-3">
              <Switch
                label="Randomize time"
                checked={config.randomizeTime}
                onChange={(e) => onChange({ randomizeTime: e.target.checked })}
              />
              {config.randomizeTime ? (
                <p className="text-xs text-muted-foreground">
                  Weekdays 09:00–17:00 &middot; Weekends anytime
                </p>
              ) : (
                <div>
                  <label className="block text-sm font-medium mb-1.5">Time</label>
                  <input
                    type="time"
                    className="w-full max-w-48 rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
                    value={config.scheduleTime}
                    onChange={(e) => onChange({ scheduleTime: e.target.value })}
                  />
                </div>
              )}
            </div>
          )}

          {/* Weekly → day toggles + time */}
          {config.scheduleType === 'weekly' && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1.5">Days</label>
                <div className="flex gap-1.5">
                  {DAY_LABELS.map((label, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => toggleDay(idx)}
                      className={`text-xs w-10 py-1.5 rounded-full border transition-colors ${
                        config.scheduleDays.includes(idx)
                          ? 'bg-primary/10 text-primary border-primary/30'
                          : 'bg-muted text-muted-foreground border-border hover:border-primary/20'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <Switch
                label="Randomize time"
                checked={config.randomizeTime}
                onChange={(e) => onChange({ randomizeTime: e.target.checked })}
              />
              {config.randomizeTime ? (
                <p className="text-xs text-muted-foreground">
                  Weekdays 09:00–17:00 &middot; Weekends anytime
                </p>
              ) : (
                <div>
                  <label className="block text-sm font-medium mb-1.5">Time</label>
                  <input
                    type="time"
                    className="w-full max-w-48 rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
                    value={config.scheduleTime}
                    onChange={(e) => onChange({ scheduleTime: e.target.value })}
                  />
                </div>
              )}
            </div>
          )}

          {/* Monthly → day of month + time */}
          {config.scheduleType === 'monthly' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">Day of Month</label>
                  <select
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
                    value={config.scheduleDayOfMonth}
                    onChange={(e) => onChange({ scheduleDayOfMonth: parseInt(e.target.value) })}
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
                {!config.randomizeTime && (
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Time</label>
                    <input
                      type="time"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
                      value={config.scheduleTime}
                      onChange={(e) => onChange({ scheduleTime: e.target.value })}
                    />
                  </div>
                )}
              </div>
              <Switch
                label="Randomize time"
                checked={config.randomizeTime}
                onChange={(e) => onChange({ randomizeTime: e.target.checked })}
              />
              {config.randomizeTime && (
                <p className="text-xs text-muted-foreground">
                  Weekdays 09:00–17:00 &middot; Weekends anytime
                </p>
              )}
            </div>
          )}

          {/* Timezone */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Timezone</label>
            <select
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
              value={config.scheduleTimezone}
              onChange={(e) => onChange({ scheduleTimezone: e.target.value })}
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
              ))}
              {!COMMON_TIMEZONES.includes(config.scheduleTimezone) && (
                <option value={config.scheduleTimezone}>{config.scheduleTimezone.replace(/_/g, ' ')}</option>
              )}
            </select>
          </div>

          {/* Timeout + Priority + Target Index */}
          <div className="grid grid-cols-3 gap-4">
            <Input
              label="Timeout (seconds)"
              type="number"
              value={config.timeout}
              onChange={(e) => onChange({ timeout: e.target.value })}
            />
            <div>
              <label className="block text-sm font-medium mb-1.5">Priority</label>
              <select
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
                value={config.priority}
                onChange={(e) => onChange({ priority: e.target.value })}
              >
                <option value="1">Normal (1)</option>
                <option value="2">Medium (2)</option>
                <option value="3">High (3)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Target Index</label>
              <select
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
                value={config.targetIndex}
                onChange={(e) => onChange({ targetIndex: e.target.value })}
                disabled={indicesLoading}
              >
                <option value="">Default (global)</option>
                {availableIndices.map((idx) => (
                  <option key={idx.name} value={idx.name}>{idx.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}
