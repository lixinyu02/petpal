import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
export const SESSION_LIFETIME = 7 * 24 * 60 * 60 * 1000;
const invalid = message => Object.assign(new Error(message), { status: 400 });
export const tokenHash = value => createHash('sha256').update(value).digest('hex');
export function secureEqual(left, right) {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function username(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_.-]{2,39}$/i.test(value)) throw invalid('账号须为 3 至 40 位英文字母、数字、下划线、点或连字符。');
  return value.toLowerCase();
}
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 256) throw invalid('密码须为 8 至 256 个字符。');
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
  return { algorithm: 'scrypt', salt, hash };
}
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 256) return false;
  // Unknown/disabled/passwordless users still pay the same scrypt cost.
  const valid = stored?.algorithm === 'scrypt' && /^[a-f0-9]{32}$/.test(stored.salt) && /^[a-f0-9]{128}$/.test(stored.hash);
  const value = await scrypt(password, valid ? stored.salt : '0'.repeat(32), 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const expected = Buffer.from(valid ? stored.hash : '0'.repeat(128), 'hex');
  return timingSafeEqual(value, expected) && Boolean(valid);
}
export function newSession(userId) {
  const token = randomBytes(32).toString('base64url');
  return { token, session: { tokenHash: tokenHash(token), userId, createdAt: new Date().toISOString(), expiresAt: Date.now() + SESSION_LIFETIME } };
}
export function publicUser(user, ownerId) {
  const isOwner = user.id === ownerId;
  const agentAccess = isOwner ? 'full' : user.agentAccess ?? 'none';
  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role, isOwner, agentAccess, canUseCodex: agentAccess !== 'none' };
}
export function createLoginLimiter() {
  const buckets = new Map(), windowMs = 15 * 60 * 1000;
  return (address, account) => {
    const now = Date.now();
    for (const [key, value] of buckets) if (value.until <= now) buckets.delete(key);
    const limits = [[`ip:${address}`, 40], [`account:${account}`, 8]];
    if (limits.some(([key, limit]) => (buckets.get(key)?.count ?? 0) >= limit)) throw Object.assign(new Error('登录尝试过于频繁，请 15 分钟后重试。'), { status: 429 });
    for (const [key] of limits) {
      const bucket = buckets.get(key) ?? { count: 0, until: now + windowMs };
      bucket.count++; buckets.set(key, bucket);
    }
    while (buckets.size > 2000) buckets.delete(buckets.keys().next().value);
  };
}
