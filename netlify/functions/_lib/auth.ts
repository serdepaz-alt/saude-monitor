import { db, messaging } from './db';
import { safeEqual } from './crypto';

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function requireStaff(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  if (!data.user) return null;
  const { data: staff } = await db.from('staff').select('role').eq('user_id', data.user.id).maybeSingle();
  return staff ? { id: data.user.id, role: staff.role as string } : null;
}

export function hasValidApiKey(req: Request): boolean {
  const key = req.headers.get('x-api-key');
  const expected = process.env.INGEST_API_KEY;
  return !!key && !!expected && safeEqual(key, expected);
}

export async function audit(actor: string, action: string, pseudoId?: string | null) {
  await messaging().from('audit_log').insert({ actor, action, pseudo_id: pseudoId ?? null });
}
