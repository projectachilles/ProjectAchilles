/**
 * `achilles deploy` interactive wizard (Ink).
 *
 * Phases: mode → target → prereqs → inputs → run → summary. Each phase is a
 * small component; the top-level `DeployWizard` owns the shared state and the
 * transitions between them. Models the structure on cli/src/chat/view.tsx.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import { SelectList } from './components/SelectList.js';
import { Form } from './components/Form.js';
import { fieldsFromSchema } from './schema-form.js';
import { getAllProviders, providersForMode } from './registry.js';
import { runPlan, type StepResult } from './runner.js';
import { findRepoRoot } from './run.js';
import type { DeployMode, DeployProvider, LogLine, Prereq, Step } from './types.js';

type Phase = 'mode' | 'target' | 'prereqs' | 'inputs' | 'run' | 'summary';

export interface WizardProps {
  /** Pre-seed mode (skips the mode picker). */
  initialMode?: DeployMode;
  /** Pre-seed provider id (skips mode + target pickers). */
  initialTarget?: string;
}

export function DeployWizard({ initialMode, initialTarget }: WizardProps) {
  const seeded = initialTarget ? getAllProviders().find((p) => p.id === initialTarget) : undefined;

  const [phase, setPhase] = useState<Phase>(
    seeded ? 'prereqs' : initialMode ? 'target' : 'mode',
  );
  const [mode, setMode] = useState<DeployMode>(initialMode ?? seeded?.modes[0] ?? 'self-host');
  const [provider, setProvider] = useState<DeployProvider | undefined>(seeded);
  const [inputs, setInputs] = useState<Record<string, unknown>>({});

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header phase={phase} mode={mode} provider={provider} />

      {phase === 'mode' && (
        <ModePhase
          onSelect={(m) => {
            setMode(m);
            setPhase('target');
          }}
        />
      )}

      {phase === 'target' && (
        <TargetPhase
          mode={mode}
          onSelect={(p) => {
            setProvider(p);
            setPhase('prereqs');
          }}
        />
      )}

      {phase === 'prereqs' && provider && (
        <PrereqPhase
          provider={provider}
          onContinue={() => setPhase('inputs')}
        />
      )}

      {phase === 'inputs' && provider && (
        <InputsPhase
          provider={provider}
          onComplete={(values) => {
            setInputs(values);
            setPhase('run');
          }}
        />
      )}

      {phase === 'run' && provider && (
        <RunPhase
          provider={provider}
          inputs={inputs}
          onDone={() => setPhase('summary')}
        />
      )}
    </Box>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

function Header({
  phase,
  mode,
  provider,
}: {
  phase: Phase;
  mode: DeployMode;
  provider?: DeployProvider;
}) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="green" bold>
        ◆ Achilles Deploy
      </Text>
      <Text dimColor>
        {`mode: ${mode}`}
        {provider ? `  ·  target: ${provider.label}` : ''}
        {`  ·  ${phase}`}
      </Text>
    </Box>
  );
}

// ─── Mode phase ─────────────────────────────────────────────────────────────

function ModePhase({ onSelect }: { onSelect: (m: DeployMode) => void }) {
  return (
    <Box flexDirection="column">
      <Text>Choose a deployment mode:</Text>
      <Box marginTop={1}>
        <SelectList<DeployMode>
          items={[
            {
              label: 'Self-host',
              value: 'self-host',
              description: 'Stand up your own instance (Docker, server, or PaaS)',
            },
            {
              label: 'Operator',
              value: 'operator',
              description: 'Full DigitalOcean automation (multi-droplet)',
            },
          ]}
          onSelect={onSelect}
        />
      </Box>
    </Box>
  );
}

// ─── Target phase ───────────────────────────────────────────────────────────

function TargetPhase({
  mode,
  onSelect,
}: {
  mode: DeployMode;
  onSelect: (p: DeployProvider) => void;
}) {
  const providers = providersForMode(mode);
  return (
    <Box flexDirection="column">
      <Text>Choose a target:</Text>
      <Box marginTop={1}>
        <SelectList<DeployProvider>
          items={providers.map((p) => ({
            label: p.label,
            value: p,
            description: p.summary,
          }))}
          onSelect={onSelect}
        />
      </Box>
    </Box>
  );
}

// ─── Prereq phase ───────────────────────────────────────────────────────────

