import { SignJWT, jwtVerify } from 'jose';

const JWT_MAX_AGE = '90d';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  return new TextEncoder().encode(secret);
}

export function signJWT(): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_MAX_AGE)
    .sign(getSecret());
}

export async function verifyJWT(req: Request): Promise<void> {
  const auth = req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';

  if (!token) {
    throw new Error('missing_token');
  }

  await jwtVerify(token, getSecret(), { algorithms: ['HS256'] });
}
