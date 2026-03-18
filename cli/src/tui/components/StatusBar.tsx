/**
 * Top status bar — shows server URL, user, and connection status.
 */

interface StatusBarProps {
  serverUrl: string;
  user: string | null;
  org: string | null;
}

export function StatusBar({ serverUrl, user, org }: StatusBarProps) {
  const userText = user ? `${user}` : 'not logged in';
  const orgText = org ? ` (${org})` : '';

  return (
    <box flexDirection="row" width="100%" height={1} backgroundColor="#1a1a2e">
      <text fg="#e94560">
        {' '}◆ ProjectAchilles{' '}
      </text>
      <box flexGrow={1} />
      <text fg="#6c6c8a">
        {serverUrl}
      </text>
      <text fg="#0f3460">
        {' '}│{' '}
      </text>
      <text fg={user ? '#16c79a' : '#e94560'}>
        {userText}{orgText}{' '}
      </text>
    </box>
  );
}
