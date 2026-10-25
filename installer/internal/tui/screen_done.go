package tui

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"

	"github.com/projectachilles/ProjectAchilles/installer/internal/ca"
	"github.com/projectachilles/ProjectAchilles/installer/internal/clerkadmin"
	"github.com/projectachilles/ProjectAchilles/installer/internal/config"
)

// windowsOneLiner enrolls a Windows endpoint; <TOKEN> stays a placeholder
// (tokens are never baked into scripts or shown here).
const windowsOneLiner = "powershell -ExecutionPolicy Bypass -File bootstrap-windows.ps1 -Token <TOKEN>"

const gpoNote = "Push root.cer via GPO (Computer Configuration → Policies → Windows Settings → Security Settings → Public Key Policies → Trusted Root Certification Authorities). Never put enrollment tokens in GPO/SYSVOL."

// doneScreen is the hand-over: where the server is, how endpoints come to
// trust it and enroll, and the day-2 commands. It scrolls when taller than
// the terminal.
type doneScreen struct {
	s      *shared
	lines  []string
	scroll scroller

	admin    adminState // the first-admin Clerk call (ADMIN_EMAIL)
	adminRes clerkadmin.Result
	adminErr error
}

type adminState int

const (
	adminIdle adminState = iota
	adminRunning
	adminFinished
)

type adminResultMsg struct {
	res clerkadmin.Result
	err error
}

// adminTimeout bounds the Clerk calls that make the first admin.
const adminTimeout = 30 * time.Second

func newDone(s *shared) *doneScreen { return &doneScreen{s: s} }

func (d *doneScreen) Title() string { return "Done" }

func (d *doneScreen) Help() string {
	if d.scroll.scrollable() {
		return "↑/↓ scroll · enter finish · ctrl+c quit"
	}
	return "enter finish · ctrl+c quit"
}

func (d *doneScreen) Init() tea.Cmd {
	cmd := d.startAdmin()
	d.scroll = scroller{}
	d.refresh()
	return cmd
}

// refresh rebuilds the content (and the terminal summary) in place.
func (d *doneScreen) refresh() {
	d.lines = d.build()
	d.s.summary = d.plain()
	d.scroll.setLines(d.lines, false)
	d.scroll.setHeight(d.s.height - 1)
}

// startAdmin makes ADMIN_EMAIL an admin, once: Init also runs on resize.
func (d *doneScreen) startAdmin() tea.Cmd {
	c, f := *d.s.cfg, d.s.deps.Admin
	if d.admin != adminIdle || c.AdminEmail == "" || f == nil {
		return nil
	}
	d.admin = adminRunning
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), adminTimeout)
		defer cancel()
		r, err := f(ctx, c)
		return adminResultMsg{r, err}
	}
}

// adminStep is the first "Next steps" item: how the first admin gets in.
func (d *doneScreen) adminStep(url string) string {
	c := d.s.cfg
	switch {
	case c.AdminEmail == "" || d.admin == adminIdle:
		return clerkadmin.ManualSteps(c.AchillesDomain)
	case d.admin == adminRunning:
		return "Inviting " + c.AdminEmail + " as the first admin (Clerk)…"
	case d.adminErr != nil:
		return "Could not make " + c.AdminEmail + " an admin: " + d.adminErr.Error() + ". " + clerkadmin.ManualSteps(c.AchillesDomain)
	case d.adminRes.Outcome == clerkadmin.Invited || d.adminRes.Outcome == clerkadmin.AlreadyInvited:
		return d.adminRes.Message() + " Then sign in at " + url + "."
	default:
		return d.adminRes.Message() + " Sign in at " + url + "."
	}
}

// plain is the whole content without styling (also the terminal summary).
func (d *doneScreen) plain() string { return ansi.Strip(strings.Join(d.lines, "\n")) }

func (d *doneScreen) build() []string {
	t := d.s.theme
	c := d.s.cfg
	w := d.s.width
	var out []string
	add := func(s string) { out = append(out, strings.Split(s, "\n")...) }
	para := func(s, indent string) { add(indentAll(wrap(s, w-len(indent)), indent)) }
	url := "https://" + c.AchillesDomain

	add(t.ok(t.Strong.Render("ProjectAchilles is installed and running.")))
	add("  " + t.Muted.Render("URL     ") + t.Code.Render(url))
	if ip := strings.Trim(c.CaddyBindIP, "[]"); ip != "" {
		add("  " + t.Muted.Render("IP      ") + ip)
	}
	add("")

	if c.TLSMode == "achilles-ca" {
		d.caBlock(add, para)
	} else {
		add(t.Title.Render("Certificates"))
		para(trustText(c, d.s.deps.RepoRoot), "  ")
		add("")
		add(t.Title.Render("Enroll endpoints") + t.Muted.Render(" (as Administrator/root):"))
		para("Download the agent from the web UI, then run:", "  ")
		// Never wrapped: word-wrap breaks at hyphens and would split a flag.
		add("  " + t.Code.Render("achilles-agent --enroll <TOKEN> --server "+url+" --install"))
		add("")
	}

	add(t.Title.Render("Next steps"))
	for i, step := range []string{
		d.adminStep(url),
		"Register an agent version in the web UI before enrolling.",
		"Create an enrollment token in the web UI, then enroll each endpoint as shown above.",
	} {
		// "  1. " then continuation lines hang under the text
		add(fmt.Sprintf("  %d. ", i+1) + strings.ReplaceAll(wrap(step, w-5), "\n", "\n     "))
	}
	add("")
	// sudo + ./ so the commands paste as they are: the binary is not on PATH
	// and its files are root-only.
	add(t.Title.Render("Day-2 commands") + t.Muted.Render(" (in "+d.s.deps.RepoRoot+")"))
	for _, row := range [][2]string{
		{"status", "health, certificates, last backup"},
		{"upgrade", "move to a newer ProjectAchilles release"},
		{"backup", "back up data, the CA and settings"},
		{"restore", "restore a backup file"},
	} {
		add("  " + t.Code.Render(fmt.Sprintf("sudo ./achilles-installer %-8s", row[0])) + " " + t.Muted.Render(row[1]))
	}
	return out
}

