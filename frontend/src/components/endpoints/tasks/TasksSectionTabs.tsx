import { Link, useLocation } from 'react-router-dom';
import { useCapabilities } from '@/hooks/useCapabilities';
import { pillClass } from '@/components/shared/ui/pillStyles';

export type TasksSection = 'runs' | 'schedules' | 'campaigns';

/** Paths of the three Tasks sections. Campaign run pages live under /tasks/campaigns/runs/:id. */
export const TASKS_SECTION_PATHS: Record<TasksSection, string> = {
  runs: '/tasks',
  schedules: '/tasks/schedules',
  campaigns: '/tasks/campaigns',
};

export function tasksSectionFromPath(pathname: string): TasksSection {
  if (pathname === TASKS_SECTION_PATHS.schedules || pathname.startsWith(`${TASKS_SECTION_PATHS.schedules}/`)) return 'schedules';
  if (pathname === TASKS_SECTION_PATHS.campaigns || pathname.startsWith(`${TASKS_SECTION_PATHS.campaigns}/`)) return 'campaigns';
  return 'runs';
}

/**
 * Runs / Schedules / Campaigns: the three ways tests reach agents. Rendered
 * beside the page title (PageHeader `titleAside`) so it takes no extra row.
 * Campaigns is hidden where the backend doesn't support it (serverless). No
 * counts: the tabs look the same on every section.
 */
export function TasksSectionTabs() {
  const { pathname } = useLocation();
  const capabilities = useCapabilities();
  const current = tasksSectionFromPath(pathname);

  const sections: Array<{ id: TasksSection; label: string }> = [
    { id: 'runs', label: 'Runs' },
    { id: 'schedules', label: 'Schedules' },
    ...(capabilities.campaigns ? [{ id: 'campaigns' as const, label: 'Campaigns' }] : []),
  ];

  return (
    <nav aria-label="Tasks sections" className="flex flex-wrap gap-1.5">
      {sections.map((s) => {
        const active = current === s.id;
        return (
          <Link
            key={s.id}
            to={TASKS_SECTION_PATHS[s.id]}
            aria-current={active ? 'page' : undefined}
            className={pillClass(active, 'h-7 px-3')}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
