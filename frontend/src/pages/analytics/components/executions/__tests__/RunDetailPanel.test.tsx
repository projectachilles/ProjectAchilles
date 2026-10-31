import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunDetailPanel } from '../RunDetailPanel';
import { emptyEndpointAlerts } from '../detailParts';
import type { BundleGroup } from '../shared';
import type { EnrichedTestExecution } from '@/services/api/analytics';

const BUNDLE = '7659eeba-f315-440e-9882-4aa015d68b27';

function stage(n: number, over: Partial<EnrichedTestExecution> = {}): EnrichedTestExecution {
  return {
    test_uuid: `${BUNDLE}::T${n}`,
    test_name: `Stage name ${n}`,
    hostname: 'LT8801',
    is_protected: false,
    org: 'o',
    timestamp: '2026-10-12T12:47:49Z',
    error_code: 101,
    error_name: 'Unprotected',
    category: 'intel-driven',
    is_bundle_control: true,
    bundle_id: BUNDLE,
    bundle_name: 'LockBit kill chain',
    control_validator: `Stage ${n}`,
    target: 'windows-endpoint',
    complexity: 'high',
    score: 8,
    tags: ['ransomware', 'lockbit'],
    ...over,
  };
}

function group(controls: EnrichedTestExecution[], over: Partial<BundleGroup> = {}): BundleGroup {
  return {
    type: 'bundle',
    key: `bundle::${BUNDLE}::LT8801`,
    bundle_id: BUNDLE,
    bundle_name: 'LockBit kill chain',
    hostname: 'LT8801',
    timestamp: '2026-10-12T12:47:49Z',
    controls,
    protectedCount: controls.filter((c) => [105, 126, 127].includes(c.error_code ?? -1)).length,
    unprotectedCount: controls.filter((c) => c.error_code === 101).length,
    totalCount: controls.length,
    category: 'intel-driven',
    ...over,
  };
}

const CHAIN = [
  stage(1, {
    control_id: 'T1059.001',
    tactics: ['execution'],
    defender_stage_detected: true,
    control_description: 'PowerShell recon and security-service stop attempts.',
  }),
  stage(2, { control_id: 'T1003.001', tactics: ['credential-access'], error_code: 126, error_name: 'ExecutionPrevented' }),
  stage(3, { control_id: 'T1021.002', tactics: ['lateral-movement'] }),
  stage(4, { control_id: 'T9999.999', error_code: 260, error_name: 'BlockedPreExecution' }),
];

function Harness({ row }: { row: BundleGroup }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  return (
    <RunDetailPanel
      row={row}
      defenderConfigured={false}
      endpointAlerts={emptyEndpointAlerts()}
      descriptionMap={new Map()}
      descriptionLoadingKey={null}
      alertsMap={new Map()}
      alertsLoading={new Set()}
      stageAlertsCacheKey={(e) => e.test_uuid}
      getAcceptanceForExec={() => undefined}
      riskEnabled
      archiveEnabled={false}
      onRequestAcceptRisk={vi.fn()}
      onRequestRevoke={vi.fn()}
      onRequestArchive={vi.fn()}
      onOpenInfo={vi.fn()}
      expandedControlIndex={expanded}
      onToggleControl={(i) => setExpanded((prev) => (prev === i ? null : i))}
    />
  );
}

/** The n-th stage row (rows are the list's buttons that carry aria-expanded). */
function row(n: number) {
  const list = screen.getByRole('list', { name: 'Stages' });
  return within(list).getAllByRole('button').filter((b) => b.hasAttribute('aria-expanded'))[n - 1];
}

