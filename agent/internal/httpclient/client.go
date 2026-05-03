package httpclient

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"time"

	"github.com/f0rt1ka/achilles-agent/internal/config"
)

// quickRequestTimeout bounds short JSON calls (heartbeat, status, metadata).
// Streaming downloads use streamHeaderTimeout via Transport instead so the
// per-request budget can scale with body size.
const (
	quickRequestTimeout = 30 * time.Second
	streamHeaderTimeout = 30 * time.Second
	streamIdleTimeout   = 90 * time.Second
)

// Client wraps two http.Client instances with agent-specific auth headers and
// retry logic: one with a short total-request timeout for metadata calls, and
// one with no overall timeout for streaming binary downloads (bounded only by
// the caller's context and a header-receipt deadline).
type Client struct {
	httpQuick  *http.Client
	httpStream *http.Client
	config     *config.Config
	version    string
}

// NewClient creates a Client configured with TLS settings from cfg, a 30s
// timeout for short requests, and a separate streaming client whose total
// duration is bounded only by the caller's context.
func NewClient(cfg *config.Config, version string) *Client {
	tlsConfig := &tls.Config{
		InsecureSkipVerify: cfg.SkipTLSVerify,
		MinVersion:         tls.VersionTLS12,
	}

	if cfg.CACert != "" {
		caCert, err := os.ReadFile(cfg.CACert)
		if err == nil {
			pool := x509.NewCertPool()
			pool.AppendCertsFromPEM(caCert)
			tlsConfig.RootCAs = pool
		}
	}

	checkRedirect := func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return fmt.Errorf("too many redirects")
		}
		if len(via) > 0 && via[len(via)-1].URL.Scheme == "https" && req.URL.Scheme == "http" {
			return fmt.Errorf("refusing redirect from %s to %s: HTTPS to HTTP downgrade", via[len(via)-1].URL, req.URL)
		}
		return nil
	}

	quickTransport := &http.Transport{
		TLSClientConfig: tlsConfig,
	}

	streamTransport := &http.Transport{
		TLSClientConfig:       tlsConfig,
		ResponseHeaderTimeout: streamHeaderTimeout,
		IdleConnTimeout:       streamIdleTimeout,
	}

	return &Client{
		httpQuick: &http.Client{
			Timeout:       quickRequestTimeout,
			Transport:     quickTransport,
			CheckRedirect: checkRedirect,
		},
		httpStream: &http.Client{
			Transport:     streamTransport,
			CheckRedirect: checkRedirect,
		},
		config:  cfg,
		version: version,
	}
}

// Do sends an HTTP request with agent auth headers, JSON body marshalling,
// and exponential backoff on 429/5xx responses (max 3 retries). Bounded by
// a 30s total-request timeout — suitable for heartbeat, status, and metadata.
// For streaming binary downloads, use DoStream.
func (c *Client) Do(ctx context.Context, method, path string, body interface{}) (*http.Response, error) {
	return c.doInternal(ctx, c.httpQuick, method, path, body)
}

// DoStream is identical to Do but uses an http.Client with no total-request
// timeout — only the caller's context and a header-receipt deadline bound the
// request. Use for endpoints that stream large response bodies (binary
// downloads, agent self-update) where the response body read can legitimately
// exceed 30 seconds. The caller is responsible for setting a context timeout
// appropriate to the expected payload size.
func (c *Client) DoStream(ctx context.Context, method, path string, body interface{}) (*http.Response, error) {
	return c.doInternal(ctx, c.httpStream, method, path, body)
}

// doInternal executes a request against the given http.Client, applying auth
// headers, body marshalling, and retry-on-429/5xx logic. Retries occur before
// any body reads happen, so they are safe even for streaming clients.
func (c *Client) doInternal(ctx context.Context, hc *http.Client, method, path string, body interface{}) (*http.Response, error) {
	url := c.config.ServerURL + path

	const maxRetries = 3

	for attempt := 0; attempt <= maxRetries; attempt++ {
		var reqBody *bytes.Buffer
		if body != nil {
			data, err := json.Marshal(body)
			if err != nil {
				return nil, fmt.Errorf("marshal request body: %w", err)
			}
			reqBody = bytes.NewBuffer(data)
		}

		var req *http.Request
		var err error
		if reqBody != nil {
			req, err = http.NewRequestWithContext(ctx, method, url, reqBody)
		} else {
			req, err = http.NewRequestWithContext(ctx, method, url, nil)
		}
		if err != nil {
			return nil, fmt.Errorf("create request: %w", err)
		}

		req.Header.Set("Authorization", "Bearer "+c.config.AgentKey)
		req.Header.Set("X-Agent-ID", c.config.AgentID)
		req.Header.Set("X-Agent-Version", c.version)
		req.Header.Set("X-Request-Timestamp", time.Now().UTC().Format(time.RFC3339))
		req.Header.Set("Content-Type", "application/json")

		resp, err := hc.Do(req)
		if err != nil {
			if attempt < maxRetries {
				select {
				case <-ctx.Done():
					return nil, ctx.Err()
				case <-time.After(backoff(attempt)):
					continue
				}
			}
			return nil, fmt.Errorf("http request: %w", err)
		}

		// Retry on 429 or 5xx
		if resp.StatusCode == 429 || resp.StatusCode >= 500 {
			resp.Body.Close()
			if attempt < maxRetries {
				select {
				case <-ctx.Done():
					return nil, ctx.Err()
				case <-time.After(backoff(attempt)):
					continue
				}
			}
			return nil, fmt.Errorf("request failed after %d retries: status %d", maxRetries+1, resp.StatusCode)
		}

		return resp, nil
	}

	// Unreachable, but satisfy the compiler.
	return nil, fmt.Errorf("request failed after retries")
}

// backoff returns exponential backoff duration: 1s, 2s, 4s, ...
func backoff(attempt int) time.Duration {
	return time.Duration(math.Pow(2, float64(attempt))) * time.Second
}
