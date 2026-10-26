package day2

import (
	"archive/tar"
	"bufio"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/projectachilles/ProjectAchilles/installer/internal/config"
	"github.com/projectachilles/ProjectAchilles/installer/internal/sysprobe"
)

// backedUpVolumes are the data volumes. repo-cache, go-cache and caddy-config
// are caches and are not backed up.
var backedUpVolumes = []string{"achilles-data", "caddy-data", "esdata"}

// backedUpFiles maps a path relative to the checkout to its name in the archive.
var backedUpFiles = []struct{ rel, name string }{
	{"deploy.config.env", "files/deploy.config.env"},
	{".env", "files/.env"},
	{"backend/.env", "files/backend.env"},
}

// noConfigWarning is printed when a backup has no deploy.config.env: the
// engine cannot be re-run from it, so it only suits the server it came from.
const noConfigWarning = "WARNING: this backup has no deploy.config.env; it can be restored only onto this server."

// defaultProject is deploy-server.sh's compose project for a fresh install
// (and the name the appliance's pre-built images carry).
const defaultProject = "achilles-server"

var validProject = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)

const (
	dirVolumes = "volumes"
	dirCA      = "ca"
	manifest   = "MANIFEST"
)

func (d Deps) volumeName(short string) string { return d.project() + "_" + short }

func (d Deps) volumeExists(ctx context.Context, name string) bool {
	_, err := d.Cmd.Run(ctx, "docker", "volume", "inspect", name)
	return err == nil
}

// zstdAvailable reports whether the helper image can write .tar.zst. The
// stock alpine image cannot (busybox tar), and installing it at run time
// would need the network, so this normally selects gzip.
func (d Deps) zstdAvailable(ctx context.Context) bool {
	_, err := d.Cmd.Run(ctx, "docker", "run", "--rm", helperImage, "sh", "-c",
		"command -v zstd >/dev/null 2>&1 && tar --zstd -cf /dev/null /dev/null")
	return err == nil
}

