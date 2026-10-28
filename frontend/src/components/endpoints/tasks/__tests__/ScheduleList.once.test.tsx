import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScheduleList from '../ScheduleList';
import type { Schedule, ScheduleConfig } from '@/types/agent';

const schedule = (config: ScheduleConfig): Schedule => ({
  id: 's1', name: 'Thursday run', agent_ids: ['a1'], org_id: 'default', test_uuid: 'u', test_name: 'T',
  binary_name: 't.exe', execution_timeout: 300, priority: 1,
  metadata: { category: '', subcategory: '', severity: '', techniques: [], tactics: [], threat_actor: '', target: [], complexity: '', tags: [], score: null, integrations: [] },
  schedule_type: 'once', schedule_config: config, timezone: 'Europe/London',
  next_run_at: null, last_run_at: null, status: 'active', created_by: 'u1', created_at: '', updated_at: '',
});

describe('ScheduleList Once description', () => {
  it('fixed time', () => {
    render(<ScheduleList schedules={[schedule({ date: '2026-10-29', time: '09:00' })]} />);
    expect(screen.getByText('Once on 2026-10-29 at 09:00 Europe/London')).toBeInTheDocument();
  });

  it('random time per machine', () => {
    render(<ScheduleList schedules={[schedule({ date: '2026-10-29', time: '09:00', randomize_mode: 'per_machine' })]} />);
    expect(screen.getByText('Once on 2026-10-29, random time per machine (office hours) Europe/London')).toBeInTheDocument();
  });
});