function PrereqPhase({
  provider,
  onContinue,
}: {
  provider: DeployProvider;
  onContinue: () => void;
}) {
  const [prereqs, setPrereqs] = useState<Prereq[] | null>(null);
  const { exit } = useApp();

  useEffect(() => {
    let alive = true;
    provider.checkPrereqs().then((p) => {
      if (alive) setPrereqs(p);
    });
    return () => {
      alive = false;
    };
  }, [provider]);

  const blocked = prereqs?.some((p) => p.required && !p.ok) ?? false;

  useInput((input, key) => {
    if (!prereqs) return;
    if (key.return && !blocked) onContinue();
    if (input === 'q' || key.escape) exit();
  });

  if (!prereqs) {
    return (
      <Box>
        <Text color="green">
          <Spinner type="dots" />
        </Text>
        <Text> Checking prerequisites…</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Prerequisites</Text>
      <Box flexDirection="column" marginTop={1}>
        {prereqs.length === 0 && <Text dimColor>  None — this target is dashboard/Git-driven.</Text>}
        {prereqs.map((p) => (
          <Box key={p.id} flexDirection="column">
            <Box>
              <Text color={p.ok ? 'green' : p.required ? 'red' : 'yellow'}>
                {p.ok ? '  ✓ ' : p.required ? '  ✗ ' : '  ○ '}
              </Text>
              <Text>{p.label}</Text>
            </Box>
            {!p.ok && p.hint && <Text dimColor>{`      ${p.hint}`}</Text>}
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        {blocked ? (
          <Text color="red">Resolve the required prerequisites above, then re-run. (q to quit)</Text>
        ) : (
          <Text dimColor>Press Enter to continue · q to quit</Text>
        )}
      </Box>
    </Box>
  );
}

// ─── Inputs phase ───────────────────────────────────────────────────────────

function InputsPhase({
  provider,
  onComplete,
}: {
  provider: DeployProvider;
  onComplete: (values: Record<string, unknown>) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const fields = fieldsFromSchema(provider.inputSchema());

  const handleComplete = (raw: Record<string, unknown>) => {
    const parsed = provider.inputSchema().safeParse(raw);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }
    onComplete(parsed.data as Record<string, unknown>);
  };

  return (
    <Box flexDirection="column">
      <Text bold>Configuration</Text>
      <Box marginTop={1}>
        <Form fields={fields} onComplete={handleComplete} />
      </Box>
      {error && (
        <Box marginTop={1}>
          <Text color="red">{`✗ ${error} — re-enter the values.`}</Text>
        </Box>
      )}
    </Box>
  );
}

// ─── Run phase ──────────────────────────────────────────────────────────────

interface RunState {
  logs: LogLine[];
  currentStep?: { step: Step; index: number; total: number };
  results: StepResult[];
  done: boolean;
  ok: boolean;
  awaitingManual?: Step;
}

function RunPhase({
  provider,
  inputs,
  onDone,
}: {
  provider: DeployProvider;
  inputs: Record<string, unknown>;
  onDone: () => void;
}) {
  const [state, setState] = useState<RunState>({
    logs: [],
    results: [],
    done: false,
    ok: false,
  });
  const { exit } = useApp();
  const { stdout } = useStdout();
  const confirmResolver = useRef<((v: boolean) => void) | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const repoRoot = findRepoRoot();
    runPlan(provider, inputs, repoRoot, false, {
      onLog: (line) =>
        setState((s) => ({ ...s, logs: [...s.logs, line].slice(-500) })),
      onStepStart: (step, index, total) =>
        setState((s) => ({ ...s, currentStep: { step, index, total } })),
      onStepDone: (result) =>
        setState((s) => ({ ...s, results: [...s.results, result] })),
      confirmManual: (step) =>
        new Promise<boolean>((resolve) => {
          confirmResolver.current = resolve;
          setState((s) => ({ ...s, awaitingManual: step }));
        }),
    }).then((res) => {
      setState((s) => ({ ...s, done: true, ok: res.ok, currentStep: undefined }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useInput((_input, key) => {
    if (state.awaitingManual && confirmResolver.current) {
      const resolve = confirmResolver.current;
      confirmResolver.current = null;
      setState((s) => ({ ...s, awaitingManual: undefined }));
      resolve(!key.escape); // Enter continues, Esc aborts
      return;
    }
    if (state.done && key.return) {
      onDone();
      exit();
    }
  });

  const termHeight = stdout?.rows ?? 24;
  const maxLogLines = Math.max(6, termHeight - 12);
  const visibleLogs = state.logs.slice(-maxLogLines);

  return (
    <Box flexDirection="column">
      {state.currentStep && !state.done && (
        <Box marginBottom={1}>
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Text>
            {` [${state.currentStep.index + 1}/${state.currentStep.total}] ${state.currentStep.step.title}`}
          </Text>
        </Box>
      )}

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        {visibleLogs.length === 0 ? (
          <Text dimColor>Starting…</Text>
        ) : (
          visibleLogs.map((line, i) => (
            <Text
              key={`log-${i}`}
              color={line.stream === 'err' ? 'red' : line.stream === 'info' ? 'cyan' : undefined}
              dimColor={line.stream === 'out'}
            >
              {line.text || ' '}
            </Text>
          ))
        )}
      </Box>

      {state.awaitingManual && (
        <Box marginTop={1}>
          <Text color="yellow">
            {`⏸ Manual step "${state.awaitingManual.title}" — do the above, then press Enter to continue (Esc to abort).`}
          </Text>
        </Box>
      )}

      {state.done && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={state.ok ? 'green' : 'red'} bold>
            {state.ok ? '✓ Deployment steps complete.' : '✗ Deployment stopped — see logs above.'}
          </Text>
          <Text dimColor>Press Enter to exit.</Text>
        </Box>
      )}
    </Box>
  );
}
