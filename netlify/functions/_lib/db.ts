import { createClient } from '@supabase/supabase-js';

export const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
  auth: { persistSession: false },
});

export const identity = () => db.schema('identity');
export const health = () => db.schema('health');
export const messaging = () => db.schema('messaging');
