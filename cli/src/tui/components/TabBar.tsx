/**
 * Tab navigation bar — module tabs with keyboard shortcuts.
 */

export interface Tab {
  id: string;
  label: string;
  shortcut?: string;
}

interface TabBarProps {
  tabs: Tab[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function TabBar({ tabs, activeId }: TabBarProps) {
  return (
    <box flexDirection="row" width="100%" height={1} backgroundColor="#16213e">
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <text
            key={tab.id}
            fg={isActive ? '#e94560' : '#6c6c8a'}
            bg={isActive ? '#1a1a2e' : undefined}
          >
            {isActive ? ' ▸ ' : '   '}{tab.label}{tab.shortcut ? ` [${tab.shortcut}]` : ''}{' '}
          </text>
        );
      })}
      <box flexGrow={1} />
    </box>
  );
}