describe('RunDetailPanel — attack-chain stage view (non-cyber-hygiene bundles)', () => {
  it('renders the strip in stage order, and selecting a node expands that row', async () => {
    render(<Harness row={group(CHAIN)} />);
    const strip = screen.getByRole('list', { name: 'Attack chain' });
    expect(within(strip).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Stage 1, Stage name 1: Detected',
      'Stage 2, Stage name 2: Protected',
      'Stage 3, Stage name 3: Unprotected',
      'Stage 4, Stage name 4: Stage not run',
    ]);
    expect(row(3)).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(within(strip).getByRole('button', { name: /^Stage 3,/ }));
    expect(row(3)).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Stage 3 details' })).toBeInTheDocument();
  });

  it('rows show the stage number, technique · name · tactic, and the EDR chip only with stage evidence', () => {
    render(<Harness row={group(CHAIN)} />);
    expect(row(1).textContent).toMatch(/^1Stage name 1/);
    expect(row(3).textContent).toMatch(/^3Stage name 3/);
    expect(row(1)).toHaveTextContent('T1059.001 · PowerShell · execution');
    expect(row(1)).toHaveTextContent('MDE alert');
    expect(row(2)).toHaveTextContent('T1003.001 · LSASS Memory · credential-access');
    expect(row(2)).not.toHaveTextContent('alert');
    expect(row(3)).not.toHaveTextContent('MDE');
  });

  it('expanded stage shows the verdict, result code, technique link and what the stage does', async () => {
    render(<Harness row={group(CHAIN)} />);
    await userEvent.click(row(1));
    const body = screen.getByRole('region', { name: 'Stage 1 details' });
    expect(within(body).getByText('Ran to completion. An EDR alerted but did not stop it.')).toBeInTheDocument();
    expect(
      within(body).getByText("Defender raised an alert naming this stage's binary; nothing was blocked."),
    ).toBeInTheDocument();
    expect(within(body).getByText('Unprotected (101)')).toBeInTheDocument();
    const link = within(body).getByRole('link', { name: /T1059\.001.*PowerShell/ });
    expect(link).toHaveAttribute('href', 'https://attack.mitre.org/techniques/T1059/001/');
    expect(within(body).getByText('What this stage does')).toBeInTheDocument();
    expect(within(body).getByText('PowerShell recon and security-service stop attempts.')).toBeInTheDocument();
  });

  it('omits "What this stage does" when the stage has no description', async () => {
    render(<Harness row={group(CHAIN)} />);
    await userEvent.click(row(3));
    const body = screen.getByRole('region', { name: 'Stage 3 details' });
    expect(within(body).queryByText('What this stage does')).toBeNull();
  });

  it('renders an unknown technique ID as bare text with no link', async () => {
    render(<Harness row={group(CHAIN)} />);
    await userEvent.click(row(4));
    const body = screen.getByRole('region', { name: 'Stage 4 details' });
    expect(within(body).getByText('T9999.999')).toBeInTheDocument();
    expect(within(body).queryByRole('link', { name: /T9999/ })).toBeNull();
    expect(body).not.toHaveTextContent('undefined');
  });

  it('stage body drops run-level fields; the header carries them', async () => {
    render(<Harness row={group(CHAIN)} />);
    await userEvent.click(row(2));
    const body = screen.getByRole('region', { name: 'Stage 2 details' });
    for (const label of ['Test UUID', 'Target', 'Complexity', 'Score', 'Executed']) {
      expect(within(body).queryByText(label)).toBeNull();
    }
    expect(within(body).queryByText('ransomware')).toBeNull();

    const header = screen.getByRole('region', { name: 'Run summary' });
    expect(
      within(header).getByText('1 protected · 1 detected · 1 unprotected · 1 not run'),
    ).toBeInTheDocument();
    expect(within(header).getByText(BUNDLE)).toBeInTheDocument();
    expect(within(header).getByText('8/10')).toBeInTheDocument();
    expect(within(header).getByText('windows-endpoint')).toBeInTheDocument();
    expect(within(header).getByText('high')).toBeInTheDocument();
    expect(within(header).getByText('ransomware')).toBeInTheDocument();
    expect(within(header).getByText('lockbit')).toBeInTheDocument();
    expect(within(header).queryByText(/\dP \/ \dF/)).toBeNull();
  });

  it('a 260 stage reads "Stage not run", never "Inconclusive"', async () => {
    render(<Harness row={group(CHAIN)} />);
    expect(row(4)).toHaveTextContent('Stage not run');
    expect(row(4)).not.toHaveTextContent('Inconclusive');
    await userEvent.click(row(4));
    const body = screen.getByRole('region', { name: 'Stage 4 details' });
    expect(
      within(body).getByText('Stage not run: a control blocked the test binary before it ran.'),
    ).toBeInTheDocument();
    expect(within(body).getByText('BlockedPreExecution (260)')).toBeInTheDocument();
  });
});

describe('RunDetailPanel — cyber-hygiene bundles keep the ratio view', () => {
  it('renders the ratio bar and control rows, and no strip', async () => {
    const ch = [
      stage(1, { category: 'cyber-hygiene', control_validator: 'Defender', control_id: 'CH-DEF-001', error_code: 126 }),
      stage(2, { category: 'cyber-hygiene', control_validator: 'Defender', control_id: 'CH-DEF-002' }),
    ];
    render(<Harness row={group(ch, { category: 'cyber-hygiene' })} />);
    expect(screen.queryByRole('list', { name: 'Attack chain' })).toBeNull();
    expect(screen.getByText('Controls')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByText('1P / 1F')).toBeInTheDocument();
    // The control body keeps its own metadata (unchanged layout).
    await userEvent.click(screen.getByText('Stage name 1'));
    expect(screen.getByText('Test UUID')).toBeInTheDocument();
    expect(screen.getByText('Validator')).toBeInTheDocument();
  });
});

