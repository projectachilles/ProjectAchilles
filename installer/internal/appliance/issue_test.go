package appliance

import (
	"strings"
	"testing"
)

func TestRenderIssue(t *testing.T) {
	got := RenderIssue(true, "achilles.corp.example.com")
	if !strings.Contains(got, "https://achilles.corp.example.com") || !strings.Contains(got, `\4`) {
		t.Fatalf("installed: %q", got)
	}
	got = RenderIssue(false, "")
	if !strings.Contains(got, "log in as achilles") || !strings.Contains(got, `\4`) {
		t.Fatalf("not installed: %q", got)
	}
}
