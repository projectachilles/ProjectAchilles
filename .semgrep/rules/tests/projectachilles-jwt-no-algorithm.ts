import jwt from 'jsonwebtoken';

const secret = process.env.JWT_SECRET!;

// --- Should trigger ---

function unsafeVerify(token: string) {
  // ruleid: projectachilles-jwt-no-algorithm
  const decoded = jwt.verify(token, secret);
  return decoded;
}

function unsafeVerifyPublicKey(token: string, publicKey: string) {
  // ruleid: projectachilles-jwt-no-algorithm
  return jwt.verify(token, publicKey);
}

// --- Should NOT trigger ---

function safeVerify(token: string) {
  // ok: projectachilles-jwt-no-algorithm
  const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
  return decoded;
}

function safeVerifyRS256(token: string, publicKey: string) {
  // ok: projectachilles-jwt-no-algorithm
  return jwt.verify(token, publicKey, { algorithms: ['RS256'], issuer: 'achilles' });
}
