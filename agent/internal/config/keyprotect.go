package config

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"strings"
)

// derivationSalt is a fixed context string used in HMAC-SHA256 key derivation.
// Kept for backward-compatible decryption of legacy (v1) encrypted keys.
const derivationSalt = "achilles-agent-config-v1"

const (
	// kdfIterations is the PBKDF2 iteration count (OWASP 2023 recommendation for SHA-256).
	kdfIterations = 210_000
	// kdfSaltLen is the byte length of the random per-encryption salt.
	kdfSaltLen = 16
	// encryptionVersionPrefix tags v2 ciphertexts so they can be distinguished from legacy format.
	encryptionVersionPrefix = "v2:"
)

// deriveKey produces a 32-byte AES-256 key from a machine ID using
// PBKDF2-SHA256 with a random salt and 210,000 iterations.
func deriveKey(machineID string, salt []byte) ([]byte, error) {
	return pbkdf2.Key(sha256.New, machineID, salt, kdfIterations, 32)
}

// deriveKeyLegacy produces a 32-byte AES-256 key using the original single-pass
// HMAC-SHA256 derivation. Used only for decrypting legacy (pre-v2) configs.
func deriveKeyLegacy(machineID string) []byte {
	mac := hmac.New(sha256.New, []byte(derivationSalt))
	mac.Write([]byte(machineID))
	return mac.Sum(nil) // 32 bytes
}

// encryptAgentKey encrypts a plaintext agent key using AES-256-GCM with a
// PBKDF2-derived key. Returns "v2:" + base64(salt + nonce + ciphertext + tag).
func encryptAgentKey(plaintext string) (string, error) {
	if plaintext == "" {
		return "", fmt.Errorf("cannot encrypt empty agent key")
	}

	machineID, err := getMachineID()
	if err != nil {
		return "", fmt.Errorf("get machine ID: %w", err)
	}

	salt := make([]byte, kdfSaltLen)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return "", fmt.Errorf("generate salt: %w", err)
	}

	key, err := deriveKey(machineID, salt)
	if err != nil {
		return "", fmt.Errorf("derive key: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create AES cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("create GCM: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("generate nonce: %w", err)
	}

	// Build: salt + nonce + ciphertext + tag
	payload := make([]byte, kdfSaltLen+gcm.NonceSize())
	copy(payload, salt)
	copy(payload[kdfSaltLen:], nonce)
	sealed := gcm.Seal(payload, nonce, []byte(plaintext), nil)

	return encryptionVersionPrefix + base64.StdEncoding.EncodeToString(sealed), nil
}

// decryptAgentKey decrypts a base64-encoded AES-256-GCM ciphertext using the
// machine-derived key. Handles both v2 (PBKDF2) and legacy (HMAC) formats.
// Returns the plaintext and whether the input was legacy format (for auto-migration).
func decryptAgentKey(encrypted string) (string, error) {
	if encrypted == "" {
		return "", fmt.Errorf("cannot decrypt empty ciphertext")
	}

	machineID, err := getMachineID()
	if err != nil {
		return "", fmt.Errorf("get machine ID: %w", err)
	}

	if strings.HasPrefix(encrypted, encryptionVersionPrefix) {
		return decryptV2(encrypted[len(encryptionVersionPrefix):], machineID)
	}
	return decryptLegacy(encrypted, machineID)
}

// isLegacyEncrypted returns true if the ciphertext uses the legacy (pre-v2) format.
func isLegacyEncrypted(encrypted string) bool {
	return encrypted != "" && !strings.HasPrefix(encrypted, encryptionVersionPrefix)
}

// decryptV2 handles the v2 format: base64(salt + nonce + ciphertext + tag).
func decryptV2(b64 string, machineID string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return "", fmt.Errorf("base64 decode: %w", err)
	}

	if len(data) < kdfSaltLen {
		return "", fmt.Errorf("ciphertext too short for salt")
	}

	salt := data[:kdfSaltLen]
	remainder := data[kdfSaltLen:]

	key, err := deriveKey(machineID, salt)
	if err != nil {
		return "", fmt.Errorf("derive key: %w", err)
	}
	return decryptGCM(key, remainder)
}

// decryptLegacy handles the legacy format: base64(nonce + ciphertext + tag).
func decryptLegacy(encrypted string, machineID string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(encrypted)
	if err != nil {
		return "", fmt.Errorf("base64 decode: %w", err)
	}

	key := deriveKeyLegacy(machineID)
	return decryptGCM(key, data)
}

// decryptGCM performs AES-256-GCM decryption given a key and nonce+ciphertext+tag.
func decryptGCM(key []byte, data []byte) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create AES cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("create GCM: %w", err)
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}

	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("decryption failed (config may have been moved from another machine): %w", err)
	}

	return string(plaintext), nil
}
