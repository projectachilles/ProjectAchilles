// PFX/P12 parsing for Defender certificate auth.
// Extracts the private key PEM and derives the SHA-1 certificate thumbprint
// (the hex value shown in the Azure portal after uploading the cert).

import forge from 'node-forge';

export interface ParsedPfx {
  privateKeyPem: string;
  /** Uppercase hex SHA-1 of the DER-encoded certificate — matches the Azure portal display. */
  thumbprint: string;
  /** Certificate subject CN for display purposes. */
  subjectCn: string;
  /** ISO expiry date of the certificate. */
  notAfter: string;
}

/**
 * Parse a PFX/P12 buffer and extract the private key + certificate thumbprint.
 * Throws a descriptive Error if the PFX is malformed, the passphrase is wrong,
 * or no private key / certificate bag is found.
 */
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

  // Extract private key — try pkcs8ShroudedKeyBag first, fall back to keyBag
  let privateKey: forge.pki.PrivateKey | null = null;
  const shroudedBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  privateKey = shroudedBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key ?? null;
  if (!privateKey) {
    const keyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
    privateKey = keyBags[forge.pki.oids.keyBag]?.[0]?.key ?? null;
  }
  if (!privateKey) {
    throw new Error('PFX does not contain a private key');
  }

  // Extract certificate
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = certBags[forge.pki.oids.certBag]?.[0];
  if (!certBag?.cert) {
    throw new Error('PFX does not contain a certificate');
  }

  const privateKeyPem = forge.pki.privateKeyToPem(privateKey);

  // Derive SHA-1 thumbprint from DER-encoded certificate
  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(certBag.cert)).getBytes();
  const md = forge.md.sha1.create();
  md.update(certDer);
  const thumbprint = md.digest().toHex().toUpperCase();

  // Extract display metadata
  const subjectCn =
    certBag.cert.subject.getField('CN')?.value ?? certBag.cert.subject.attributes[0]?.value ?? 'Unknown';
  const notAfter = certBag.cert.validity.notAfter.toISOString();

  return { privateKeyPem, thumbprint, subjectCn, notAfter };
}
