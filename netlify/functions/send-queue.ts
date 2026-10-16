import type { Config } from '@netlify/functions';
import { processOutbox } from './_lib/send';

export default async () => {
  await processOutbox();
  return new Response('ok');
};

export const config: Config = { schedule: '*/5 * * * *' };