describe('RunDetailPanel — EDR-killed run', () => {
  const killed = {
  test_uuid: 'u1', test_name: 'LockBit kill chain', hostname: 'LT8801', is_protected: true, org: 'o',
  timestamp: '2026-10-12T12:47:49Z', error_code: 126, error_name: 'ExecutionPrevented',
  bundle_id: 'b1', bundle_name: 'LockBit kill chain', is_bundle_control: false,
  edr_terminated: true, edr_terminated_vendors: ['sentinelone', 'defender'],
  edr_terminated_alert_ids: ['s1-alert-1', 'mde-9'], stages_unknown: true,
} as EnrichedTestExecution;

  function renderKilled() {
    render(
      <RunDetailPanel
        row={{ type: 'standalone', key: 'k', execution: killed }}
        defenderConfigured
        endpointAlerts={emptyEndpointAlerts()}
        descriptionMap={new Map()}
        descriptionLoadingKey={null}
        alertsMap={new Map()}
        alertsLoading={new Set()}
        stageAlertsCacheKey={(e) => e.test_uuid}
        getAcceptanceForExec={() => undefined}
        riskEnabled
        archiveEnabled={false}
        onRequestAcceptRisk={vi.fn()}
        onRequestRevoke={vi.fn()}
        onRequestArchive={vi.fn()}
        onOpenInfo={vi.fn()}
        expandedControlIndex={null}
        onToggleControl={vi.fn()}
      />,
    );
  }

  it('shows the note and alert ids and no stages', () => {
    renderKilled();
    expect(
      screen.getByText(
        'SentinelOne and Defender terminated the Achilles agent while this test was running, so the test could not report which stages ran. The run counts as protected for the test as a whole; stages are unknown.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Evidence alert(s)')).toBeInTheDocument();
    expect(screen.getByText('s1-alert-1')).toBeInTheDocument();
    expect(screen.getByText('mde-9')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Stages' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Attack chain' })).not.toBeInTheDocument();
    expect(screen.queryByText('Defender Alerts')).not.toBeInTheDocument();
  });
});

describe('RunDetailPanel — EDR launch block', () => {
  const blocked = {
    test_uuid: 'c0ffee00-1234-4abc-8def-000000000001', test_name: 'Example Orchestrated Test', hostname: 'WS-0042',
    is_protected: true, org: 'o', timestamp: '2026-10-27T10:00:00Z', error_code: 126, error_name: 'ExecutionPrevented',
    techniques: ['T1105'], is_bundle_control: false,
    edr_launch_blocked: true, launch_block_vendors: ['crowdstrike'], launch_block_alert_ids: ['cs-alert-1'],
    crowdstrike_detected: true, crowdstrike_prevented: true, crowdstrike_prevention_action: 'quarantined',
  } as EnrichedTestExecution;

  function renderBlocked(loadedAlertId = 'falcon-1') {
    const endpointAlerts = emptyEndpointAlerts();
    endpointAlerts.crowdstrike.configured = true;
    // The orchestrator alert is bundle-attributed (no stage binary in its evidence).
    endpointAlerts.crowdstrike.map.set('k', {
      alerts: [{
        alert_id: loadedAlertId, alert_title: 'Machine Learning: sensor-based ML', severity: 'high', status: 'new',
        attribution: 'bundle', prevention_action: 'quarantined', created_at: '2026-10-27T10:01:00Z',
      }],
    } as never);
    render(
      <RunDetailPanel
        row={{ type: 'standalone', key: 'k', execution: blocked }}
        defenderConfigured={false}
        endpointAlerts={endpointAlerts}
        descriptionMap={new Map()}
        descriptionLoadingKey={null}
        alertsMap={new Map()}
        alertsLoading={new Set()}
        stageAlertsCacheKey={() => 'k'}
        getAcceptanceForExec={() => undefined}
        riskEnabled
        archiveEnabled={false}
        onRequestAcceptRisk={vi.fn()}
        onRequestRevoke={vi.fn()}
        onRequestArchive={vi.fn()}
        onOpenInfo={vi.fn()}
        expandedControlIndex={null}
        onToggleControl={vi.fn()}
      />,
    );
  }

  it('explains the block, lists the evidence alert ids and shows the vendor alert', () => {
    renderBlocked();
    expect(
      screen.getByText(
        'CrowdStrike Falcon blocked this test before it ran, and its own prevention alert confirms it. The run counts as protected for the test as a whole; no stage ran, so no technique is scored.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Evidence alert(s)')).toBeInTheDocument();
    expect(screen.getByText('cs-alert-1')).toBeInTheDocument();
    expect(screen.getByText('Machine Learning: sensor-based ML')).toBeInTheDocument();
  });

  it('says next to the result code that the agent reported 260 and the EDR alert set 126', () => {
    renderBlocked();
    expect(screen.getByText('ExecutionPrevented (126)')).toBeInTheDocument();
    expect(screen.getByText("Agent reported 260 (BlockedPreExecution); set to 126 by the EDR's alert")).toBeInTheDocument();
  });

  it('shows a loaded evidence alert as an alert row, not its raw id', () => {
    renderBlocked('cs-alert-1');
    const evidence = screen.getByRole('list', { name: 'Evidence alerts' });
    expect(within(evidence).getByText('Machine Learning: sensor-based ML')).toBeInTheDocument();
    expect(within(evidence).getByText('quarantined', { exact: false })).toBeInTheDocument();
    expect(within(evidence).queryByText('cs-alert-1')).not.toBeInTheDocument();
  });

  it('falls back to the raw id while the evidence alert is not loaded', () => {
    renderBlocked('some-other-alert');
    const evidence = screen.getByRole('list', { name: 'Evidence alerts' });
    expect(within(evidence).getByText('cs-alert-1')).toBeInTheDocument();
  });
});

