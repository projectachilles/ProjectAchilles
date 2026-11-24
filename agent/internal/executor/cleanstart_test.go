package executor

import "testing"

func TestIsAgentFile(t *testing.T) {
	keep := []string{"achilles-agent.exe", "achilles-agent.exe.old", "achilles-agent.exe.replaced",
		"achilles-agent.yaml", "achilles-agent.log", "Achilles-Agent.EXE",
		".config-123456.tmp", ".achilles-agent-install-98765"}
	drop := []string{"rwdrv.sys", "sliver_client.exe", "MsMpEng.exe", ".config-123456", "config.tmp",
		"298cc137-ea39-4cf0-9b2d-b1c59a3cbacb.exe", "tasks"}
	for _, n := range keep {
		if !isAgentFile(n) {
			t.Errorf("isAgentFile(%q) = false, want true", n)
		}
	}
	for _, n := range drop {
		if isAgentFile(n) {
			t.Errorf("isAgentFile(%q) = true, want false", n)
		}
	}
}

func TestIsUndoFileKeepsEveryKnownUndoFile(t *testing.T) {
	undo := []string{"cleanup_utility.exe", "registry_run_key_state.txt", "scheduled_task_state.txt",
		"tailscale_cleanup.exe", "original_service_state.json", "original_openssh_state.json",
		"tailscale.state", "esxi_cleanup", "bluenoroff_cleanup", "emergency_restore.ps1",
		"patch_backup.json", "watchdog_state.json", "Emergency_RESTORE.ps1"}
	notUndo := []string{"rwdrv.sys", "exfil_staging", "credential_staging", "WinRAR.exe",
		"recon_summary.txt", "setup.msi"}
	for _, n := range undo {
		if !isUndoFile(n) {
			t.Errorf("isUndoFile(%q) = false, want true", n)
		}
	}
	for _, n := range notUndo {
		if isUndoFile(n) {
			t.Errorf("isUndoFile(%q) = true, want false", n)
		}
	}
}

func TestKeepInArtifactDir(t *testing.T) {
	tops := []string{"tasks", "certs"}
	both := []string{"achilles-agent.exe", "tasks", "TASKS", "certs", "cleanup_utility.exe"}
	afterOnly := []string{"test_execution_log.json", "test_execution_log.txt", "bundle_results.json",
		"Test_Execution_Log.JSON"}
	neither := []string{"rwdrv.sys", "exfil_staging", lockbit + "-T1486.exe"}
	for _, n := range both {
		for _, p := range []cleanPass{beforeRun, afterRun} {
			if !keepInArtifactDir(n, p, tops) {
				t.Errorf("keepInArtifactDir(%q, %d) = false, want true", n, p)
			}
		}
	}
	for _, n := range afterOnly {
		if keepInArtifactDir(n, beforeRun, tops) {
			t.Errorf("keepInArtifactDir(%q, beforeRun) = true, want false", n)
		}
		if !keepInArtifactDir(n, afterRun, tops) {
			t.Errorf("keepInArtifactDir(%q, afterRun) = false, want true", n)
		}
	}
	for _, n := range neither {
		for _, p := range []cleanPass{beforeRun, afterRun} {
			if keepInArtifactDir(n, p, tops) {
				t.Errorf("keepInArtifactDir(%q, %d) = true, want false", n, p)
			}
		}
	}
}