// Backup stops the stack, archives the volumes and configuration into
// <out>/<UTC timestamp>.tar.zst (or .tar.gz when the helper image cannot do
// zstd), and starts the stack again even when the archive fails. It returns
// the archive's path. out defaults to Deps.BackupDir.
func Backup(ctx context.Context, d Deps, out string) (path string, err error) {
	w := d.out()
	dir := d.backupDir(out)
	if err := mkdirPrivate(dir); err != nil {
		return "", err
	}
	stage, err := os.MkdirTemp(dir, ".stage-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(stage)
	volDir := filepath.Join(stage, dirVolumes)
	if err := os.Mkdir(volDir, 0o700); err != nil {
		return "", err
	}

	fmt.Fprintln(w, "Stopping the stack for a consistent backup...")
	_, stopErr := d.compose(ctx, "stop")
	// Runs on every exit path below, success or not. Not tied to ctx: a
	// cancelled run must still bring the stack back.
	defer func() {
		fmt.Fprintln(w, "Starting the stack...")
		if _, serr := d.compose(context.WithoutCancel(ctx), "start"); serr != nil {
			err = errors.Join(err, fmt.Errorf("the stack did not restart; run: docker compose -f %s start (%w)", d.composeFile(), serr))
		}
	}()
	if stopErr != nil {
		return "", fmt.Errorf("stopping the stack: %w", stopErr)
	}

	var included []string
	for _, short := range backedUpVolumes {
		name := d.volumeName(short)
		if !d.volumeExists(ctx, name) {
			fmt.Fprintf(w, "  skipped volume %s: it does not exist (normal for esdata in ES_MODE=cloud)\n", short)
			continue
		}
		file := filepath.Join(volDir, name+".tar")
		if _, err := d.Cmd.Run(ctx, "docker", "run", "--rm",
			"-v", name+":/v:ro", "-v", volDir+":/out", helperImage,
			"tar", "-cf", "/out/"+name+".tar", "-C", "/v", "."); err != nil {
			return "", fmt.Errorf("archiving volume %s: %w", short, err)
		}
		if _, err := os.Stat(file); err != nil {
			return "", fmt.Errorf("archiving volume %s: helper wrote no archive", short)
		}
		fmt.Fprintf(w, "  volume %s\n", short)
		included = append(included, short)
	}

	if _, err := os.Stat(d.CADir); err == nil {
		if err := copyTree(d.CADir, filepath.Join(stage, dirCA)); err != nil {
			return "", fmt.Errorf("copying the CA: %w", err)
		}
		fmt.Fprintf(w, "  CA %s\n", d.CADir)
	} else {
		fmt.Fprintf(w, "  skipped CA: %s does not exist (only achilles-ca mode has one)\n", d.CADir)
	}
	for _, f := range backedUpFiles {
		src := filepath.Join(d.RepoDir, f.rel)
		if _, err := os.Stat(src); err != nil {
			fmt.Fprintf(w, "  skipped %s: not found\n", f.rel)
			continue
		}
		if err := copyFile(src, filepath.Join(stage, filepath.FromSlash(f.name)), 0o600); err != nil {
			return "", err
		}
		fmt.Fprintf(w, "  %s\n", f.rel)
	}
	mf := fmt.Sprintf("projectachilles backup\ncreated: %s\nhost: %s\ntls_mode: %s\nproject: %s\nvolumes: %s\n",
		d.now().UTC().Format("2006-01-02T15:04:05Z"), d.Host, d.TLSMode, d.project(), strings.Join(included, " "))
	if err := os.WriteFile(filepath.Join(stage, manifest), []byte(mf), 0o600); err != nil {
		return "", err
	}

	stamp := d.now().UTC().Format("20060102T150405Z")
	var final string
	if d.zstdAvailable(ctx) {
		final = filepath.Join(dir, stamp+".tar.zst")
		// Compress inside a private 0700 directory, so the root-created file
		// (possibly 0644) is never readable from the shared backup dir.
		outDir, err := os.MkdirTemp(dir, ".out-")
		if err != nil {
			return "", err
		}
		defer os.RemoveAll(outDir)
		name := stamp + ".tar.zst.partial"
		part := filepath.Join(outDir, name)
		if _, err := d.Cmd.Run(ctx, "docker", "run", "--rm", "-v", stage+":/s:ro", "-v", outDir+":/o", helperImage,
			"tar", "--zstd", "-cf", "/o/"+name, "-C", "/s", "."); err != nil {
			return "", fmt.Errorf("compressing the backup: %w", err)
		}
		if err := os.Chmod(part, 0o600); err != nil {
			return "", err
		}
		if err := os.Rename(part, final); err != nil {
			return "", err
		}
		fmt.Fprintf(w, "Format: tar + zstd\n")
	} else {
		final = filepath.Join(dir, stamp+".tar.gz")
		if err := writeTarGz(stage, final); err != nil {
			return "", err
		}
		fmt.Fprintf(w, "Format: tar + gzip (the helper image has no zstd)\n")
	}
	fmt.Fprintf(w, "\nBackup written: %s\n", final)
	fmt.Fprintln(w, "WARNING: this file holds secrets (API keys, Clerk and session secrets, certificate keys) and the CA private keys.")
	fmt.Fprintln(w, "         Store it encrypted and off this server; anyone who reads it can impersonate your CA.")
	if _, err := os.Stat(filepath.Join(d.RepoDir, "deploy.config.env")); err != nil {
		fmt.Fprintln(w, noConfigWarning)
	}
	return final, nil
}

// Restore reverses Backup: it extracts and validates the archive first, then
// (after confirmation) stops the stack, restores the volumes, configuration
// files and CA, and brings the stack up again. The confirmation is typing the
// host name unless yes.
//
// It also works on a server that was never installed (a new appliance, new
// hardware): with no containers for the compose project there is nothing to
// stop. When the restored checkout has a deploy.config.env, the stack is
// brought up by re-running the engine on it, which also re-renders what the
// backup does not hold (deploy/caddy/rendered/, the hosts entry, the renewal
// timer); without one it falls back to compose up. When the config binds
// Caddy to an address this server does not have, it stops after restoring
// the data and says how to set the new address.
func Restore(ctx context.Context, d Deps, file string, yes bool) error {
	w := d.out()
	if _, err := os.Stat(file); err != nil {
		return err
	}
	expect := d.Host
	if expect == "" {
		expect = "restore"
	}
	if !yes {
		fmt.Fprintf(w, "Restoring %s will OVERWRITE this server's data volumes, configuration, .env files and CA with the backup's.\n", file)
		fmt.Fprintf(w, "Type %q to continue: ", expect)
		if readLine(bufio.NewReader(d.In)) != expect {
			return errCancelled
		}
	}

	stage, err := os.MkdirTemp(filepath.Dir(file), ".restore-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	if err := d.extract(ctx, file, stage); err != nil {
		return fmt.Errorf("reading the backup: %w", err)
	}
	if err := checkStage(stage); err != nil {
		return fmt.Errorf("refusing this backup: %w", err)
	}
	if _, err := os.Stat(filepath.Join(stage, manifest)); err != nil {
		return errors.New("not a ProjectAchilles backup (no MANIFEST)")
	}

	vols, _ := filepath.Glob(filepath.Join(stage, dirVolumes, "*.tar"))
	for _, tf := range vols {
		if !safeArchiveFile.MatchString(filepath.Base(tf)) {
			return fmt.Errorf("refusing this backup: unsafe volume archive name %q", filepath.Base(tf))
		}
	}

	project := d.restoreProject(stage)

	// A server that was never installed has no containers, and no .env for
	// compose to read the file with, so there is nothing to stop.
	ids, err := d.Cmd.Run(ctx, "docker", "ps", "-a", "-q", "--filter", "label=com.docker.compose.project="+project)
	if err != nil {
		return fmt.Errorf("listing the stack's containers: %w", err)
	}
	if strings.TrimSpace(string(ids)) == "" {
		fmt.Fprintf(w, "No containers for compose project %s on this server: nothing to stop.\n", project)
	} else {
		fmt.Fprintln(w, "Stopping the stack...")
		if _, err := d.compose(ctx, "stop"); err != nil {
			return fmt.Errorf("stopping the stack: %w", err)
		}
	}

	for _, tf := range vols {
		short := shortVolume(strings.TrimSuffix(filepath.Base(tf), ".tar"))
		if short == "" {
			fmt.Fprintf(w, "  ignoring unknown volume archive %s\n", filepath.Base(tf))
			continue
		}
		name := project + "_" + short
		if !d.volumeExists(ctx, name) {
			if _, err := d.Cmd.Run(ctx, "docker", "volume", "create",
				"--label", "com.docker.compose.project="+project,
				"--label", "com.docker.compose.volume="+short, name); err != nil {
				return fmt.Errorf("creating volume %s: %w", short, err)
			}
		}
		if _, err := d.Cmd.Run(ctx, "docker", "run", "--rm",
			"-v", name+":/v", "-v", filepath.Dir(tf)+":/s:ro", helperImage,
			"sh", "-c", `find /v -mindepth 1 -delete && tar -xf "/s/$1" -C /v`, "_", filepath.Base(tf)); err != nil {
			return fmt.Errorf("restoring volume %s: %w (the stack is stopped; fix the problem and run restore again)", short, err)
		}
		fmt.Fprintf(w, "  volume %s\n", short)
	}

	if _, err := os.Stat(filepath.Join(stage, dirCA)); err == nil {
		if err := copyTree(filepath.Join(stage, dirCA), d.CADir); err != nil {
			return fmt.Errorf("restoring the CA: %w", err)
		}
		if err := FixCAPerms(d.CADir); err != nil {
			return err
		}
		fmt.Fprintf(w, "  CA %s\n", d.CADir)
	}
	for _, f := range backedUpFiles {
		src := filepath.Join(stage, filepath.FromSlash(f.name))
		if _, err := os.Stat(src); err != nil {
			continue
		}
		if err := requireRegular(src); err != nil {
			return err
		}
		if err := copyFile(src, filepath.Join(d.RepoDir, f.rel), 0o600); err != nil {
			return err
		}
		fmt.Fprintf(w, "  %s\n", f.rel)
	}
	if err := setEnvFileValue(filepath.Join(d.RepoDir, ".env"), "COMPOSE_PROJECT_NAME", project); err != nil {
		return fmt.Errorf("pinning the compose project in .env: %w", err)
	}

	cfgPath := filepath.Join(d.RepoDir, "deploy.config.env")
	if _, err := os.Stat(cfgPath); err != nil {
		fmt.Fprintln(w, noConfigWarning)
		fmt.Fprintln(w, "Starting the stack...")
		if _, err := d.compose(ctx, "up", "-d"); err != nil {
			return fmt.Errorf("starting the stack: %w", err)
		}
		fmt.Fprintln(w, "Restore complete. Run achilles-installer status to check the stack.")
		return nil
	}

	c, err := config.Load(cfgPath)
	if err != nil {
		return fmt.Errorf("reading the restored %s: %w", cfgPath, err)
	}
	if ip := strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(c.CaddyBindIP), "["), "]"); ip != "" {
		local, err := d.hasLocalIP(ip)
		if err != nil {
			return fmt.Errorf("checking this server's addresses: %w (the data is restored)", err)
		}
		if !local {
			fmt.Fprintln(w, newAddressMessage(d.RepoDir, ip))
			return fmt.Errorf("the data is restored, but the stack was not started: %s is not an address of this server", ip)
		}
	}
	if d.RunEngine == nil {
		return errors.New("no installer engine configured")
	}
	fmt.Fprintf(w, "Re-running the installer with the restored %s...\n", cfgPath)
	if err := d.RunEngine(ctx); err != nil {
		return fmt.Errorf("the data is restored, but the installer run that starts the stack failed: %w", err)
	}
	fmt.Fprintln(w, "Restore complete. Run achilles-installer status to check the stack.")
	return nil
}

