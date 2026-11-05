# SafePay UAC Bypass & Defense Evasion

## Test Information

**Test ID**: 2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11
**Test Name**: SafePay UAC Bypass & Defense Evasion
**Category**: Privilege Escalation / Defense Evasion
**Severity**: High

## Test Score: 8.3/10

### Score Breakdown

| Criterion | Score |
|-----------|-------|
| **Real-World Accuracy** | **2.5/3.0** |
| **Technical Sophistication** | **2.5/3.0** |
| **Safety Mechanisms** | **1.5/2.0** |
| **Detection Opportunities** | **0.8/1.0** |
| **Logging & Observability** | **1.0/1.0** |

**Justification**: This test implements the actual CMSTPLUA COM UAC bypass technique used by SafePay malware. Combines privilege escalation with registry persistence and defense evasion. Multiple detection opportunities exist at COM object creation, registry modification, and PowerShell execution stages. Automatic cleanup ensures safe operation.
