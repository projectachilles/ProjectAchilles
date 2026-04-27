import type { AgentOS } from '@/types/agent';

interface OsPillProps {
  os: AgentOS | string;
}

/**
 * 1px-bordered OS glyph pill — Tactical Green system.
 * Colors: windows=signal (blue), linux=warn-bright (amber), darwin=violet.
 */
export function OsPill({ os }: OsPillProps) {
  const key = (os || '').toLowerCase();
  const cls =
    key === 'windows' ? 'is-windows' :
    key === 'linux'   ? 'is-linux'   :
    key === 'darwin'  ? 'is-darwin'  : 'is-linux';
  return <span className={`ep-os ${cls}`}>{os}</span>;
}