// newAddressMessage is what Restore prints when the restored config binds
// Caddy to an address this server does not have.
func newAddressMessage(repo, ip string) string {
	return fmt.Sprintf("The backup's server address %s is not on this server. Run `sudo %s install` and choose Reconfigure "+
		"to set this server's address (your data and CA are kept).", ip, filepath.Join(repo, "achilles-installer"))
}

func (d Deps) hasLocalIP(ip string) (bool, error) {
	if d.HasLocalIP != nil {
		return d.HasLocalIP(ip)
	}
	return sysprobe.HostHasIP(ip)
}

// restoreProject is the compose project the volumes are restored into. An
// installed server keeps its own (the backed-up root .env may name another,
// or none from before it was pinned). A server with no root .env was never
// installed: it takes the backup's pinned project, else the engine's default.
func (d Deps) restoreProject(stage string) string {
	if d.Project != "" || os.Getenv("COMPOSE_PROJECT_NAME") != "" {
		return d.project()
	}
	if _, err := os.Stat(filepath.Join(d.RepoDir, ".env")); err == nil {
		return d.project()
	}
	if p := envFileValue(filepath.Join(stage, "files", ".env"), "COMPOSE_PROJECT_NAME"); validProject.MatchString(p) {
		return p
	}
	return defaultProject
}

