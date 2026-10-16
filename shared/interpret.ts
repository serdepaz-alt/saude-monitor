// Regras determinísticas de classificação. Usado no front-end e nas functions.
// ATENÇÃO: limites e textos abaixo são EXEMPLOS. Devem ser validados pela equipe clínica.

export type MeasurementType = 'heart_rate' | 'spo2' | 'glucose' | 'weight';
export type Severity = 'normal' | 'attention' | 'urgent';
export type Direction = 'low' | 'high' | 'ok';

export interface Range {
  warnLow?: number | null;
  warnHigh?: number | null;
  critLow?: number | null;
  critHigh?: number | null;
}

export const TYPES: MeasurementType[] = ['heart_rate', 'spo2', 'glucose', 'weight'];

export const LABELS: Record<MeasurementType, string> = {
  heart_rate: 'frequência cardíaca',
  spo2: 'saturação de oxigênio',
  glucose: 'glicemia',
  weight: 'peso',
};

export const UNITS: Record<MeasurementType, string> = {
  heart_rate: 'bpm',
  spo2: '%',
  glucose: 'mg/dL',
  weight: 'kg',
};

// Faixa fisiologicamente plausível: fora disso é erro de leitura/digitação.
export const PLAUSIBLE: Record<MeasurementType, [number, number]> = {
  heart_rate: [20, 250],
  spo2: [50, 100],
  glucose: [20, 600],
  weight: [2, 300],
};

export const DEFAULTS: Record<MeasurementType, Range> = {
  heart_rate: { warnLow: 50, warnHigh: 100, critLow: 40, critHigh: 130 },
  spo2: { warnLow: 95, critLow: 92 },
  glucose: { warnLow: 70, warnHigh: 180, critLow: 54, critHigh: 300 },
  // Peso não tem faixa fixa de alerta: ver WEIGHT_CHANGE_THRESHOLDS,
  // a classificação é feita pela variação entre a medição atual e a anterior.
  weight: {},
};

// Variação percentual em relação à medição anterior do mesmo paciente.
export const WEIGHT_CHANGE_THRESHOLDS = {
  warnPct: 3,   // ex.: 3% em poucos dias já merece atenção
  critPct: 6,   // variação abrupta: investigar com prioridade
};

export function isPlausible(type: MeasurementType, value: number): boolean {
  const [min, max] = PLAUSIBLE[type];
  return Number.isFinite(value) && value >= min && value <= max;
}

const has = (n?: number | null): n is number => typeof n === 'number';

export function classify(value: number, r: Range): { severity: Severity; direction: Direction } {
  if (has(r.critLow) && value < r.critLow) return { severity: 'urgent', direction: 'low' };
  if (has(r.critHigh) && value > r.critHigh) return { severity: 'urgent', direction: 'high' };
  if (has(r.warnLow) && value < r.warnLow) return { severity: 'attention', direction: 'low' };
  if (has(r.warnHigh) && value > r.warnHigh) return { severity: 'attention', direction: 'high' };
  return { severity: 'normal', direction: 'ok' };
}

// Textos em linha única (parâmetros de template do WhatsApp não aceitam quebras de linha).
export const WEIGHT_MESSAGES: Record<string, string> = {
  'normal.ok': 'Seu peso está estável em relação à última medição.',
  'attention.low':
    'Seu peso caiu de forma perceptível desde a última medição. Fique de olho na alimentação e avise a equipe se isso continuar.',
  'attention.high':
    'Seu peso subiu de forma perceptível desde a última medição. Avise a equipe se notar inchaço ou falta de ar.',
  'urgent.low':
    'Seu peso caiu de forma abrupta. Avise a equipe de saúde hoje mesmo.',
  'urgent.high':
    'Seu peso subiu de forma abrupta e rápida. Isso pode indicar retenção de líquido. Avise a equipe de saúde hoje mesmo.',
};

const MESSAGES: Record<MeasurementType, Record<string, string>> = {
  weight: WEIGHT_MESSAGES,
  spo2: {
    'normal.ok': 'Sua saturação de oxigênio está dentro do esperado.',
    'attention.low':
      'Sua saturação está um pouco abaixo do ideal. Repita a medição em repouso, com a mão aquecida, e avise a equipe se sentir falta de ar.',
    'urgent.low': 'Sua saturação está baixa. Procure atendimento médico agora ou ligue 192 (SAMU).',
  },
  heart_rate: {
    'normal.ok': 'Seus batimentos estão dentro do esperado.',
    'attention.low':
      'Seus batimentos estão mais lentos que o habitual. Se sentir tontura ou cansaço fora do comum, avise a equipe.',
    'attention.high':
      'Seus batimentos estão acelerados. Descanse alguns minutos e meça novamente. Se persistir, avise a equipe.',
    'urgent.low':
      'Seus batimentos estão muito lentos. Se sentir tontura, desmaio ou mal-estar, procure atendimento agora ou ligue 192 (SAMU).',
    'urgent.high': 'Seus batimentos estão muito acelerados. Procure atendimento médico agora ou ligue 192 (SAMU).',
  },
  glucose: {
    'normal.ok': 'Sua glicemia está dentro do esperado.',
    'attention.low':
      'Sua glicemia está baixa. Siga a orientação da sua equipe para hipoglicemia e meça novamente em 15 minutos.',
    'attention.high':
      'Sua glicemia está acima do esperado. Beba água, siga seu plano alimentar e meça novamente conforme orientado.',
    'urgent.low':
      'Sua glicemia está muito baixa. Trate conforme orientado e ligue 192 (SAMU) se não melhorar ou se houver confusão ou desmaio.',
    'urgent.high':
      'Sua glicemia está muito alta. Procure atendimento médico hoje. Se houver vômito, sonolência ou respiração acelerada, ligue 192 (SAMU).',
  },
};

export function interpret(type: MeasurementType, value: number, range?: Range) {
  // Peso usa interpretWeight() porque depende da medição anterior, não de uma faixa fixa.
  if (type === 'weight') return interpretWeight(value, null);
  const { severity, direction } = classify(value, range ?? DEFAULTS[type]);
  const key = `${severity}.${direction}`;
  const advice = MESSAGES[type][key] ?? 'Converse com a sua equipe de saúde sobre este resultado.';
  return { severity, direction, messageKey: `${type}.${key}`, advice };
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  normal: 'Dentro do esperado',
  attention: 'Atenção',
  urgent: 'Urgente',
};

// Classificação específica de peso: compara com a medição anterior do paciente,
// já que não existe um valor de peso "normal" universal, apenas variações abruptas.
// previousValue = null quando é a primeira pesagem (sempre normal, não há o que comparar).
export function interpretWeight(value: number, previousValue: number | null) {
  if (previousValue == null || previousValue <= 0) {
    return { severity: 'normal' as Severity, direction: 'ok' as Direction, messageKey: 'weight.normal.ok', advice: WEIGHT_MESSAGES['normal.ok'] };
  }
  const pct = ((value - previousValue) / previousValue) * 100;
  const { warnPct, critPct } = WEIGHT_CHANGE_THRESHOLDS;

  let severity: Severity = 'normal';
  let direction: Direction = 'ok';
  if (Math.abs(pct) >= critPct) { severity = 'urgent'; direction = pct > 0 ? 'high' : 'low'; }
  else if (Math.abs(pct) >= warnPct) { severity = 'attention'; direction = pct > 0 ? 'high' : 'low'; }

  const key = `${severity}.${direction}`;
  return { severity, direction, messageKey: `weight.${key}`, advice: WEIGHT_MESSAGES[key] ?? WEIGHT_MESSAGES['normal.ok'] };
}
