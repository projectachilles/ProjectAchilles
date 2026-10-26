package appliance

import (
	"strings"
	"testing"

	"github.com/projectachilles/ProjectAchilles/installer/internal/firstboot"
)

func TestRenderIssue(t *testing.T) {
	got := RenderIssue(true, "achilles.corp.example.com")
	if !strings.Contains(got, "https://achilles.corp.example.com") || !strings.Contains(got, `\4`) {
		t.Fatalf("installed: %q", got)
	}
	// The config exists before the install runs: "configured", not "installed".
	for _, domain := range []string{"achilles.corp.example.com", ""} {
		got := RenderIssue(true, domain)
		if !strings.Contains(got, "configured") || strings.Contains(got, "not installed") ||
			!strings.Contains(got, "sudo "+firstboot.BinPath+" status") || !strings.Contains(got, `\4`) {
			t.Errorf("configured (domain %q): %q", domain, got)
		}
		assertAbsoluteCommands(t, got)
	}
	got = RenderIssue(false, "")
	if !strings.Contains(got, "log in as achilles") || !strings.Contains(got, `\4`) {
		t.Fatalf("not installed: %q", got)
	}
}