// safeArchiveFile is the only shape of volume archive name Restore will use.
var safeArchiveFile = regexp.MustCompile(`^[A-Za-z0-9_.-]+\.tar$`)

// shortVolume maps "<project>_esdata" to "esdata" (any project prefix).
func shortVolume(name string) string {
	for _, v := range backedUpVolumes {
		if name == v || strings.HasSuffix(name, "_"+v) {
			return v
		}
	}
	return ""
}

// FixCAPerms re-asserts the CA layout: directories 0700 (public/ 0755),
// private keys 0600, certificates 0644.
func FixCAPerms(dir string) error {
	return filepath.WalkDir(dir, func(p string, e fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		mode := os.FileMode(0o644)
		switch {
		case e.IsDir() && (p == dir || filepath.Base(p) != "public"):
			mode = 0o700
		case e.IsDir():
			mode = 0o755
		case strings.HasSuffix(p, ".key"):
			mode = 0o600
		}
		return os.Chmod(p, mode)
	})
}

// checkStage rejects anything but regular files and directories (symlinks,
// hardlinks to special files, devices, sockets) in an extracted backup.
func checkStage(stage string) error {
	return filepath.WalkDir(stage, func(p string, e fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		fi, err := os.Lstat(p)
		if err != nil {
			return err
		}
		if !fi.IsDir() && !fi.Mode().IsRegular() {
			rel, _ := filepath.Rel(stage, p)
			return fmt.Errorf("the archive contains %s, which is not a plain file or directory", rel)
		}
		return nil
	})
}

// validArchiveName reports whether an archive member name stays inside the
// extraction directory.
func validArchiveName(n string) bool {
	c := path.Clean(n)
	return !(path.IsAbs(c) || c == ".." || strings.HasPrefix(c, "../") || strings.HasPrefix(n, "/"))
}

