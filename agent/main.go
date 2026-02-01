package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/f0rt1ka/achilles-agent/internal/config"
	"github.com/f0rt1ka/achilles-agent/internal/enrollment"
	"github.com/f0rt1ka/achilles-agent/internal/poller"
	"github.com/f0rt1ka/achilles-agent/internal/store"
)

var version = "0.1.0"

func main() {
	enroll := flag.String("enroll", "", "Enrollment token")
	server := flag.String("server", "", "Server URL (required with --enroll)")
	install := flag.Bool("install", false, "Install as system service after enrollment")
	uninstall := flag.Bool("uninstall", false, "Uninstall the agent service")
	status := flag.Bool("status", false, "Show agent status")
	showVersion := flag.Bool("version", false, "Print version and exit")
	configPath := flag.String("config", config.DefaultConfigPath(), "Path to config file")
	run := flag.Bool("run", false, "Run agent in foreground")

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
		if err := enrollment.Enroll(*server, *enroll, *configPath); err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
		if *install {
			fmt.Println("[placeholder] Installing agent as system service")
		}
		os.Exit(0)
	}

	if *uninstall {
		fmt.Println("[placeholder] Uninstalling agent service")
		os.Exit(0)
	}

	if *status {
		fmt.Println("[placeholder] Agent status")
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

	if *run {
		log.Printf("Running agent in foreground (server=%s, poll=%s)", cfg.ServerURL, cfg.PollInterval)

		st, err := store.New(cfg.WorkDir)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error initializing store: %v\n", err)
			os.Exit(1)
		}

		ctx := context.Background()
		if err := poller.Run(ctx, cfg, st, version); err != nil && err != context.Canceled {
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
