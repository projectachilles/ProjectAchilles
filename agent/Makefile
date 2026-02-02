VERSION := 0.5.0
LDFLAGS := -s -w -X main.version=$(VERSION)
DIST := dist

.PHONY: build-all build-windows build-linux sign-windows clean checksum

build-all: build-windows build-linux checksum

build-windows:
	mkdir -p $(DIST)
	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
	  go build -ldflags "$(LDFLAGS)" -o $(DIST)/achilles-agent-windows-amd64.exe .

build-linux:
	mkdir -p $(DIST)
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
	  go build -ldflags "$(LDFLAGS)" -o $(DIST)/achilles-agent-linux-amd64 .

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

checksum:
	@echo "Computing checksums..."
	@cd $(DIST) && sha256sum * > SHA256SUMS 2>/dev/null || true
	@cat $(DIST)/SHA256SUMS 2>/dev/null || true

clean:
	rm -rf $(DIST)