func requireRegular(p string) error {
	fi, err := os.Lstat(p)
	if err != nil {
		return err
	}
	if !fi.Mode().IsRegular() {
		return fmt.Errorf("%s is not a regular file", p)
	}
	return nil
}

func mkdirPrivate(dir string) error {
	if _, err := os.Stat(dir); err == nil {
		return nil // an existing directory keeps the admin's permissions
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	return os.Chmod(dir, 0o700)
}

func copyFile(src, dst string, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".tmp-")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := io.Copy(tmp, in); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(mode); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), dst)
}

// copyTree copies regular files and directories (symlinks are skipped),
// keeping file modes; new directories are 0700.
func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(p string, e fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		target := filepath.Join(dst, rel)
		switch {
		case e.IsDir():
			if err := os.MkdirAll(target, 0o700); err != nil {
				return err
			}
			return nil
		case e.Type().IsRegular():
			fi, err := e.Info()
			if err != nil {
				return err
			}
			return copyFile(p, target, fi.Mode().Perm())
		}
		return nil
	})
}

func writeTarGz(stage, dst string) error {
	f, err := os.CreateTemp(filepath.Dir(dst), ".partial-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	gz := gzip.NewWriter(f)
	tw := tar.NewWriter(gz)
	err = filepath.WalkDir(stage, func(p string, e fs.DirEntry, err error) error {
		if err != nil || p == stage {
			return err
		}
		fi, err := e.Info()
		if err != nil || !(fi.IsDir() || fi.Mode().IsRegular()) {
			return err
		}
		rel, _ := filepath.Rel(stage, p)
		h, err := tar.FileInfoHeader(fi, "")
		if err != nil {
			return err
		}
		h.Name = filepath.ToSlash(rel)
		if fi.IsDir() {
			h.Name += "/"
		}
		h.Uname, h.Gname = "", ""
		if err := tw.WriteHeader(h); err != nil || fi.IsDir() {
			return err
		}
		in, err := os.Open(p)
		if err != nil {
			return err
		}
		defer in.Close()
		_, err = io.Copy(tw, in)
		return err
	})
	if err == nil {
		err = errors.Join(tw.Close(), gz.Close())
	}
	if err == nil {
		err = f.Chmod(0o600)
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return err
	}
	return os.Rename(f.Name(), dst)
}

// extract unpacks a backup into stage. .tar.gz is read here; .tar.zst needs
// the helper image.
func (d Deps) extract(ctx context.Context, file, stage string) error {
	if strings.HasSuffix(file, ".zst") {
		abs, err := filepath.Abs(file)
		if err != nil {
			return err
		}
		in := filepath.Dir(abs) + ":/in:ro"
		names, err := d.Cmd.Run(ctx, "docker", "run", "--rm", "-v", in, helperImage,
			"tar", "--zstd", "-tf", "/in/"+filepath.Base(abs))
		if err != nil {
			return err
		}
		for _, n := range strings.Split(string(names), "\n") {
			if n = strings.TrimSpace(n); n != "" && !validArchiveName(n) {
				return fmt.Errorf("unsafe path %q in archive", n)
			}
		}
		_, err = d.Cmd.Run(ctx, "docker", "run", "--rm", "-v", stage+":/s", "-v", in, helperImage,
			"tar", "--zstd", "-xf", "/in/"+filepath.Base(abs), "-C", "/s")
		return err
	}
	f, err := os.Open(file)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	tr := tar.NewReader(gz)
	root := filepath.Clean(stage) + string(os.PathSeparator)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		clean := path.Clean(h.Name)
		if clean == "." {
			continue
		}
		if !validArchiveName(h.Name) {
			return fmt.Errorf("unsafe path %q in archive", h.Name)
		}
		if h.Typeflag != tar.TypeDir && h.Typeflag != tar.TypeReg {
			return fmt.Errorf("%q in the archive is not a plain file or directory", h.Name)
		}
		dst := filepath.Join(stage, filepath.FromSlash(clean))
		if !strings.HasPrefix(dst, root) {
			return fmt.Errorf("unsafe path %q in archive", h.Name)
		}
		switch h.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(dst, 0o700); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
				return err
			}
			out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, os.FileMode(h.Mode).Perm()|0o600)
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, tr); err != nil {
				out.Close()
				return err
			}
			if err := out.Close(); err != nil {
				return err
			}
		}
	}
}
