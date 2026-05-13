// Maps Microsoft Secure Score control titles to the MITRE ATT&CK techniques
// they address. Used by the Defender tab to project, per remediation control:
// "enabling this would have suppressed N alerts in the last 30 days".
//
// Match policy: case-insensitive substring search against the control title.
// First match wins — more specific patterns should be listed earlier.
//
// Conservative by design: only include entries where the technique linkage is
// clear from the control's stated purpose. Controls without a matching pattern
// produce no correlation stat in the UI ("no data" is better than wrong data
// for an ROI projection).
//
// Titles are matched (not the volatile control_name / scid-NNNN identifier)
// because Microsoft renames internal IDs across product generations but keeps
// human-readable titles stable across releases.

interface MappingEntry {
  /** Lowercase substring matched against the control title. */
  pattern: string;
  /** MITRE technique IDs (parent or sub) the control is expected to address. */
  techniques: string[];
}

const TITLE_PATTERNS: MappingEntry[] = [
  // Identity & authentication
  { pattern: 'multifactor authentication', techniques: ['T1078', 'T1110'] },
  { pattern: 'self-service password', techniques: ['T1078'] },
  { pattern: 'legacy authentication', techniques: ['T1078.002', 'T1110'] },
  { pattern: 'password protection', techniques: ['T1110'] },
  { pattern: 'conditional access', techniques: ['T1078'] },

  // ASR rules — Office macro / child-process abuse
  { pattern: 'executable content from email', techniques: ['T1566', 'T1204'] },
  { pattern: 'office applications from creating child', techniques: ['T1059', 'T1204.002'] },
  { pattern: 'office applications from creating executable', techniques: ['T1204.002'] },
  { pattern: 'office applications from injecting', techniques: ['T1055'] },
  { pattern: 'win32 api calls from office', techniques: ['T1059.005', 'T1204.002'] },

  // ASR rules — Scripts
  { pattern: 'javascript or vbscript', techniques: ['T1059.007', 'T1059.005'] },
  { pattern: 'obfuscated scripts', techniques: ['T1027', 'T1059'] },

  // ASR rules — Endpoint protection
  { pattern: 'protection against ransomware', techniques: ['T1486'] },
  { pattern: 'executable files from running', techniques: ['T1204'] },
  { pattern: 'controlled folder access', techniques: ['T1486'] },

  // Credentials
  { pattern: 'credential dumping', techniques: ['T1003'] },
  { pattern: 'lsass', techniques: ['T1003.001'] },
];

/**
 * Returns the MITRE technique IDs a control is expected to address, or an
 * empty array if no mapping pattern matches.
 */
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

/** Test-only: total number of curated mapping entries. */
export function _mappingSize(): number {
  return TITLE_PATTERNS.length;
}
