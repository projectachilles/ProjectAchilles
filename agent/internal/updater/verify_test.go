package updater

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"testing"
)

func generateTestKeyPair(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return pub, priv
}

func TestVerifySignature_Valid(t *testing.T) {
	pub, priv := generateTestKeyPair(t)
	hash := sha256.Sum256([]byte("test-binary-data"))
	sig := ed25519.Sign(priv, hash[:])

	pubB64 := base64.StdEncoding.EncodeToString(pub)
	sigHex := hex.EncodeToString(sig)

	if err := verifySignature(hash[:], sigHex, pubB64); err != nil {
		t.Fatalf("expected valid signature, got error: %v", err)
	}
}

func TestVerifySignature_WrongPublicKey(t *testing.T) {
	_, priv := generateTestKeyPair(t)
	otherPub, _ := generateTestKeyPair(t)

	hash := sha256.Sum256([]byte("test-data"))
	sig := ed25519.Sign(priv, hash[:])

	pubB64 := base64.StdEncoding.EncodeToString(otherPub)
	sigHex := hex.EncodeToString(sig)

	if err := verifySignature(hash[:], sigHex, pubB64); err == nil {
		t.Fatal("expected error for wrong public key, got nil")
	}
}

func TestVerifySignature_CorruptedSignature(t *testing.T) {
	pub, priv := generateTestKeyPair(t)
	hash := sha256.Sum256([]byte("test-data"))
	sig := ed25519.Sign(priv, hash[:])
	sig[0] ^= 0xFF // corrupt first byte

	pubB64 := base64.StdEncoding.EncodeToString(pub)
	sigHex := hex.EncodeToString(sig)

	if err := verifySignature(hash[:], sigHex, pubB64); err == nil {
		t.Fatal("expected error for corrupted signature, got nil")
	}
}

func TestVerifySignature_InvalidBase64Key(t *testing.T) {
	hash := sha256.Sum256([]byte("test-data"))
	sigHex := hex.EncodeToString(make([]byte, 64))

	err := verifySignature(hash[:], sigHex, "not-valid-base64!!!")
	if err == nil {
		t.Fatal("expected error for invalid base64 key, got nil")
	}
}

func TestVerifySignature_WrongLengthKey(t *testing.T) {
	hash := sha256.Sum256([]byte("test-data"))
	sigHex := hex.EncodeToString(make([]byte, 64))
	shortKey := base64.StdEncoding.EncodeToString([]byte("too-short"))

	err := verifySignature(hash[:], sigHex, shortKey)
	if err == nil {
		t.Fatal("expected error for wrong-length key, got nil")
	}
}
