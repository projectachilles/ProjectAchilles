// PFX/P12 parsing for Defender certificate auth.
// Extracts the private key PEM and derives the SHA-1 certificate thumbprint.
// Uses node-forge (pure JS) — safe for Vercel serverless runtime.

import forge from 'node-forge';

export interface ParsedPfx {
  privateKeyPem: string;
  /** Uppercase hex SHA-1 of the DER-encoded certificate — matches the Azure portal display. */
  thumbprint: string;
  subjectCn: string;
  notAfter: string;
}

export function parsePfx(pfxBuffer: Buffer, passphrase: string): ParsedPfx {
  let p12: forge.pkcs12.Pkcs12Pfx;

  try {
    const p12Der = forge.util.createBuffer(pfxBuffer.toString('binary'));
    const p12Asn1 = forge.asn1.fromDer(p12Der);
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, passphrase);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('mac verify failure') || msg.includes('PKCS#12')) {
      throw new Error('Invalid PFX passphrase or corrupt file');
    }
    throw new Error(`Failed to parse PFX: ${msg}`);
  }

  let privateKey: forge.pki.PrivateKey | null = null;
  const shroudedBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  privateKey = shroudedBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key ?? null;
  if (!privateKey) {
    const keyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
    privateKey = keyBags[forge.pki.oids.keyBag]?.[0]?.key ?? null;
  }
  if (!privateKey) throw new Error('PFX does not contain a private key');

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = certBags[forge.pki.oids.certBag]?.[0];
  if (!certBag?.cert) throw new Error('PFX does not contain a certificate');

  const privateKeyPem = forge.pki.privateKeyToPem(privateKey);

  // SHA-1 is required here: RFC 7515 §4.1.8 defines x5t as the base64url of
  // the SHA-1 hash of the DER cert, and Microsoft's token endpoint enforces it.
  // lgtm[js/weak-cryptographic-algorithm]
  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(certBag.cert)).getBytes();
  const md = forge.md.sha1.create(); // lgtm[js/weak-cryptographic-algorithm]
  md.update(certDer);
  const thumbprint = md.digest().toHex().toUpperCase();

  const subjectCn =
    certBag.cert.subject.getField('CN')?.value ?? certBag.cert.subject.attributes[0]?.value ?? 'Unknown';
  const notAfter = certBag.cert.validity.notAfter.toISOString();

  return { privateKeyPem, thumbprint, subjectCn, notAfter };
}
