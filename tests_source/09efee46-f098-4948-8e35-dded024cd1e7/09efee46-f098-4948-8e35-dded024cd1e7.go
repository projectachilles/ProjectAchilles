//go:build windows
// +build windows

/*
ID: 09efee46-f098-4948-8e35-dded024cd1e7
NAME: Sliver C2 Client Detection
TECHNIQUE: T1219
UNIT: response
CREATED: 2025-04-22 14:30:00.000000
*/
package main

import (
	_ "embed"

	Dropper "github.com/preludeorg/libraries/go/tests/dropper"
	Endpoint "github.com/preludeorg/libraries/go/tests/endpoint"
)

//go:embed sliver_client.exe
var malicious []byte

func execute() error {
	// Command to start the sliver client
	// In a real scenario, this would attempt to connect to a C2 server
	command := []string{
		".\\sliver_client.exe", "--help",
	}

	// Execute the command
	_, err := Endpoint.Shell(command)
	if err != nil {
		return err
	}

	return nil
}

func test() {
	// Initialize the dropper
	if err := Endpoint.Dropper(Dropper.Dropper); err != nil {
		Endpoint.Say("%v", err)
		Endpoint.Stop(Endpoint.UnexpectedTestError)
	}

	// Extract the sliver client binary and check if it gets quarantined
	Endpoint.Say("Extracting Sliver C2 client for quarantine test")
	Endpoint.Say("Pausing for 3 seconds to gauge defensive reaction")
	Endpoint.Wait(3)

	if Endpoint.Quarantined("sliver_client.exe", malicious) {
		Endpoint.Say("Sliver client binary was caught!")
		Endpoint.Stop(Endpoint.FileQuarantinedOnExtraction)
	}

	Endpoint.Say("Sliver client binary was not caught, attempting execution")

	// Try to execute the sliver client
	err := execute()
	if err != nil {
		Endpoint.Say("Got error \"%v\" when executing Sliver client", err)
		Endpoint.Stop(Endpoint.ExecutionPrevented)
	}

	Endpoint.Say("Sliver client execution was not prevented")
	Endpoint.Stop(Endpoint.Unprotected)
}

func main() {
	Endpoint.Start(test)
}
