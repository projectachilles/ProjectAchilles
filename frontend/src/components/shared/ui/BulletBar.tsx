import React from 'react';

export interface BulletBarProps {
  value: number;            // 0..100
  target?: number;          // 0..100, draws a target marker (default 80)
  // band color derives from value vs thresholds unless `tone` is given:
  tone?: 'protected' | 'warning' | 'bypassed';
  height?: number;          // px, default 22
  showTargetMarker?: boolean; // default true when target provided
  'aria-label'?: string;
}

// Maps a tone/band to its real governed chart token. Note: the "warning" band
// resolves to `--chart-warn` (the actual token name — there is no `--chart-warning`).
// Exported so any component coloring a score by band (WeakestHosts,
// StatusCommandBar) resolves tone→token from one shared source.
export const TONE_TOKEN = {
  protected: 'var(--chart-protected)',
  warning: 'var(--chart-warn)',
  bypassed: 'var(--chart-bypassed)',
} as const;

/**
 * Derives a score band/tone from a raw 0-100 value: ≥80 protected, 50-79
 * warning, <50 bypassed. Shared by any component that needs to color a score
 * consistently with BulletBar's own fill-band logic (e.g. WeakestHosts,
 * StatusCommandBar) without duplicating the thresholds.
 */
export function scoreBandTone(value: number): 'protected' | 'warning' | 'bypassed' {
  if (value >= 80) return 'protected';
  if (value >= 50) return 'warning';
  return 'bypassed';
}

/**
 * BulletBar — a horizontal value-vs-target indicator.
 *
 * The fill width represents the value (0–100%), and its color band derives from
 * value ≥80 (protected), 50–79 (warning), <50 (bypassed), unless overridden by `tone`.
 * An optional target marker shows the goal position.
 */
export function BulletBar({
  value,
  target = 80,
  tone,
  height = 22,
  showTargetMarker = true,
  'aria-label': ariaLabel,
}: BulletBarProps): React.ReactElement {
  // Clamp to [0,100] — callers may pass out-of-range values.
  const v = Math.max(0, Math.min(100, value));

  // Derive band from value if tone not provided; both paths resolve via TONE_TOKEN.
  const band: 'protected' | 'warning' | 'bypassed' = tone ?? scoreBandTone(v);
  const bandColor = TONE_TOKEN[band];
  const shouldShowTarget = showTargetMarker && target !== undefined;

  return (
    <div
      role="meter"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      style={{
        position: 'relative',
        width: '100%',
        height: `${height}px`,
        backgroundColor: 'var(--muted)',
        borderRadius: '4px',
        overflow: 'hidden',
      }}
    >
      {/* Fill bar */}
      <div
        data-slot="bullet-fill"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${v}%`,
          height: '100%',
          background: bandColor,
          transition: 'width 0.3s ease-out',
        }}
      />

      {/* Target marker */}
      {shouldShowTarget && (
        <div
          data-slot="bullet-target"
          style={{
            position: 'absolute',
            top: 0,
            left: `${target}%`,
            width: '2px',
            height: '100%',
            backgroundColor: 'var(--foreground)',
            opacity: 0.6,
            transform: 'translateX(-50%)',
          }}
        />
      )}
    </div>
  );
}
