package main

import (
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"

	"github.com/f0rt1ka/achilles-agent/internal/config"
	"github.com/f0rt1ka/achilles-agent/internal/enrollment"
	"github.com/f0rt1ka/achilles-agent/internal/service"
	"github.com/f0rt1ka/achilles-agent/internal/store"
)

var version = "0.3.0"

func main() {
	enroll := flag.String("enroll", "", "Enrollment token")
	server := flag.String("server", "", "Server URL (required with --enroll)")
	install := flag.Bool("install", false, "Install as system service after enrollment")
	uninstall := flag.Bool("uninstall", false, "Uninstall the agent service")
	status := flag.Bool("status", false, "Show agent status")
	showVersion := flag.Bool("version", false, "Print version and exit")
	configPath := flag.String("config", config.DefaultConfigPath(), "Path to config file")
	run := flag.Bool("run", false, "Run agent in foreground")
	allowInsecure := flag.Bool("allow-insecure", false, "Allow skip_tls_verify for remote servers (NOT recommended)")

	flag.Parse()

	if *showVersion {
		fmt.Printf("achilles-agent v%s\n", version)
		os.Exit(0)
	}

	if *enroll != "" {
		if *server == "" {
			fmt.Fprintln(os.Stderr, "error: --server is required with --enroll")
			os.Exit(1)
		}
		if err := enrollment.Enroll(*server, *enroll, *configPath, version); err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
		if *install {
			if err := service.Install(*configPath); err != nil {
				fmt.Fprintf(os.Stderr, "install error: %v\n", err)
				os.Exit(1)
			}
		}
		os.Exit(0)
	}

	if *uninstall {
		if err := service.Uninstall(); err != nil {
			fmt.Fprintf(os.Stderr, "uninstall error: %v\n", err)
			os.Exit(1)
		}
		os.Exit(0)
	}

	if *status {
		cfg, err := config.Load(*configPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "not enrolled (no config at %s)\n", *configPath)
			os.Exit(1)
		}
		fmt.Printf("Agent ID: %s\n", cfg.AgentID)
		fmt.Printf("Server:   %s\n", cfg.ServerURL)
		fmt.Printf("Version:  %s\n", version)
		os.Exit(0)
	}

	// Default: load config and run or print usage
	cfg, err := config.Load(*configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}

	if err := cfg.Validate(); err != nil {
		fmt.Fprintf(os.Stderr, "config validation error: %v\n", err)
		os.Exit(1)
	}

	if err := cfg.ValidateTLSConfig(*allowInsecure); err != nil {
		fmt.Fprintf(os.Stderr, "TLS config error: %v\n", err)
		os.Exit(1)
	}
	if *allowInsecure && cfg.SkipTLSVerify {
		log.Println("WARNING: TLS certificate verification is disabled via --allow-insecure. This is NOT recommended for production.")
	}

	// Harden own binary permissions on every startup.
	// Fixes permissions left by older applyUpdate() code in a single restart cycle.
	if exe, err := os.Executable(); err == nil {
		if resolved, err := filepath.EvalSymlinks(exe); err == nil {
			if err := config.SecureBinaryPermissions(resolved); err != nil {
				log.Printf("warning: could not secure binary permissions: %v", err)
			}
		}
	}

	if *run {
		// Wire up log file if configured. When running as a Windows service,
		// os.Stderr is typically a null handle — io.MultiWriter stops on the
		// first writer error and never reaches the file. Put the file first
		// so logs are always written, with stderr as a best-effort copy.
		if cfg.LogFile != "" {
			f, err := os.OpenFile(cfg.LogFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0640)
			if err != nil {
				fmt.Fprintf(os.Stderr, "warning: could not open log file %s: %v\n", cfg.LogFile, err)
			} else {
				log.SetOutput(io.MultiWriter(f, os.Stderr))
			}
		}

		log.Printf("Starting agent v%s (server=%s, poll=%s, update=%s)",
			version, cfg.ServerURL, cfg.PollInterval, cfg.UpdateInterval)

		st, err := store.New(cfg.WorkDir)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error initializing store: %v\n", err)
			os.Exit(1)
		}

		if err := service.RunService(cfg, st, version); err != nil {
			fmt.Fprintf(os.Stderr, "agent error: %v\n", err)
			os.Exit(1)
		}
		os.Exit(0)
	}

	fmt.Println("achilles-agent: no command specified")
	fmt.Println("Usage:")
	fmt.Println("  --enroll TOKEN --server URL  Enroll this agent")
	fmt.Println("  --run                        Run agent in foreground")
	fmt.Println("  --status                     Show agent status")
	fmt.Println("  --uninstall                  Remove agent service")
	fmt.Println("  --version                    Print version")
}
