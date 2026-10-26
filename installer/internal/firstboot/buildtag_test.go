package firstboot

import (
	"os/exec"
	"strings"
	"testing"
)

// goFiles lists the non-test Go files of the firstboot and cli packages.
func goFiles(t *testing.T, tags ...string) string {
	t.Helper()
	args := []string{"list"}
	args = append(args, tags...)
	args = append(args, "-f", `{{join .GoFiles " "}}`, ".", "../cli")
	out, err := exec.Command("go", args...).CombinedOutput()
	if err != nil {
		t.Fatalf("go list: %v\n%s", err, out)
	}
	return string(out)
}

// The file-driven first-boot UI must exist only in -tags appliancetest builds,
// so a production binary can never read an answers file.
func TestProductionBuildHasNoFileUI(t *testing.T) {
	prod := goFiles(t)
	for _, f := range []string{"ui_file.go", "firstboot_testui.go"} {
		if strings.Contains(prod, f) {
			t.Errorf("production build includes %s", f)
		}
	}
	tagged := goFiles(t, "-tags", "appliancetest")
	for _, f := range []string{"ui_file.go", "firstboot_testui.go"} {
		if !strings.Contains(tagged, f) {
			t.Errorf("appliancetest build lacks %s", f)
		}
	}
}
