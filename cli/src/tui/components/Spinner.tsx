/**
 * Loading spinner with optional message.
 */

import { useState, useEffect } from 'react';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface SpinnerProps {
  message?: string;
}

export function Spinner({ message = 'Loading...' }: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame(f => (f + 1) % FRAMES.length);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  return (
    <box flexDirection="row" height={1}>
      <text fg="#e94560">{FRAMES[frame]} </text>
      <text fg="#6c6c8a">{message}</text>
    </box>
  );
}
