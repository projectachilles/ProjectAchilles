package service

import (
	"encoding/base64"
	"fmt"
	"time"
	"unicode/utf16"
)

// fallbackRestartArgs returns the command that registers a one-time Windows
// scheduled task to start the service after delay, then delete itself.
//
// The trigger time is computed inside PowerShell as a DateTime, never passed
// as text: schtasks /SD parses dates in the machine's locale, so the previous
// "01/02/2006"-formatted date failed on dd/MM locales ("Incorrect Start
// Date") or ran months late. The script travels as -EncodedCommand so no
// quoting survives through Go's argument escaping and PowerShell's parser.
//
// Kept free of build tags so it can be tested on any platform.
func fallbackRestartArgs(service, task string, delay time.Duration) []string {
	script := fmt.Sprintf(`$ErrorActionPreference = 'Stop'
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/C sc.exe start %[1]s & schtasks.exe /Delete /TN %[2]s /F'
$trigger = New-ScheduledTaskTrigger -Once -At ([DateTime]::Now.AddSeconds(%[3]d))
$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName '%[2]s' -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
`, service, task, int(delay.Seconds()))

	return []string{
		"powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-EncodedCommand", encodePowerShell(script),
	}
}

// encodePowerShell encodes a script for powershell.exe -EncodedCommand, which
// expects base64 of UTF-16LE text.
func encodePowerShell(script string) string {
	u := utf16.Encode([]rune(script))
	b := make([]byte, 2*len(u))
	for i, c := range u {
		b[2*i] = byte(c)
		b[2*i+1] = byte(c >> 8)
	}
	return base64.StdEncoding.EncodeToString(b)
}
