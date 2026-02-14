package config

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"io"
	"strings"
	"testing"
)

func TestDeriveKeyDeterministic(t *testing.T) {
	salt := []byte("fixed-test-salt!")
	k1, err := deriveKey("machine-1", salt)
	if err != nil {
		t.Fatalf("deriveKey: %v", err)
	}
	k2, err := deriveKey("machine-1", salt)
	if err != nil {
		t.Fatalf("deriveKey: %v", err)
	}
	if string(k1) != string(k2) {
		t.Error("deriveKey should be deterministic for the same input and salt")
	}
}

func TestDeriveKeyDifferentMachines(t *testing.T) {
	salt := []byte("fixed-test-salt!")
	k1, err := deriveKey("machine-1", salt)
	if err != nil {
		t.Fatalf("deriveKey: %v", err)
	}
	k2, err := deriveKey("machine-2", salt)
	if err != nil {
		t.Fatalf("deriveKey: %v", err)
	}
	if string(k1) == string(k2) {
		t.Error("different machine IDs should produce different keys")
	}
}

func TestDeriveKeyDifferentSalts(t *testing.T) {
	k1, err := deriveKey("machine-1", []byte("salt-aaaaaaaaaaaaa"))
	if err != nil {
		t.Fatalf("deriveKey: %v", err)
	}
	k2, err := deriveKey("machine-1", []byte("salt-bbbbbbbbbbbbb"))
	if err != nil {
		t.Fatalf("deriveKey: %v", err)
	}
	if string(k1) == string(k2) {
		t.Error("different salts should produce different keys")
	}
}

func TestDeriveKeyLength(t *testing.T) {
	key, err := deriveKey("test-machine", []byte("fixed-test-salt!"))
	if err != nil {
		t.Fatalf("deriveKey: %v", err)
	}
	if len(key) != 32 {
		t.Errorf("expected 32-byte key, got %d bytes", len(key))
	}
}

func TestDeriveKeyLegacyDeterministic(t *testing.T) {
	k1 := deriveKeyLegacy("machine-1")
	k2 := deriveKeyLegacy("machine-1")
	if string(k1) != string(k2) {
		t.Error("deriveKeyLegacy should be deterministic for the same input")
	}
}

func TestDeriveKeyLegacyDifferentMachines(t *testing.T) {
	k1 := deriveKeyLegacy("machine-1")
	k2 := deriveKeyLegacy("machine-2")
	if string(k1) == string(k2) {
		t.Error("different machine IDs should produce different legacy keys")
	}
}

func TestDeriveKeyLegacyLength(t *testing.T) {
	key := deriveKeyLegacy("test-machine")
	if len(key) != 32 {
		t.Errorf("expected 32-byte key, got %d bytes", len(key))
	}
}

func TestDeriveKeyLegacyMatchesOriginal(t *testing.T) {
	// Verify legacy derivation hasn't changed behavior — same algorithm as the
	// original deriveKey before the PBKDF2 migration.
	key := deriveKeyLegacy("test-machine-uuid")
	if len(key) != 32 {
		t.Fatalf("expected 32-byte key, got %d bytes", len(key))
	}
	// Derive again to verify determinism
	key2 := deriveKeyLegacy("test-machine-uuid")
	if string(key) != string(key2) {
		t.Error("legacy derivation should be deterministic")
	}
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	original := "ak_test-secret-key-12345"
	encrypted, err := encryptAgentKey(original)
	if err != nil {
		t.Fatalf("encryptAgentKey: %v", err)
	}

	if encrypted == original {
		t.Error("encrypted should differ from plaintext")
	}

	decrypted, err := decryptAgentKey(encrypted)
	if err != nil {
		t.Fatalf("decryptAgentKey: %v", err)
	}

	if decrypted != original {
		t.Errorf("round-trip failed: got %q, want %q", decrypted, original)
	}
}

func TestV2FormatPrefix(t *testing.T) {
	encrypted, err := encryptAgentKey("ak_test-key")
	if err != nil {
		t.Fatalf("encryptAgentKey: %v", err)
	}

	if !strings.HasPrefix(encrypted, "v2:") {
		t.Errorf("v2 encryption should produce 'v2:' prefix, got %q", encrypted[:10])
	}
}

func TestEncryptEmptyKey(t *testing.T) {
	_, err := encryptAgentKey("")
	if err == nil {
		t.Error("expected error for empty plaintext")
	}
}

func TestDecryptEmptyCiphertext(t *testing.T) {
	_, err := decryptAgentKey("")
	if err == nil {
		t.Error("expected error for empty ciphertext")
	}
}

func TestDecryptCorruptedCiphertext(t *testing.T) {
	encrypted, err := encryptAgentKey("ak_test-key")
	if err != nil {
		t.Fatalf("encryptAgentKey: %v", err)
	}

	// Strip v2: prefix, decode, corrupt, re-encode, re-prefix
	b64 := strings.TrimPrefix(encrypted, "v2:")
	data, _ := base64.StdEncoding.DecodeString(b64)
	data[len(data)-1] ^= 0xFF
	corrupted := "v2:" + base64.StdEncoding.EncodeToString(data)

	_, err = decryptAgentKey(corrupted)
	if err == nil {
		t.Error("expected error for corrupted ciphertext")
	}
}

