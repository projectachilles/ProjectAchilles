//go:build windows
// +build windows

/*
ID: b83616c2-84ee-4738-b398-d2d57eebecec
NAME: NativeDump (NimDump) Detection
TECHNIQUE: T1003.001
UNIT: response
CREATED: 2025-01-03 15:30:00.000000
*/
package main

import (
	_ "embed"
	"fmt"
	"os"
	"path/filepath"

	Dropper "github.com/preludeorg/libraries/go/tests/dropper"
	Endpoint "github.com/preludeorg/libraries/go/tests/endpoint"
)

//go:embed library_update.exe
var malicious []byte

func execute() error {
	// Get the current working directory
	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("failed to get current directory: %v", err)
	}

	// Create output filename for the dump (disguised as document.docx)
	dumpFile := filepath.Join(cwd, "document.docx")

	// Command to run NimDump with -r flag and output to document.docx
	command := []string{
		".\\library_update.exe", "-r", "-o:c:\\F0\\document.docx",
	}

	// Execute the command
	_, err = Endpoint.Shell(command)
	if err != nil {
		return err
	}

	// Check if dump file was created
	if _, err := os.Stat(dumpFile); err == nil {
		// Clean up the dump file
		os.Remove(dumpFile)
		Endpoint.Say("Dump file (document.docx) was created and cleaned up")
	}

	return nil
}

func test() {
	// Initialize the dropper
	if err := Endpoint.Dropper(Dropper.Dropper); err != nil {
		Endpoint.Say("%v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	// Extract the NimDump binary and check if it gets quarantined
	Endpoint.Say("Extracting NimDump tool for quarantine test")
	Endpoint.Say("Pausing for 3 seconds to gauge defensive reaction")
	Endpoint.Wait(3)

	if Endpoint.Quarantined("library_update.exe", malicious) {
		Endpoint.Say("NimDump binary was caught!")
		Endpoint.Stop(Endpoint.FileQuarantinedOnExtraction)
	}

	Endpoint.Say("NimDump binary was not caught, attempting execution")

	// Try to execute NimDump
	err := execute()
	if err != nil {
		Endpoint.Say("Got error \"%v\" when executing NimDump", err)
		Endpoint.Stop(Endpoint.ExecutionPrevented)
	}

	Endpoint.Say("NimDump execution was not prevented - LSASS dump attempt succeeded")
	Endpoint.Stop(Endpoint.Unprotected)
}

func main() {
	Endpoint.Start(test)
}
