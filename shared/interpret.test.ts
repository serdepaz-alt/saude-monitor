import { describe, expect, it } from 'vitest';
import { classify, DEFAULTS, interpret, interpretWeight, isPlausible } from './interpret';

describe('classify', () => {
  it('SpO2 98% é normal', () => {
    expect(classify(98, DEFAULTS.spo2).severity).toBe('normal');
  });
  it('SpO2 93% pede atenção', () => {
    expect(classify(93, DEFAULTS.spo2)).toEqual({ severity: 'attention', direction: 'low' });
  });
  it('SpO2 90% é urgente', () => {
    expect(classify(90, DEFAULTS.spo2).severity).toBe('urgent');
  });
  it('glicemia 320 é urgente e alta', () => {
    expect(classify(320, DEFAULTS.glucose)).toEqual({ severity: 'urgent', direction: 'high' });
  });
  it('respeita faixa individual', () => {
    expect(classify(105, { warnHigh: 110, critHigh: 140 }).severity).toBe('normal');
  });
});

describe('interpret / isPlausible', () => {
  it('gera texto em linha única', () => {
    expect(interpret('heart_rate', 120).advice).not.toMatch(/\n/);
  });
  it('rejeita leituras impossíveis', () => {
    expect(isPlausible('spo2', 140)).toBe(false);
    expect(isPlausible('heart_rate', 72)).toBe(true);
  });
});

describe('interpretWeight', () => {
  it('primeira pesagem é sempre normal', () => {
    expect(interpretWeight(80, null).severity).toBe('normal');
  });
  it('variação pequena é normal', () => {
    expect(interpretWeight(81, 80).severity).toBe('normal');
  });
  it('queda de 4% pede atenção', () => {
    const r = interpretWeight(76.8, 80);
    expect(r).toMatchObject({ severity: 'attention', direction: 'low' });
  });
  it('alta de 7% é urgente', () => {
    const r = interpretWeight(85.6, 80);
    expect(r).toMatchObject({ severity: 'urgent', direction: 'high' });
  });
});
