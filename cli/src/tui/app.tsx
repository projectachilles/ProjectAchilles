/**
 * Root TUI application — full-screen OpenTUI React app.
 *
 * Sets up the renderer, manages active view tab, and handles
 * global keyboard shortcuts.
 */

import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { useState, useEffect } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { StatusBar } from './components/StatusBar.js';
import { TabBar, type Tab } from './components/TabBar.js';
import { KeyHelp } from './components/KeyHelp.js';
import { Dashboard } from './views/Dashboard.js';
import { AgentList } from './views/AgentList.js';
import { TaskList } from './views/TaskList.js';
import { BrowserList } from './views/BrowserList.js';
import { AnalyticsView } from './views/AnalyticsView.js';
import { ScheduleList } from './views/ScheduleList.js';
import { getUserInfo } from '../auth/token-store.js';
import { loadConfig } from '../config/store.js';

const TABS: Tab[] = [
  { id: 'dashboard', label: 'Dashboard', shortcut: '1' },
  { id: 'agents', label: 'Agents', shortcut: '2' },
  { id: 'tasks', label: 'Tasks', shortcut: '3' },
  { id: 'browser', label: 'Browser', shortcut: '4' },
  { id: 'analytics', label: 'Analytics', shortcut: '5' },
  { id: 'schedules', label: 'Schedules', shortcut: '6' },
];

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showHelp, setShowHelp] = useState(false);
  const { width, height } = useTerminalDimensions();

  const user = getUserInfo();
  const config = loadConfig();

  useKeyboard((event) => {
    if (event.name === 'q' && !event.modifiers.ctrl) {
      process.exit(0);
    }
    if (event.name === 'tab' && !event.modifiers.shift) {
      const idx = TABS.findIndex(t => t.id === activeTab);
      setActiveTab(TABS[(idx + 1) % TABS.length].id);
    }
    if (event.name === 'tab' && event.modifiers.shift) {
      const idx = TABS.findIndex(t => t.id === activeTab);
      setActiveTab(TABS[(idx - 1 + TABS.length) % TABS.length].id);
    }
    if (event.name === '?') {
      setShowHelp(h => !h);
    }
    // Number shortcuts
    const num = parseInt(event.name);
    if (num >= 1 && num <= TABS.length) {
      setActiveTab(TABS[num - 1].id);
    }
  });

  const contentHeight = height - 4; // StatusBar (1) + TabBar (1) + KeyHelp (1) + padding

  return (
    <box flexDirection="column" width={width} height={height}>
      <StatusBar
        serverUrl={config.server_url}
        user={user?.userId ?? null}
        org={user?.orgId ?? null}
      />
      <TabBar tabs={TABS} activeId={activeTab} onSelect={setActiveTab} />
      <box flexGrow={1} flexDirection="column" padding={0}>
        {activeTab === 'dashboard' && <Dashboard height={contentHeight} />}
        {activeTab === 'agents' && <AgentList height={contentHeight} />}
        {activeTab === 'tasks' && <TaskList height={contentHeight} />}
        {activeTab === 'browser' && <BrowserList height={contentHeight} />}
        {activeTab === 'analytics' && <AnalyticsView height={contentHeight} />}
        {activeTab === 'schedules' && <ScheduleList height={contentHeight} />}
      </box>
      <KeyHelp show={showHelp} />
    </box>
  );
}

export async function launchTUI(): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    useAlternateScreen: true,
  });

  createRoot(renderer).render(<App />);
}
