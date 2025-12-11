// stage-T1497.001-1.go
// LimaCharlie Timeout Validation Harness - Stage 1
// Waits for 2 minutes (120 seconds) with progress logging
// Exit code: 101 (Endpoint.Unprotected)

package main

import (
	"fmt"
	"os"
	"time"
)

const (
	STAGE_NAME     = "Stage 1: Timeout Validation"
	WAIT_DURATION  = 120 // seconds
	LOG_INTERVAL   = 30  // seconds
)

func main() {
	fmt.Printf("[STAGE 1] Starting - Will wait for %d seconds\n", WAIT_DURATION)
	fmt.Printf("[STAGE 1] Progress will be logged every %d seconds\n", LOG_INTERVAL)

	startTime := time.Now()
	iterations := WAIT_DURATION / LOG_INTERVAL

	for i := 1; i <= iterations; i++ {
		time.Sleep(time.Duration(LOG_INTERVAL) * time.Second)
		elapsed := i * LOG_INTERVAL
		remaining := WAIT_DURATION - elapsed
		fmt.Printf("[STAGE 1] Progress: %d/%d seconds elapsed, %d seconds remaining\n",
			elapsed, WAIT_DURATION, remaining)
	}

	totalElapsed := time.Since(startTime)
	fmt.Printf("[STAGE 1] Completed in %v\n", totalElapsed.Round(time.Second))
	fmt.Printf("[STAGE 1] Exiting with code 101 (Endpoint.Unprotected)\n")

	os.Exit(101)
}
