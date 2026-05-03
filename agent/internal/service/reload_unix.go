//go:build linux || darwin

package service

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
)

// startReloadListener spawns a goroutine that listens for SIGHUP and writes
// to the returned channel. The channel is buffered so a flurry of SIGHUPs
// coalesces into one reload (matching kernel signal-coalescing semantics).
//
// The goroutine exits when ctx is cancelled.
func startReloadListener(ctx context.Context) <-chan struct{} {
	out := make(chan struct{}, 1)
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGHUP)

	go func() {
		defer signal.Stop(sigCh)
		for {
			select {
			case <-ctx.Done():
				return
			case <-sigCh:
				log.Println("SIGHUP received, requesting config reload")
				select {
				case out <- struct{}{}:
				default:
					// Reload already pending; drop this one.
				}
			}
		}
	}()
	return out
}
