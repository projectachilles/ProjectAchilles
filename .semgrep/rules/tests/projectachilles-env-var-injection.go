package executor

import "os/exec"

// --- Should trigger ---

func unsafeEnvAppend(task Task) {
	cmd := exec.Command("test.exe")
	// ruleid: projectachilles-env-var-injection
	cmd.Env = append(cmd.Env, task.EnvVars...)
}

func unsafeEnvAppendSingle(task Task) {
	cmd := exec.Command("test.exe")
	// ruleid: projectachilles-env-var-injection
	cmd.Env = append(cmd.Env, "KEY="+task.Value)
}

// --- Should NOT trigger ---

func safeEnvFiltered(task Task) {
	cmd := exec.Command("test.exe")
	allowed := []string{"PATH", "HOME"}
	// ok: projectachilles-env-var-injection
	for _, v := range allowed {
		cmd.Env = append(cmd.Env, v+"="+getEnv(v))
	}
}

func safeEnvStatic() {
	cmd := exec.Command("test.exe")
	// ok: projectachilles-env-var-injection
	cmd.Env = []string{"PATH=/usr/bin", "HOME=/root"}
}
