VERSION := 0.6.0
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
	@if [ -f "$$HOME/.projectachilles/certs/cert.pfx" ]; then \
	  echo "Signing Windows binary..."; \
	  osslsigncode sign \
	    -pkcs12 "$$HOME/.projectachilles/certs/cert.pfx" \
	    -pass "$$(cat $$HOME/.projectachilles/certs/cert-pass.txt 2>/dev/null)" \
	    -in $(DIST)/achilles-agent-windows-amd64.exe \
	    -out $(DIST)/achilles-agent-windows-amd64-signed.exe && \
	  mv $(DIST)/achilles-agent-windows-amd64-signed.exe \
	     $(DIST)/achilles-agent-windows-amd64.exe; \
	else \
	  echo "No certificate found at ~/.projectachilles/certs/cert.pfx, skipping signing"; \
	fi

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