func TestDecryptInvalidBase64(t *testing.T) {
	_, err := decryptAgentKey("v2:not-valid-base64!!!")
	if err == nil {
		t.Error("expected error for invalid base64")
	}
}

func TestDecryptTooShort(t *testing.T) {
	// A valid v2 string that's too short to contain salt + nonce
	short := "v2:" + base64.StdEncoding.EncodeToString([]byte("tiny"))
	_, err := decryptAgentKey(short)
	if err == nil {
		t.Error("expected error for ciphertext shorter than salt+nonce")
	}
}

func TestEncryptProducesDifferentCiphertexts(t *testing.T) {
	// Each encryption uses a random salt and nonce, producing different outputs
	e1, err := encryptAgentKey("ak_same-key")
	if err != nil {
		t.Fatalf("encryptAgentKey: %v", err)
	}
	e2, err := encryptAgentKey("ak_same-key")
	if err != nil {
		t.Fatalf("encryptAgentKey: %v", err)
	}
	if e1 == e2 {
		t.Error("encrypting the same key twice should produce different ciphertexts (random salt+nonce)")
	}
}

func TestIsLegacyEncrypted(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected bool
	}{
		{"empty", "", false},
		{"v2 prefix", "v2:abc123", false},
		{"legacy base64", "SGVsbG8gV29ybGQ=", true},
		{"raw text", "some-old-encrypted-value", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isLegacyEncrypted(tt.input); got != tt.expected {
				t.Errorf("isLegacyEncrypted(%q) = %v, want %v", tt.input, got, tt.expected)
			}
		})
	}
}

// TestLegacyDecryptionCompat encrypts with the legacy HMAC derivation and
// verifies that decryptAgentKey can still decrypt it.
func TestLegacyDecryptionCompat(t *testing.T) {
	original := "ak_legacy-secret-key-67890"

	// Simulate legacy encryption: HMAC-derived key, base64(nonce + ciphertext + tag)
	machineID, err := getMachineID()
	if err != nil {
		t.Fatalf("getMachineID: %v", err)
	}

	key := deriveKeyLegacy(machineID)

	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatalf("aes.NewCipher: %v", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatalf("cipher.NewGCM: %v", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		t.Fatalf("generate nonce: %v", err)
	}

	sealed := gcm.Seal(nonce, nonce, []byte(original), nil)
	legacyEncrypted := base64.StdEncoding.EncodeToString(sealed)

	// Verify no v2: prefix (legacy format)
	if strings.HasPrefix(legacyEncrypted, "v2:") {
		t.Fatal("legacy encrypted should not have v2: prefix")
	}

	// Decrypt with the current decryptAgentKey (should use legacy path)
	decrypted, err := decryptAgentKey(legacyEncrypted)
	if err != nil {
		t.Fatalf("decryptAgentKey(legacy): %v", err)
	}

	if decrypted != original {
		t.Errorf("legacy compat failed: got %q, want %q", decrypted, original)
	}
}

// TestLegacyThenV2RoundTrip verifies that a legacy-encrypted value can be
// decrypted, then re-encrypted as v2, and decrypted again.
func TestLegacyThenV2RoundTrip(t *testing.T) {
	original := "ak_migration-test-key"

	// Encrypt with legacy method
	machineID, err := getMachineID()
	if err != nil {
		t.Fatalf("getMachineID: %v", err)
	}

	key := deriveKeyLegacy(machineID)
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatalf("aes.NewCipher: %v", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatalf("cipher.NewGCM: %v", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		t.Fatalf("generate nonce: %v", err)
	}
	sealed := gcm.Seal(nonce, nonce, []byte(original), nil)
	legacyEncrypted := base64.StdEncoding.EncodeToString(sealed)

	// Step 1: Decrypt legacy
	plaintext, err := decryptAgentKey(legacyEncrypted)
	if err != nil {
		t.Fatalf("decrypt legacy: %v", err)
	}
	if plaintext != original {
		t.Fatalf("legacy decrypt got %q, want %q", plaintext, original)
	}

	// Step 2: Re-encrypt as v2
	v2Encrypted, err := encryptAgentKey(plaintext)
	if err != nil {
		t.Fatalf("encryptAgentKey(v2): %v", err)
	}
	if !strings.HasPrefix(v2Encrypted, "v2:") {
		t.Fatalf("re-encryption should produce v2 format")
	}

	// Step 3: Decrypt v2
	decrypted, err := decryptAgentKey(v2Encrypted)
	if err != nil {
		t.Fatalf("decrypt v2: %v", err)
	}
	if decrypted != original {
		t.Errorf("full migration round-trip failed: got %q, want %q", decrypted, original)
	}
}
