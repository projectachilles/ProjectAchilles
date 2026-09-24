package service

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"
	"unicode/utf16"
)

func decodeEncodedCommand(t *testing.T, b64 string) string {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		t.Fatalf("not base64: %v", err)
	}
	if len(raw)%2 != 0 {
		t.Fatalf("odd byte count %d: not UTF-16", len(raw))
	}
	u := make([]uint16, len(raw)/2)
	for i := range u {
		u[i] = uint16(raw[2*i]) | uint16(raw[2*i+1])<<8 // little-endian
	}
	return string(utf16.Decode(u))
}

// schtasks /SD parses its date argument in the machine's locale. The agent
// passed "01/02/2006"-formatted dates, so on en-GB (dd/MM/yyyy) endpoints the
// fallback restart failed with "Incorrect Start Date" whenever the day was
// > 12, and silently ran months late otherwise (09/11 → 9 November).
func TestFallbackRestartArgs_ScheduleWithoutLocaleDependentDates(t *testing.T) {
	args := fallbackRestartArgs("AchillesAgent", "AchillesAgentRestart", 2*time.Minute)

	if args[0] != "powershell.exe" {
		t.Fatalf("args[0] = %q, want powershell.exe", args[0])
	}
	idx := -1
	for i, a := range args {
		if a == "-EncodedCommand" {
			idx = i
		}
	}
	if idx == -1 || idx+1 >= len(args) {
		t.Fatalf("no -EncodedCommand payload in %v", args)
	}
	script := decodeEncodedCommand(t, args[idx+1])

	for _, want := range []string{
		"New-ScheduledTaskTrigger -Once -At ([DateTime]::Now.AddSeconds(120))",
		"Register-ScheduledTask -TaskName 'AchillesAgentRestart'",
		"sc.exe start AchillesAgent",
		"schtasks.exe /Delete /TN AchillesAgentRestart /F",
		"-UserId 'NT AUTHORITY\\SYSTEM'",
		"-Force",
	} {
		if !strings.Contains(script, want) {
			t.Errorf("script missing %q:\n%s", want, script)
		}
	}
	if strings.Contains(script, "/SD") || strings.Contains(script, "/ST") {
		t.Errorf("script must not pass a formatted date/time to schtasks:\n%s", script)
	}
}

func TestEncodePowerShell_RoundTripsNonASCII(t *testing.T) {
	in := "Write-Output 'café ✓'"
	if got := decodeEncodedCommand(t, encodePowerShell(in)); got != in {
		t.Fatalf("round trip = %q, want %q", got, in)
	}
}
