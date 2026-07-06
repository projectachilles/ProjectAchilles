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
  // Derive band color from value if tone not provided
  const getBandColor = (): string => {
    if (tone) {
      return `var(--chart-${tone})`;
    }
    if (value >= 80) return 'var(--chart-protected)';
    if (value >= 50) return 'var(--chart-warn)';
    return 'var(--chart-bypassed)';
  };

  const bandColor = getBandColor();
  const shouldShowTarget = showTargetMarker && target !== undefined;

  return (
    <div
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      style={{
        position: 'relative',
        width: '100%',
        height: `${height}px`,
        backgroundColor: 'var(--track)',
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
          width: `${value}%`,
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
