import { SignJWT, jwtVerify } from 'jose';

// 没有 refresh token 机制，为了不让用户频繁重新输密码，有效期设得比较长
const JWT_MAX_AGE = '90d';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  // 32 字符是 HS256 算法推荐的最小密钥强度，太短容易被暴力破解签名密钥
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  return new TextEncoder().encode(secret);
}

// 全站只有一个共享密码（见 app/api/auth/route.ts），没有按用户区分的账号体系，
// 所以签发的 JWT payload 是空的——它只证明"持有者输入过正确密码"，不携带任何身份信息
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
    // 这里的 Error.message 是所有 API 路由共用的错误码约定，
    // 各路由 catch 到之后会把 err.message 原样放进响应的 detail 字段
    throw new Error('missing_token');
  }

  await jwtVerify(token, getSecret(), { algorithms: ['HS256'] });
}
