// Maps Microsoft Secure Score control titles to the MITRE ATT&CK techniques
// they address. Used by the Defender tab to project, per remediation control:
// "enabling this would have suppressed N alerts in the last 30 days".
//
// Mirror of backend/src/services/defender/control-correlation.service.ts.
// These are independent codebases per repo CLAUDE.md — when you add a mapping
// entry here, add the matching entry in the docker backend (and vice versa).

interface MappingEntry {
  pattern: string;
  techniques: string[];
}

const TITLE_PATTERNS: MappingEntry[] = [
  { pattern: 'multifactor authentication', techniques: ['T1078', 'T1110'] },
  { pattern: 'self-service password', techniques: ['T1078'] },
  { pattern: 'legacy authentication', techniques: ['T1078.002', 'T1110'] },
  { pattern: 'password protection', techniques: ['T1110'] },
  { pattern: 'conditional access', techniques: ['T1078'] },

  { pattern: 'executable content from email', techniques: ['T1566', 'T1204'] },
  { pattern: 'office applications from creating child', techniques: ['T1059', 'T1204.002'] },
  { pattern: 'office applications from creating executable', techniques: ['T1204.002'] },
  { pattern: 'office applications from injecting', techniques: ['T1055'] },
  { pattern: 'win32 api calls from office', techniques: ['T1059.005', 'T1204.002'] },

  { pattern: 'javascript or vbscript', techniques: ['T1059.007', 'T1059.005'] },
  { pattern: 'obfuscated scripts', techniques: ['T1027', 'T1059'] },

  { pattern: 'protection against ransomware', techniques: ['T1486'] },
  { pattern: 'executable files from running', techniques: ['T1204'] },
  { pattern: 'controlled folder access', techniques: ['T1486'] },

  { pattern: 'credential dumping', techniques: ['T1003'] },
  { pattern: 'lsass', techniques: ['T1003.001'] },
];

export function getControlMitreTechniques(controlTitle: string): string[] {
  if (!controlTitle) return [];
  const lower = controlTitle.toLowerCase();
  for (const entry of TITLE_PATTERNS) {
    if (lower.includes(entry.pattern)) {
      return entry.techniques;
    }
  }
  return [];
}

export function _mappingSize(): number {
  return TITLE_PATTERNS.length;
}
