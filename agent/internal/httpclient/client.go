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

// Client wraps http.Client with agent-specific auth headers and retry logic.
type Client struct {
	http    *http.Client
	config  *config.Config
	version string
}

// NewClient creates a Client configured with TLS settings from cfg and a 30s timeout.
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

	transport := &http.Transport{
		TLSClientConfig: tlsConfig,
	}

	return &Client{
		http: &http.Client{
			Timeout:   30 * time.Second,
			Transport: transport,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 10 {
					return fmt.Errorf("too many redirects")
				}
				if len(via) > 0 && via[len(via)-1].URL.Scheme == "https" && req.URL.Scheme == "http" {
					return fmt.Errorf("refusing redirect from %s to %s: HTTPS to HTTP downgrade", via[len(via)-1].URL, req.URL)
				}
				return nil
			},
		},
		config:  cfg,
		version: version,
	}
}

// Do sends an HTTP request with agent auth headers, JSON body marshalling,
// and exponential backoff on 429/5xx responses (max 3 retries).
func (c *Client) Do(ctx context.Context, method, path string, body interface{}) (*http.Response, error) {
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

		resp, err := c.http.Do(req)
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