describe('RunDetailPanel — a failed alert lookup', () => {
  // A lookup that failed (HTTP error) is stored as null; a lookup that found
  // nothing is { alerts: [] }. Only the second may read "No related alerts".
  const standalone = {
    test_uuid: 'c0ffee00-1234-4abc-8def-000000000002', test_name: 'Example Test', hostname: 'WS-0042',
    is_protected: true, org: 'o', timestamp: '2026-10-27T10:00:00Z', error_code: 105, error_name: 'FileQuarantinedOnExtraction',
    techniques: ['T1068'], is_bundle_control: false,
  } as EnrichedTestExecution;

  function renderRow(row: Parameters<typeof RunDetailPanel>[0]['row'], expandedControlIndex: number | null = null) {
    const endpointAlerts = emptyEndpointAlerts();
    endpointAlerts.crowdstrike.configured = true;
    endpointAlerts.crowdstrike.map.set('k', null);
    endpointAlerts.sentinelone.configured = true;
    endpointAlerts.sentinelone.map.set('k', { alerts: [] } as never);
    render(
      <RunDetailPanel
        row={row}
        defenderConfigured
        endpointAlerts={endpointAlerts}
        descriptionMap={new Map()}
        descriptionLoadingKey={null}
        alertsMap={new Map([['k', null]])}
        alertsLoading={new Set()}
        stageAlertsCacheKey={() => 'k'}
        getAcceptanceForExec={() => undefined}
        riskEnabled
        archiveEnabled={false}
        onRequestAcceptRisk={vi.fn()}
        onRequestRevoke={vi.fn()}
        onRequestArchive={vi.fn()}
        onOpenInfo={vi.fn()}
        expandedControlIndex={expandedControlIndex}
        onToggleControl={vi.fn()}
      />,
    );
  }

  it('says the lookup failed instead of "No related alerts" (standalone run)', () => {
    renderRow({ type: 'standalone', key: 'k', execution: standalone });
    expect(screen.getByText(/Couldn't load CrowdStrike alerts/)).toBeInTheDocument();
    expect(screen.getByText(/Couldn't load Defender alerts/)).toBeInTheDocument();
    expect(screen.queryByText('No related CrowdStrike alerts within the time window')).not.toBeInTheDocument();
    // A lookup that succeeded with no hits still reads as no alerts.
    expect(screen.getByText('No related SentinelOne alerts within the time window')).toBeInTheDocument();
  });

  it('names the vendors whose lookup failed in a stage\'s EDR evidence', () => {
    renderRow(group([stage(1, { control_id: 'T1059.001', techniques: ['T1059.001'] })]), 0);
    const evidence = screen.getByText('EDR evidence for this stage').parentElement!;
    expect(within(evidence).getByText(/Couldn't load Defender or CrowdStrike alerts/)).toBeInTheDocument();
  });
});
