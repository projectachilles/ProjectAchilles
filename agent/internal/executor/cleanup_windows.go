//go:build windows

package executor

import "os"

// dirIsTrusted: on Windows the agent and the bootstrap lock C:\F0 to SYSTEM and
// Administrators (config.SecureAgentDir), so a real folder (checked by the
// caller: not a symlink or junction) is trusted.
func dirIsTrusted(info os.FileInfo) bool { return info.IsDir() }
