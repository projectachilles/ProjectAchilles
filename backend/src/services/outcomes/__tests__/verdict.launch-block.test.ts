import { describe, it, expect } from 'vitest';
import { cellVerdict, type VerdictInput } from '../verdict.js';
import { SOURCE_FIELDS, type EdrDocs } from '../edr.js';

// A run the EDR blocked at launch: SQLite keeps the agent's exit 260, while
// the result doc in Elasticsearch was rewritten to 126 by the launch-block
// reconciliation pass. Campaign cells and the Finished email read the doc.

const edr = (docs: Record<string, Record<string, unknown>> = {}): EdrDocs => ({ status: 'ok', docs: new Map(Object.entries(docs)) });

const base = (o: Partial<VerdictInput>): VerdictInput => ({
  taskId: 't1', exitCode: 260, error: null, stderrTail: null, category: 'intel-driven', controls: null, edr: edr(), ...o,
});

const resolvedDoc = {
  event: { ERROR: 126 },
  f0rtika: {
    category: 'intel-driven',
    is_protected: true,
    edr_launch_blocked: true,
    launch_block: { original_exit_code: 260, vendors: ['crowdstrike'], alert_ids: ['cs-1'] },
    crowdstrike_detected: true,
    crowdstrike_prevented: true,
    crowdstrike_prevention_action: 'quarantined',
  },
};

describe('cellVerdict: EDR launch block', () => {
  it('reads Protected, naming the EDR that blocked the launch', () => {
    const v = cellVerdict(base({ edr: edr({ t1: resolvedDoc }) }));
    expect(v.state).toBe('protected');
    expect(v.reason).toBe("Blocked before it ran by CrowdStrike; the EDR's own alert confirms it (exit 260).");
    expect(v.edr).toBe('CrowdStrike: prevented (quarantined)');
  });

  it('an unresolved 260 stays an error, with vendor-neutral wording', () => {
    const v = cellVerdict(base({}));
    expect(v.state).toBe('error');
    expect(v.reason).toBe('Exit 260: blocked before execution by an EDR/AV or app control (e.g. Defender ASR), technique not evaluated.');
  });

  it('fetches the launch-block fields with the result docs', () => {
    expect(SOURCE_FIELDS).toEqual(expect.arrayContaining(['f0rtika.edr_launch_blocked', 'f0rtika.launch_block.vendors']));
  });
});
