import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MetadataExtractor } from '../metadataExtractor.js';

// ── Helpers ──────────────────────────────────────────────────────────

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-test-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function writeGoFile(uuid: string, headerContent: string, constantsContent?: string): string {
  const filePath = path.join(tempDir, `${uuid}.go`);
  let content = '';
  if (headerContent) {
    content += `/*\n${headerContent}\n*/\n\n`;
  }
  content += 'package main\n\n';
  if (constantsContent) {
    content += `const (\n${constantsContent}\n)\n\n`;
  }
  content += 'func main() {}\n';
  fs.writeFileSync(filePath, content);
  return filePath;
}

function writeReadme(content: string): string {
  const filePath = path.join(tempDir, 'README.md');
  fs.writeFileSync(filePath, content);
  return filePath;
}

function writeInfoCard(uuid: string, content: string): string {
  const filePath = path.join(tempDir, `${uuid}_info.md`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

function writeStageFile(technique: string, content: string): string {
  const filePath = path.join(tempDir, `stage-${technique}.go`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('MetadataExtractor', () => {
  // ── Group 1: extractFromGoFile ─────────────────────────────

  describe('extractFromGoFile', () => {
    it('extracts all fields from a complete header comment', () => {
      const filePath = writeGoFile('abc-123', `
  ID: abc-123
  NAME: Process Injection Test
  TECHNIQUES: T1055, T1055.001
  TACTICS: TA0005, TA0004
  SEVERITY: High
  TARGET: windows-endpoint
  COMPLEXITY: Medium
  THREAT_ACTOR: APT29
  SUBCATEGORY: dll-injection
  TAGS: edr-test, purple-team
  AUTHOR: testuser
  CREATED: 2025-01-15
  UNIT: red-team-ops
`);

      const result = MetadataExtractor.extractFromGoFile(filePath);

      expect(result.uuid).toBe('abc-123');
      expect(result.name).toBe('Process Injection Test');
      expect(result.techniques).toEqual(['T1055', 'T1055.001']);
      expect(result.tactics).toEqual(['TA0005', 'TA0004']);
      expect(result.severity).toBe('high');
      expect(result.target).toEqual(['windows-endpoint']);
      expect(result.complexity).toBe('medium');
      expect(result.threatActor).toBe('APT29');
      expect(result.subcategory).toBe('dll-injection');
      expect(result.tags).toEqual(['edr-test', 'purple-team']);
      expect(result.author).toBe('testuser');
      expect(result.createdDate).toBe('2025-01-15');
      expect(result.unit).toBe('red-team-ops');
    });

    it('extracts UUID/name from const() block when header missing', () => {
      const filePath = writeGoFile('def-456', '', `
  TEST_UUID = "def-456"
  TEST_NAME = "Credential Dumping"
`);

      const result = MetadataExtractor.extractFromGoFile(filePath);

      expect(result.uuid).toBe('def-456');
      expect(result.name).toBe('Credential Dumping');
    });

    it('handles legacy singular TECHNIQUE: (no S)', () => {
      const filePath = writeGoFile('legacy-1', `
  TECHNIQUE: T1059
`);

      const result = MetadataExtractor.extractFromGoFile(filePath);

      expect(result.techniques).toEqual(['T1059']);
    });

    it('splits comma-separated techniques and filters empties', () => {
      const filePath = writeGoFile('multi-tech', `
  TECHNIQUES: T1055, T1059, , T1003
`);

      const result = MetadataExtractor.extractFromGoFile(filePath);

      expect(result.techniques).toEqual(['T1055', 'T1059', 'T1003']);
    });

    it('converts THREAT_ACTOR: N/A to undefined', () => {
      const filePath = writeGoFile('no-actor', `
  THREAT_ACTOR: N/A
`);

      const result = MetadataExtractor.extractFromGoFile(filePath);

      expect(result.threatActor).toBeUndefined();
    });

    it('lowercases severity and complexity', () => {
      const filePath = writeGoFile('case-test', `
  SEVERITY: CRITICAL
  COMPLEXITY: HIGH
`);

      const result = MetadataExtractor.extractFromGoFile(filePath);

      expect(result.severity).toBe('critical');
      expect(result.complexity).toBe('high');
    });

    it('returns default empty arrays for missing file fields', () => {
      const filePath = writeGoFile('minimal', '');

      const result = MetadataExtractor.extractFromGoFile(filePath);

      expect(result.techniques).toEqual([]);
      expect(result.tactics).toEqual([]);
      expect(result.tags).toEqual([]);
      expect(result.isMultiStage).toBe(false);
    });

    it('handles file with only ID in header', () => {
      // No NAME, TECHNIQUES etc. — only ID present
      const filePath = writeGoFile('minimal-header', `
  ID: aabb-ccdd-ee00
`);

      const result = MetadataExtractor.extractFromGoFile(filePath);

      expect(result.uuid).toBe('aabb-ccdd-ee00');
      expect(result.name).toBeUndefined();
      expect(result.severity).toBeUndefined();
      expect(result.techniques).toEqual([]);
    });

    it('header values take precedence over constants for uuid/name', () => {
      // ID regex requires hex chars only: [a-f0-9-]+
      const filePath = writeGoFile('aabb-1122', `
  ID: aabb-1122-3344
  NAME: Header Name
`, `
  TEST_UUID = "ccdd-5566-7788"
  TEST_NAME = "Const Name"
`);

      const result = MetadataExtractor.extractFromGoFile(filePath);

      // Header values should win (const extraction has `&& !metadata.uuid` guard)
      expect(result.uuid).toBe('aabb-1122-3344');
      expect(result.name).toBe('Header Name');
    });

    it('handles sub-techniques like T1055.001', () => {
      const filePath = writeGoFile('sub-tech', `
  TECHNIQUES: T1055.001, T1059.003
`);

      const result = MetadataExtractor.extractFromGoFile(filePath);

      expect(result.techniques).toEqual(['T1055.001', 'T1059.003']);
    });

    it('handles TACTIC singular form', () => {
      const filePath = writeGoFile('tactic-singular', `
  TACTIC: TA0005
`);

      const result = MetadataExtractor.extractFromGoFile(filePath);

      expect(result.tactics).toEqual(['TA0005']);
    });
  });

  // ── Group 2: extractFromReadme ─────────────────────────────

  describe('extractFromReadme', () => {
    it('extracts score from **Test Score**: **8.5/10**', () => {
      const filePath = writeReadme(`
# Test Name

**Test Score**: **8.5/10**

## Overview
Some description here.
`);

      const result = MetadataExtractor.extractFromReadme(filePath);

      expect(result.score).toBe(8.5);
    });

    it('extracts description from ## Overview section', () => {
      const filePath = writeReadme(`
# Test Name

## Overview
This is a comprehensive test for process injection techniques.

It validates multiple vectors.

## Details
More info here.
`);

      const result = MetadataExtractor.extractFromReadme(filePath);

      expect(result.description).toBe('This is a comprehensive test for process injection techniques.');
    });

    it('extracts techniques with stage prefix (**Stage 1 - T1055**:)', () => {
      const filePath = writeReadme(`
# Test

## MITRE ATT&CK Mapping

**Stage 1 - T1055**: Process Injection
**Stage 2 - T1055.001**: DLL Injection
`);

      const result = MetadataExtractor.extractFromReadme(filePath);

      expect(result.techniques).toEqual(['T1055', 'T1055.001']);
    });

    it('extracts techniques without stage prefix', () => {
      const filePath = writeReadme(`
# Test

## MITRE ATT&CK Mapping

**T1059**: Command Execution
**T1003.001**: LSASS Memory
`);

      const result = MetadataExtractor.extractFromReadme(filePath);

      expect(result.techniques).toEqual(['T1059', 'T1003.001']);
    });

    it('returns empty object for missing README', () => {
      const missing = path.join(tempDir, 'nonexistent', 'README.md');

      // readFileSync will throw → test the behavior
      expect(() => MetadataExtractor.extractFromReadme(missing)).toThrow();
    });

    it('returns no score if not present in README', () => {
      const filePath = writeReadme(`
# Test Name

## Overview
A simple test.
`);

      const result = MetadataExtractor.extractFromReadme(filePath);

      expect(result.score).toBeUndefined();
    });
  });

  // ── Group 3: extractFromInfoCard ───────────────────────────

  describe('extractFromInfoCard', () => {
    it('extracts category, severity, techniques, and score', () => {
      const filePath = writeInfoCard('test-uuid', `
# Test Info

**Category**: defense_evasion
**Severity**: Critical
**MITRE ATT&CK**: T1055, T1059

## Test Score: 8.5/10
`);

      const result = MetadataExtractor.extractFromInfoCard(filePath);

      expect(result.category).toBe('defense_evasion');
      expect(result.severity).toBe('Critical');
      expect(result.techniques).toEqual(['T1055', 'T1059']);
      expect(result.score).toBe(8.5);
    });

    it('extracts all 5 scoreBreakdown metrics from table', () => {
      const filePath = writeInfoCard('score-uuid', `
# Info

## Test Score: 9.0/10

| Metric | Score |
|--------|-------|
| **Real-World Accuracy** | **8.5/10** |
| **Technical Sophistication** | **9.0/10** |
| **Safety Mechanisms** | **7.5/10** |
| **Detection Opportunities** | **8.0/10** |
| **Logging & Observability** | **9.5/10** |
`);

      const result = MetadataExtractor.extractFromInfoCard(filePath);

      expect(result.scoreBreakdown).toEqual({
        realWorldAccuracy: 8.5,
        technicalSophistication: 9.0,
        safetyMechanisms: 7.5,
        detectionOpportunities: 8.0,
        loggingObservability: 9.5,
      });
    });

    it('handles partial scoreBreakdown (some rows present)', () => {
      const filePath = writeInfoCard('partial-uuid', `
# Info

| Metric | Score |
|--------|-------|
| **Real-World Accuracy** | **8.5/10** |
| **Safety Mechanisms** | **7.5/10** |
`);

      const result = MetadataExtractor.extractFromInfoCard(filePath);

      expect(result.scoreBreakdown!.realWorldAccuracy).toBe(8.5);
      expect(result.scoreBreakdown!.safetyMechanisms).toBe(7.5);
      expect(result.scoreBreakdown!.technicalSophistication).toBeUndefined();
      expect(result.scoreBreakdown!.detectionOpportunities).toBeUndefined();
      expect(result.scoreBreakdown!.loggingObservability).toBeUndefined();
    });

    it('returns empty scoreBreakdown when no table', () => {
      const filePath = writeInfoCard('no-table-uuid', `
# Info

**Category**: credential_access
`);

      const result = MetadataExtractor.extractFromInfoCard(filePath);

      expect(result.scoreBreakdown).toEqual({});
    });

    it('handles missing info card file', () => {
      const missing = path.join(tempDir, 'nonexistent_info.md');

      expect(() => MetadataExtractor.extractFromInfoCard(missing)).toThrow();
    });
  });

  // ── Group 4: extractStageInfo ──────────────────────────────

  describe('extractStageInfo', () => {
    it('returns empty array when no stage files exist', () => {
      const stages = MetadataExtractor.extractStageInfo(tempDir);

      expect(stages).toEqual([]);
    });

    it('detects stage-T*.go files and extracts technique from filename', () => {
      writeStageFile('T1055', `
package main
// STAGE 1: Process Injection
const STAGE_ID = 1
`);

      const stages = MetadataExtractor.extractStageInfo(tempDir);

      expect(stages).toHaveLength(1);
      expect(stages[0].technique).toBe('T1055');
      expect(stages[0].fileName).toBe('stage-T1055.go');
    });

    it('extracts STAGE_ID and name from content', () => {
      writeStageFile('T1059', `
package main
// STAGE 2: Command Execution
const STAGE_ID = 2
`);

      const stages = MetadataExtractor.extractStageInfo(tempDir);

      expect(stages[0].stageId).toBe(2);
      expect(stages[0].name).toBe('Command Execution');
    });

    it('defaults stageId to index+1 when STAGE_ID missing', () => {
      writeStageFile('T1003', `
package main
// STAGE 1: Credential Access
// No STAGE_ID constant
`);

      const stages = MetadataExtractor.extractStageInfo(tempDir);

      expect(stages[0].stageId).toBe(1);
    });

    it('sorts stages by stageId', () => {
      writeStageFile('T1059', `
package main
// STAGE 3: Command Execution
const STAGE_ID = 3
`);
      writeStageFile('T1055', `
package main
// STAGE 1: Process Injection
const STAGE_ID = 1
`);
      writeStageFile('T1003', `
package main
// STAGE 2: Credential Dumping
const STAGE_ID = 2
`);

      const stages = MetadataExtractor.extractStageInfo(tempDir);

      expect(stages).toHaveLength(3);
      expect(stages[0].stageId).toBe(1);
      expect(stages[0].technique).toBe('T1055');
      expect(stages[1].stageId).toBe(2);
      expect(stages[2].stageId).toBe(3);
    });

    it('handles sub-technique in stage filename', () => {
      writeStageFile('T1055.001', `
package main
// STAGE 1: DLL Injection
const STAGE_ID = 1
`);

      const stages = MetadataExtractor.extractStageInfo(tempDir);

      expect(stages[0].technique).toBe('T1055.001');
    });
  });

  // ── Group 5: extractTestMetadata — orchestration ───────────

  describe('extractTestMetadata', () => {
    it('combines metadata from all three sources', () => {
      const uuid = 'orch-uuid-1';
      writeGoFile(uuid, `
  ID: ${uuid}
  NAME: Orchestrated Test
  TECHNIQUES: T1055
  SEVERITY: High
`);
      writeReadme(`
# Orchestrated Test

**Test Score**: **8.0/10**

## Overview
A comprehensive orchestrated test.
`);
      writeInfoCard(uuid, `
# Info

**Category**: defense_evasion
**MITRE ATT&CK**: T1059
`);

      const result = MetadataExtractor.extractTestMetadata(tempDir, uuid);

      expect(result.uuid).toBe(uuid);
      expect(result.name).toBe('Orchestrated Test');
      expect(result.severity).toBe('high');
      expect(result.score).toBe(8.0);
      expect(result.description).toBe('A comprehensive orchestrated test.');
      expect(result.category).toBe('defense_evasion');
    });

    it('deduplicates techniques across sources via Set merge', () => {
      const uuid = 'dedup-uuid';
      writeGoFile(uuid, `
  ID: ${uuid}
  TECHNIQUES: T1055, T1059
`);
      writeReadme(`
# Test

**T1055**: Process Injection
**T1003**: Credential Dumping
`);
      writeInfoCard(uuid, `
# Info
**MITRE ATT&CK**: T1059, T1003
`);

      const result = MetadataExtractor.extractTestMetadata(tempDir, uuid);

      // T1055 and T1059 appear in multiple sources — should be deduped
      expect(result.techniques).toEqual(
        expect.arrayContaining(['T1055', 'T1059', 'T1003']),
      );
      expect(result.techniques).toHaveLength(3);
    });

    it('folder category overrides extracted category', () => {
      const uuid = 'folder-cat';
      writeGoFile(uuid, `
  ID: ${uuid}
  NAME: Test
`);
      writeInfoCard(uuid, `
# Info
**Category**: defense_evasion
`);

      const result = MetadataExtractor.extractTestMetadata(tempDir, uuid, 'intel-driven');

      expect(result.category).toBe('intel-driven');
    });

    it('sets isMultiStage: true when stage files present', () => {
      const uuid = 'multi-stage';
      writeGoFile(uuid, `
  ID: ${uuid}
  TECHNIQUES: T1055
`);
      writeStageFile('T1055', `
package main
// STAGE 1: Injection
const STAGE_ID = 1
`);
      writeStageFile('T1059', `
package main
// STAGE 2: Execution
const STAGE_ID = 2
`);

      const result = MetadataExtractor.extractTestMetadata(tempDir, uuid);

      expect(result.isMultiStage).toBe(true);
      expect(result.stages).toHaveLength(2);
    });

    it('handles all-missing files (returns minimal defaults)', () => {
      const uuid = 'missing-all';

      const result = MetadataExtractor.extractTestMetadata(tempDir, uuid);

      expect(result.uuid).toBe(uuid);
      expect(result.techniques).toEqual([]);
      expect(result.tactics).toEqual([]);
      expect(result.tags).toEqual([]);
      expect(result.stages).toEqual([]);
      expect(result.isMultiStage).toBe(false);
    });

    it('UUID and category passed through correctly', () => {
      const uuid = 'pass-thru';
      writeGoFile(uuid, `
  ID: ${uuid}
  NAME: Pass Through Test
`);

      const result = MetadataExtractor.extractTestMetadata(tempDir, uuid, 'cyber-hygiene');

      expect(result.uuid).toBe(uuid);
      expect(result.category).toBe('cyber-hygiene');
    });
  });
});
