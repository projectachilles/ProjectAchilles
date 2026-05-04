VERSION := 0.6.2
LDFLAGS := -s -w -X main.version=$(VERSION)
DIST := dist

.PHONY: build-all build-windows build-linux build-darwin-amd64 build-darwin-arm64 \
        sign-windows sign-darwin clean checksum

build-all: build-windows build-linux build-darwin-amd64 build-darwin-arm64 checksum

build-windows:
	mkdir -p $(DIST)
	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
	  go build -ldflags "$(LDFLAGS)" -o $(DIST)/achilles-agent-windows-amd64.exe .

build-linux:
	mkdir -p $(DIST)
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
	  go build -ldflags "$(LDFLAGS)" -o $(DIST)/achilles-agent-linux-amd64 .

build-darwin-amd64:
	mkdir -p $(DIST)
	GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 \
	  go build -ldflags "$(LDFLAGS)" -o $(DIST)/achilles-agent-darwin-amd64 .

build-darwin-arm64:
	mkdir -p $(DIST)
	GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 \
	  go build -ldflags "$(LDFLAGS)" -o $(DIST)/achilles-agent-darwin-arm64 .

sign-windows: build-windows
	@# Three sources for the signing cert, in priority order:
	@#   1. F0_SIGN_CERT_PATH + F0_SIGN_CERT_PASS env vars  — explicit override (CI etc.)
	@#   2. Active cert in ~/.projectachilles/certs/<id>/cert.pfx + decrypted password
	@#      via the running local backend, exposed at /api/tests/signing/cert-pass
	@#      (only available when local backend is up — tells the user how to use it)
	@#   3. Legacy ~/.projectachilles/certs/cert.pfx + cert-pass.txt (pre-Feb-2026 layout)
	@#
	@# Most users should let the Web UI build & sign — it has a fully-decrypted
	@# password already in memory. This Makefile target is for CI / advanced flows.
	@CERT_PATH=""; CERT_PASS=""; \
	if [ -n "$$F0_SIGN_CERT_PATH" ] && [ -n "$$F0_SIGN_CERT_PASS" ]; then \
	  CERT_PATH="$$F0_SIGN_CERT_PATH"; CERT_PASS="$$F0_SIGN_CERT_PASS"; \
	elif [ -f "$$HOME/.projectachilles/certs/cert.pfx" ] && [ -f "$$HOME/.projectachilles/certs/cert-pass.txt" ]; then \
	  CERT_PATH="$$HOME/.projectachilles/certs/cert.pfx"; \
	  CERT_PASS="$$(cat $$HOME/.projectachilles/certs/cert-pass.txt 2>/dev/null)"; \
	elif [ -f "$$HOME/.projectachilles/certs/active-cert.txt" ]; then \
	  ACTIVE=$$(cat "$$HOME/.projectachilles/certs/active-cert.txt"); \
	  if [ -f "$$HOME/.projectachilles/certs/$$ACTIVE/cert.pfx" ]; then \
	    echo "Active cert is at ~/.projectachilles/certs/$$ACTIVE/cert.pfx"; \
	    echo "Password is encrypted in cert-meta.json. Either:"; \
	    echo "  - export F0_SIGN_CERT_PATH=~/.projectachilles/certs/$$ACTIVE/cert.pfx"; \
	    echo "    export F0_SIGN_CERT_PASS=<decrypted password>"; \
	    echo "  - or use the Web UI Build feature (handles decryption automatically)"; \
	    echo "Skipping signing — binary remains unsigned."; \
	    exit 0; \
	  fi; \
	fi; \
	if [ -z "$$CERT_PATH" ]; then \
	  echo "No certificate found, skipping signing"; \
	  exit 0; \
	fi; \
	echo "Signing Windows binary with $$CERT_PATH..."; \
	osslsigncode sign \
	  -pkcs12 "$$CERT_PATH" \
	  -pass "$$CERT_PASS" \
	  -in $(DIST)/achilles-agent-windows-amd64.exe \
	  -out $(DIST)/achilles-agent-windows-amd64-signed.exe && \
	mv $(DIST)/achilles-agent-windows-amd64-signed.exe \
	   $(DIST)/achilles-agent-windows-amd64.exe

sign-darwin: build-darwin-amd64 build-darwin-arm64
	@if command -v rcodesign >/dev/null 2>&1; then \
	  echo "Signing darwin binaries (ad-hoc)..."; \
	  rcodesign sign $(DIST)/achilles-agent-darwin-amd64; \
	  rcodesign sign $(DIST)/achilles-agent-darwin-arm64; \
	else \
	  echo "rcodesign not found, skipping macOS signing"; \
	fi

checksum:
	@echo "Computing checksums..."
	@cd $(DIST) && sha256sum achilles-agent-* > SHA256SUMS
	@cat $(DIST)/SHA256SUMS

clean:
	rm -rf $(DIST)
