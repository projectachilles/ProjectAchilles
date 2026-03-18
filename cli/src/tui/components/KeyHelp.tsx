/**
 * Bottom keyboard shortcut legend.
 */

interface KeyHelpProps {
  show?: boolean;
}

export function KeyHelp({ show }: KeyHelpProps) {
  const shortcuts = [
    { key: 'q', action: 'quit' },
    { key: 'tab', action: 'next' },
    { key: '1-6', action: 'jump' },
    { key: 'j/k', action: '↑↓' },
    { key: 'r', action: 'refresh' },
    { key: '?', action: 'help' },
  ];

  return (
    <box flexDirection="row" width="100%" height={1} backgroundColor="#0f3460">
      {shortcuts.map(({ key, action }) => (
        <text key={key} fg="#6c6c8a">
          {'  '}<text fg="#e94560">{key}</text>:{action}
        </text>
      ))}
      <box flexGrow={1} />
      {show && (
        <text fg="#16c79a">
          {' '}[HELP ON]{' '}
        </text>
      )}
    </box>
  );
}
