package appliance

import (
	"fmt"
	"path/filepath"

	"github.com/projectachilles/ProjectAchilles/installer/internal/config"
	"github.com/projectachilles/ProjectAchilles/installer/internal/firstboot"
)

// RenderIssue returns the console banner. agetty expands \4 to the IPv4
// address. configured means the install wizard has run (Installed), which
// doesn't prove the install finished.
func RenderIssue(configured bool, domain string) string {
	if configured {
		head := "ProjectAchilles is configured on this appliance."
		if domain != "" {
			head = "ProjectAchilles is configured for https://" + domain
		}
		return fmt.Sprintf("\n%s\nAppliance address: \\4\nCheck it: sudo %s status\n\n", head, firstboot.BinPath)
	}
	return "\nProjectAchilles appliance (not installed yet)\nAddress: \\4  -  log in as achilles over SSH or this console to set it up.\n\n"
}

// WriteIssue writes the banner snippet agetty shows before login.
func WriteIssue(h firstboot.Host) error {
	installed := Installed(h.Exists)
	domain := ""
	if installed {
		// A config that can't be read just means a banner without the URL.
		if c, err := config.Load(filepath.Join(firstboot.RepoDir, "deploy.config.env")); err == nil {
			domain = c.AchillesDomain
		}
	}
	return h.WriteFile(firstboot.IssuePath, []byte(RenderIssue(installed, domain)), 0o644)
}
