package config

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
)

// derivationSalt is a fixed context string used in HMAC-SHA256 key derivation.
// It ensures the derived AES key is domain-separated from other uses of the
// same machine ID.
const derivationSalt = "achilles-agent-config-v1"

// deriveKey produces a 32-byte AES-256 key from a machine ID using
// HMAC-SHA256(key=salt, message=machineID). The machine ID is already
// high-entropy (UUID), so a full KDF like Argon2 is unnecessary.
func deriveKey(machineID string) []byte {
	mac := hmac.New(sha256.New, []byte(derivationSalt))
	mac.Write([]byte(machineID))
	return mac.Sum(nil) // 32 bytes
}

// encryptAgentKey encrypts a plaintext agent key using AES-256-GCM with a
// machine-derived key. Returns base64(nonce + ciphertext + tag).
func encryptAgentKey(plaintext string) (string, error) {
	if plaintext == "" {
		return "", fmt.Errorf("cannot encrypt empty agent key")
	}

	machineID, err := getMachineID()
	if err != nil {
		return "", fmt.Errorf("get machine ID: %w", err)
	}

	key := deriveKey(machineID)

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

	// Seal appends ciphertext+tag to nonce
	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// decryptAgentKey decrypts a base64-encoded AES-256-GCM ciphertext using the
// machine-derived key. Fails if the config was encrypted on a different machine.
func decryptAgentKey(encrypted string) (string, error) {
	if encrypted == "" {
		return "", fmt.Errorf("cannot decrypt empty ciphertext")
	}

	machineID, err := getMachineID()
	if err != nil {
		return "", fmt.Errorf("get machine ID: %w", err)
	}

	key := deriveKey(machineID)

	data, err := base64.StdEncoding.DecodeString(encrypted)
	if err != nil {
		return "", fmt.Errorf("base64 decode: %w", err)
	}

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
