package config

import (
	"encoding/base64"
	"testing"
)

func TestDeriveKeyDeterministic(t *testing.T) {
	k1 := deriveKey("machine-1")
	k2 := deriveKey("machine-1")
	if string(k1) != string(k2) {
		t.Error("deriveKey should be deterministic for the same input")
	}
}

func TestDeriveKeyDifferentMachines(t *testing.T) {
	k1 := deriveKey("machine-1")
	k2 := deriveKey("machine-2")
	if string(k1) == string(k2) {
		t.Error("different machine IDs should produce different keys")
	}
}

func TestDeriveKeyLength(t *testing.T) {
	key := deriveKey("test-machine")
	if len(key) != 32 {
		t.Errorf("expected 32-byte key, got %d bytes", len(key))
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

	// Decode, corrupt, re-encode
	data, _ := base64.StdEncoding.DecodeString(encrypted)
	data[len(data)-1] ^= 0xFF
	corrupted := base64.StdEncoding.EncodeToString(data)

	_, err = decryptAgentKey(corrupted)
	if err == nil {
		t.Error("expected error for corrupted ciphertext")
	}
}

func TestDecryptInvalidBase64(t *testing.T) {
	_, err := decryptAgentKey("not-valid-base64!!!")
	if err == nil {
		t.Error("expected error for invalid base64")
	}
}

func TestDecryptTooShort(t *testing.T) {
	// A valid base64 string that's too short to contain a nonce
	short := base64.StdEncoding.EncodeToString([]byte("tiny"))
	_, err := decryptAgentKey(short)
	if err == nil {
		t.Error("expected error for ciphertext shorter than nonce")
	}
}

func TestEncryptProducesDifferentCiphertexts(t *testing.T) {
	// Each encryption should use a random nonce, producing different outputs
	e1, err := encryptAgentKey("ak_same-key")
	if err != nil {
		t.Fatalf("encryptAgentKey: %v", err)
	}
	e2, err := encryptAgentKey("ak_same-key")
	if err != nil {
		t.Fatalf("encryptAgentKey: %v", err)
	}
	if e1 == e2 {
		t.Error("encrypting the same key twice should produce different ciphertexts (random nonce)")
	}
}
