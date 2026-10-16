import { audit, hasValidApiKey, json, requireStaff } from './_lib/auth';
import { health, identity, messaging } from './_lib/db';
import { processOutbox } from './_lib/send';
import {
  DEFAULTS, LABELS, TYPES, UNITS, interpret, interpretWeight, isPlausible,
  type MeasurementType, type Range,
} from '../../shared/interpret';

const STATUS_TEXT = { attention: 'fora do ideal', urgent: 'em nível de alerta' } as const;

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const staff = await requireStaff(req);
  if (!staff && !hasValidApiKey(req)) return json({ error: 'Não autorizado' }, 401);

  const b = await req.json().catch(() => null);
  if (!b) return json({ error: 'JSON inválido' }, 400);

  const type = b.type as MeasurementType;
  const value = Number(b.value);
  const context: string = b.context || 'default';
  const measuredAt = b.measured_at ? new Date(b.measured_at) : new Date();

  if (!/^[0-9a-f-]{36}$/i.test(b.pseudo_id ?? '')) return json({ error: 'pseudo_id inválido' }, 400);
  if (!TYPES.includes(type)) return json({ error: 'Tipo de medição inválido' }, 400);
  if (!isPlausible(type, value)) return json({ error: 'Valor fora da faixa fisiológica plausível' }, 422);
  if (Number.isNaN(measuredAt.getTime()) || measuredAt.getTime() > Date.now() + 5 * 60_000)
    return json({ error: 'Data da medição inválida' }, 400);

  const { data: exists } = await identity().from('patient_pseudonym').select('pseudo_id').eq('pseudo_id', b.pseudo_id).maybeSingle();
  if (!exists) return json({ error: 'Paciente não encontrado' }, 404);

  // Faixa individual (por contexto -> default -> padrão do sistema). Peso não usa faixa fixa.
  let range: Range = DEFAULTS[type];
  if (type !== 'weight') {
    const { data: ranges } = await health()
      .from('reference_ranges').select('*')
      .eq('pseudo_id', b.pseudo_id).eq('type', type).in('context', [context, 'default']);
    const r = ranges?.find((x) => x.context === context) ?? ranges?.find((x) => x.context === 'default');
    if (r) range = { warnLow: r.warn_low, warnHigh: r.warn_high, critLow: r.crit_low, critHigh: r.crit_high };
  }

  const { data: m, error } = await health()
    .from('measurements')
    .insert({
      pseudo_id: b.pseudo_id, type, value, unit: UNITS[type], context,
      measured_at: measuredAt.toISOString(),
      source: staff ? (b.source === 'clinic' ? 'clinic' : 'manual') : 'device',
      device_id: b.device_id ?? null,
    })
    .select('id').single();
  if (error || !m) return json({ error: 'Falha ao gravar medição' }, 500);

  // Peso compara com a pesagem anterior do paciente, não com uma faixa fixa.
  let result;
  if (type === 'weight') {
    const { data: prev } = await health()
      .from('measurements').select('value')
      .eq('pseudo_id', b.pseudo_id).eq('type', 'weight').lt('measured_at', measuredAt.toISOString())
      .order('measured_at', { ascending: false }).limit(1).maybeSingle();
    result = interpretWeight(value, prev?.value ?? null);
  } else {
    result = interpret(type, value, range);
  }

  await health().from('interpretations').insert({
    measurement_id: m.id, pseudo_id: b.pseudo_id, severity: result.severity, message_key: result.messageKey,
  });

  // normal => entra apenas em resumos; atenção/urgente => mensagem individual
  if (result.severity !== 'normal') {
    const { data: job } = await messaging().from('outbox').insert({
      pseudo_id: b.pseudo_id,
      template_name: process.env.WA_TEMPLATE_NAME || 'resultado_medicao',
      variables: {
        measurement: `${LABELS[type]} (${value} ${UNITS[type]})`,
        date: measuredAt.toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' }),
        status: STATUS_TEXT[result.severity],
        advice: result.advice,
        link: process.env.PORTAL_URL ?? '',
      },
    }).select('id').single();

    if (result.severity === 'urgent' && job) await processOutbox({ id: job.id }); // sem esperar o agendador
  }

  await audit(staff ? `staff:${staff.id}` : 'device', 'ingest_measurement', b.pseudo_id);
  return json({ id: m.id, severity: result.severity, advice: result.advice }, 201);
};