// caBlock is the ProjectAchilles CA hand-over: the root, its fingerprints
// and the bootstrap scripts.
func (d *doneScreen) caBlock(add func(string), para func(string, string)) {
	t := d.s.theme
	c := d.s.cfg
	pub := filepath.Join(d.s.deps.CADir, "public")
	add(t.Title.Render("Root CA") + t.Muted.Render(" · ProjectAchilles CA for "+c.CAZone))
	add("  " + filepath.Join(pub, "root.cer") + t.Muted.Render("  DER, for GPO"))
	add("  " + filepath.Join(pub, "root.crt") + t.Muted.Render("  PEM"))
	if b, err := ca.Load(d.s.deps.CADir); err != nil {
		para(t.warn("Could not read the CA in "+d.s.deps.CADir+": "+err.Error()+". Run achilles-installer ca export to print the root and its fingerprints."), "  ")
	} else {
		sha, thumb := ca.Fingerprints(b.Root)
		const label = "%-20s"
		first, rest := sha, ""
		if len(sha) > 47 {
			first, rest = sha[:47], sha[48:] // 16 bytes per line
		}
		add("  " + t.Muted.Render(fmt.Sprintf(label, "SHA-256")) + first)
		if rest != "" {
			add("  " + fmt.Sprintf(label, "") + rest)
		}
		add("  " + t.Muted.Render(fmt.Sprintf(label, "Windows thumbprint")) + thumb)
	}
	add("")

	onprem := filepath.Join(d.s.deps.RepoRoot, "deploy", "onprem")
	add(t.Title.Render("Enroll a Windows endpoint") + t.Muted.Render(" (as Administrator, next to the script):"))
	add(t.Code.Render(windowsOneLiner))
	add("  " + t.Muted.Render("Linux/macOS (as root): ") + t.Code.Render("sudo bash bootstrap-unix.sh <TOKEN>"))
	add("  " + t.Muted.Render("Scripts: ") + filepath.Join(onprem, "bootstrap-windows.ps1"))
	add("           " + filepath.Join(onprem, "bootstrap-unix.sh"))
	para(t.Muted.Render("Each script fetches root.cer over HTTP, aborts unless it matches the pinned SHA-256, trusts it, then enrolls the agent over HTTPS. Pass a token you create in the web UI."), "  ")
	add("")
	para(gpoNote, "")
	add("")
}

// trustText says how endpoints come to trust the server in the non-CA modes.
func trustText(c *config.Config, repo string) string {
	switch c.TLSMode {
	case "acme-dns":
		return "Let's Encrypt (DNS-01): publicly trusted. Browsers and agents need no extra trust setup."
	case "byo":
		return "Your own certificate (deploy/caddy/certs/cert.pem). Endpoints trust it only if they trust its issuing CA: distribute your CA (for example by GPO) before enrolling agents."
	case "internal":
		return "Caddy's internal CA. Its root is at " + filepath.Join(repo, "deploy", "caddy", "certs", "root-ca.crt") + ": install it in each endpoint's OS trust store (Windows: LocalMachine\\Root) and in browsers before enrolling agents."
	default:
		return "Let's Encrypt (HTTP-01): publicly trusted. Browsers and agents need no extra trust setup."
	}
}

// indentAll prefixes every line, blank ones included.
func indentAll(s, prefix string) string {
	if prefix == "" {
		return s
	}
	return prefix + strings.ReplaceAll(s, "\n", "\n"+prefix)
}

func (d *doneScreen) Back() (bool, tea.Cmd) { return true, nil } // the install is done

func (d *doneScreen) Quit() (bool, tea.Cmd) { return true, finish(ActionInstall) }

func (d *doneScreen) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		d.Init()
	case adminResultMsg:
		d.admin, d.adminRes, d.adminErr = adminFinished, msg.res, msg.err
		d.refresh()
	case tea.KeyPressMsg:
		switch k := msg.String(); k {
		case "enter", "q":
			return d, done(d)
		default:
			d.scroll.key(k)
		}
	}
	return d, nil
}

func (d *doneScreen) View() tea.View {
	v := d.scroll.view(d.s.width)
	if h := d.scroll.hint(); h != "" {
		v += "\n" + d.s.theme.Muted.Render(h)
	}
	return tea.NewView(v)
}

// Apply has nothing to record.
func (d *doneScreen) Apply(*config.Config) {}
