/**
 * Analytics dashboard view — defense score, trend, top tests.
 */

import { useKeyboard } from '@opentui/react';
import { Spinner } from '../components/Spinner.js';
import { ScoreBadge } from '../components/ScoreBadge.js';
import { usePolling } from '../hooks/usePolling.js';
import * as analyticsApi from '../../api/analytics.js';

interface AnalyticsViewProps {
  height: number;
}

export function AnalyticsView({ height }: AnalyticsViewProps) {
  const score = usePolling(() => analyticsApi.getDefenseScore(), 30000);
  const byTest = usePolling(() => analyticsApi.getScoreByTest({ limit: 10 }), 30000);
  const byTechnique = usePolling(() => analyticsApi.getScoreByTechnique(), 30000);

  useKeyboard((event) => {
    if (event.name === 'r') {
      score.refresh();
      byTest.refresh();
      byTechnique.refresh();
    }
  });

  if (score.loading && !score.data) {
    return <Spinner message="Loading analytics..." />;
  }

  if (score.error) {
    return (
      <box padding={1}>
        <text fg="#6c6c8a">Analytics not configured. Run: achilles config set server_url &lt;url&gt;</text>
      </box>
    );
  }

  return (
    <box flexDirection="column" padding={1} height={height}>
      {/* Score summary */}
      {score.data && (
        <box flexDirection="column" border={true} borderStyle="single" borderColor="#16213e" padding={1} height={4}>
          <ScoreBadge score={score.data.score} width={40} />
          <text fg="#6c6c8a">{`${String(score.data.protectedCount)} protected / ${String(score.data.unprotectedCount)} unprotected / ${String(score.data.totalExecutions)} total`}</text>
        </box>
      )}

      {/* Side by side: by test + by technique */}
      <box flexDirection="row" flexGrow={1} marginTop={1} gap={1}>
        {/* By Test */}
        <box flexDirection="column" border={true} borderStyle="single" borderColor="#16213e" padding={1} width="50%">
          <text fg="#e94560">Score by Test</text>
          {byTest.data ? (
            <box flexDirection="column" marginTop={1}>
              {byTest.data.slice(0, Math.floor((height - 8) / 1)).map((item, idx) => {
                const testName = String((item as Record<string, unknown>).testName ?? (item as Record<string, unknown>).test_name ?? `#${idx}`);
                const score = Number((item as Record<string, unknown>).score ?? 0);
                const barLen = Math.round((score / 100) * 15);
                const bar = '█'.repeat(barLen) + '░'.repeat(15 - barLen);
                const color = score >= 80 ? '#16c79a' : score >= 60 ? '#f5c518' : '#e94560';
                return (
                  <box key={testName} flexDirection="row" height={1}>
                    <text fg="#a0a0b8">{`${testName.padEnd(18).slice(0, 18)} `}</text>
                    <text fg={color}>{`${String(Math.round(score)).padStart(3)}% ${bar}`}</text>
                  </box>
                );
              })}
            </box>
          ) : (
            <Spinner message="Loading..." />
          )}
        </box>

        {/* By Technique */}
        <box flexDirection="column" border={true} borderStyle="single" borderColor="#16213e" padding={1} width="50%">
          <text fg="#e94560">Score by Technique</text>
          {byTechnique.data ? (
            <box flexDirection="column" marginTop={1}>
              {byTechnique.data.slice(0, Math.floor((height - 8) / 1)).map((item, idx) => {
                const technique = String((item as Record<string, unknown>).technique ?? (item as Record<string, unknown>).key ?? `#${idx}`);
                const score = Number((item as Record<string, unknown>).score ?? 0);
                const barLen = Math.round((score / 100) * 15);
                const bar = '█'.repeat(barLen) + '░'.repeat(15 - barLen);
                const color = score >= 80 ? '#16c79a' : score >= 60 ? '#f5c518' : '#e94560';
                return (
                  <box key={technique} flexDirection="row" height={1}>
                    <text fg="#a0a0b8">{`${technique.padEnd(12).slice(0, 12)} `}</text>
                    <text fg={color}>{`${String(Math.round(score)).padStart(3)}% ${bar}`}</text>
                  </box>
                );
              })}
            </box>
          ) : (
            <Spinner message="Loading..." />
          )}
        </box>
      </box>
    </box>
  );
}
