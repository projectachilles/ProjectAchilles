# Safety Guidelines - Tailscale Remote Access Test

## Overview
This test creates actual remote access capabilities and simulates data exfiltration. While using dummy data and designed for security testing, proper safety protocols must be followed.

## Critical Safety Considerations

### 1. Authentication Key Security

**IMPORTANT:** Tailscale auth keys provide network access to your infrastructure.

**Best Practices:**
- Use **ephemeral keys** (expire after single use)
- Set short expiration times (24 hours maximum)
- Use **tagged keys** to limit network access scope
- Revoke keys immediately after testing
- Never commit keys to version control

**Generate Secure Keys:**
```
1. Navigate to: https://login.tailscale.com/admin/settings/keys
2. Click "Generate auth key"
3. Enable "Ephemeral" (auto-delete after use)
4. Set expiration: 24 hours
5. Add tag: "tag:security-test"
6. Copy key and replace placeholder in code
```

**Revoke After Testing:**
```
1. Go to: https://login.tailscale.com/admin/settings/keys
2. Find the key used for testing
3. Click "Revoke" to invalidate immediately
```

### 2. Network Isolation

**Recommendations:**
- Test on isolated lab networks
- Use separate Tailscale tailnet for testing (not production)
- Implement network segmentation
- Monitor all connections during test execution

**Tailnet Isolation:**
- Create dedicated test tailnet
- Do not join production devices
- Use ACLs to restrict access
- Delete test tailnet after completion

### 3. System Changes

This test makes the following system modifications:

**OpenSSH Server:**
- Installs Windows OpenSSH capability (~10MB)
- Creates automatic startup service
- Opens firewall port 22
- **Recommendation:** Use dedicated test systems

**Firewall:**
- Creates inbound rule for SSH (TCP 22)
- **Recommendation:** Remove rule after testing

**File System:**
- Creates C:\F0\ directory
- Writes ~30MB of files
- Creates dummy sensitive data
- **Recommendation:** Run cleanup utility after test

### 4. Cleanup Requirements

**CRITICAL:** Always run cleanup after test completion:

```powershell
C:\F0\tailscale_cleanup.exe
```

**Manual Verification:**
```powershell
# Verify services removed
Get-Service sshd -ErrorAction SilentlyContinue

# Verify firewall rules removed
Get-NetFirewallRule -Name sshd -ErrorAction SilentlyContinue

# Verify files removed
Test-Path C:\F0\tailscale.exe
```

### 5. Data Exfiltration Simulation

**Safety Measures:**
- Uses **dummy data only** (no real PII)
- Exfiltration is **simulated** (local copy, not actual transfer)
- Files clearly marked as test data
- All data removed by cleanup utility

**Dummy Files Created:**
- passwords.txt (fake credentials)
- api_keys.txt (example keys)
- customer_data.csv (synthetic data)
- No real sensitive information used

### 6. Administrator Privileges

**Warning:** This test requires administrator rights and will:
- Install Windows capabilities
- Create/modify services
- Change firewall settings
- Create system-level connections

**Recommendations:**
- Use dedicated test accounts
- Test on non-production systems
- Review all changes before production deployment

### 7. Testing Environment Recommendations

**Ideal Test Setup:**
```
Lab Network:
├── Test System 1 (Windows 10/11)
│   ├── No production data
│   ├── Isolated VLAN
│   └── Dedicated test account
├── Test Tailnet (separate from production)
│   ├── Ephemeral auth keys
│   ├── Restrictive ACLs
│   └── Auto-expiring devices
└── Monitoring System
    ├── Log all connections
    ├── Capture network traffic
    └── Alert on unexpected activity
```

**Avoid:**
- Production systems
- Systems with real sensitive data
- Production Tailscale tailnets
- Shared corporate networks

### 8. Emergency Procedures

**If Test Goes Wrong:**

1. **Stop Immediately:**
```powershell
# Kill all related processes
taskkill /F /IM tailscale.exe
taskkill /F /IM sshd.exe

# Stop services
Stop-Service sshd
```

2. **Disconnect Network:**
```powershell
# Disable network adapter if needed
Disable-NetAdapter -Name "Ethernet" -Confirm:$false
```

3. **Run Cleanup:**
```powershell
C:\F0\tailscale_cleanup.exe
```

4. **Verify Removal:**
```powershell
# Check services
Get-Service | Where-Object {$_.Name -eq "sshd"}

# Check firewall
Get-NetFirewallRule | Where-Object {$_.DisplayName -like "*SSH*"}

# Check processes
Get-Process | Where-Object {$_.Name -like "*tailscale*"}
```

### 9. Pre-Test Checklist

Before running this test:
- [ ] Confirmed running on isolated test system
- [ ] Generated ephemeral Tailscale auth key
- [ ] Replaced placeholder in source code
- [ ] Verified administrator privileges
- [ ] Prepared cleanup procedures
- [ ] Confirmed system backup available
- [ ] Notified security team of testing
- [ ] Set test completion deadline
- [ ] Prepared rollback plan

### 10. Post-Test Checklist

After test completion:
- [ ] Ran cleanup utility
- [ ] Verified OpenSSH removed (or kept intentionally)
- [ ] Verified firewall rules removed
- [ ] Verified Tailscale disconnected
- [ ] Revoked Tailscale auth key
- [ ] Removed test files from C:\F0\
- [ ] Reviewed logs for anomalies
- [ ] Documented test results
- [ ] Removed test tailnet (if dedicated)

## Legal and Compliance Considerations

### Authorization
- Obtain written authorization before testing
- Test only on systems you own or have explicit permission to test
- Document authorization and scope

### Compliance
- Ensure testing complies with organizational policies
- Review relevant regulations (GDPR, HIPAA, etc.)
- Maintain audit trail of all testing activities

### Responsible Disclosure
- This is a security testing tool - use responsibly
- Report findings to appropriate stakeholders
- Follow responsible disclosure practices

## Support and Reporting

### Issues During Testing
If you encounter problems:
1. Stop the test immediately
2. Run cleanup utility
3. Document the issue
4. Review logs: C:\F0\test_execution_log.txt

### Security Concerns
If you discover actual security vulnerabilities:
1. Follow your organization's incident response procedures
2. Document findings with evidence
3. Implement remediation
4. Retest to verify fix

## Disclaimer

This tool is designed for authorized security testing only. Users are responsible for:
- Obtaining proper authorization
- Using in appropriate environments
- Following safety protocols
- Proper cleanup and remediation
- Compliance with laws and regulations

**Use at your own risk.** The authors assume no liability for misuse or damage caused by this tool.
