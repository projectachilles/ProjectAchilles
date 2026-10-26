//go:build appliancetest

package cli

import (
	"os"

	"github.com/projectachilles/ProjectAchilles/installer/internal/firstboot"
)

// Test builds only: when the image boot test left an answers file, first boot
// replays it instead of showing the console.
func init() {
	newFirstbootUI = func() (firstboot.UI, error) {
		if _, err := os.Stat(firstboot.AnswersPath); err != nil {
			return firstboot.FormUI{}, nil
		}
		return firstboot.NewFileUI(firstboot.AnswersPath, firstboot.HandoffPath)
	}
}
