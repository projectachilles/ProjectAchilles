package updater

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"fmt"
)

// verifySignature checks an Ed25519 signature over the given hash bytes.
// publicKeyBase64 is the raw 32-byte Ed25519 public key encoded as base64.
// signatureHex is the 64-byte Ed25519 signature encoded as hex.
func verifySignature(hashBytes []byte, signatureHex string, publicKeyBase64 string) error {
	pubKeyRaw, err := base64.StdEncoding.DecodeString(publicKeyBase64)
	if err != nil {
		return fmt.Errorf("decode public key: %w", err)
	}
	if len(pubKeyRaw) != ed25519.PublicKeySize {
		return fmt.Errorf("invalid public key length: expected %d, got %d", ed25519.PublicKeySize, len(pubKeyRaw))
	}

	sig, err := hex.DecodeString(signatureHex)
	if err != nil {
		return fmt.Errorf("decode signature: %w", err)
	}
	if len(sig) != ed25519.SignatureSize {
		return fmt.Errorf("invalid signature length: expected %d, got %d", ed25519.SignatureSize, len(sig))
	}

	pubKey := ed25519.PublicKey(pubKeyRaw)
	if !ed25519.Verify(pubKey, hashBytes, sig) {
		return fmt.Errorf("Ed25519 signature verification failed")
	}

	return nil
}
