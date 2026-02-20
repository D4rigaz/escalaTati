import { describe, it, expect } from 'vitest';
import { isValidEmendado, correctHours } from '../services/scheduleGenerator.js';

describe('isValidEmendado', () => {
  it('permite Tarde → Noturno', () => expect(isValidEmendado('Tarde', 'Noturno')).toBe(true));
  it('permite Noturno → Manhã', () => expect(isValidEmendado('Noturno', 'Manhã')).toBe(true));
  it('bloqueia Manhã → Tarde', () => expect(isValidEmendado('Manhã', 'Tarde')).toBe(false));
  it('bloqueia Noturno → Noturno', () => expect(isValidEmendado('Noturno', 'Noturno')).toBe(false));
  it('bloqueia Tarde → Manhã', () => expect(isValidEmendado('Tarde', 'Manhã')).toBe(false));
  it('retorna false para valores nulos', () => expect(isValidEmendado(null, 'Noturno')).toBe(false));
});

describe('correctHours', () => {
  // helpers locais
  const shiftTypes = [
    { id: 1, name: 'Noturno', duration_hours: 12 },
    { id: 2, name: 'Manhã',   duration_hours: 6  },
  ];
  const shiftMap = { 1: shiftTypes[0], 2: shiftTypes[1] };

  function makeEntries(workCount, offCount) {
    const entries = [];
    for (let i = 0; i < workCount; i++)
      entries.push({ employee_id: 1, shift_type_id: 1, date: `2025-01-${String(i+1).padStart(2,'0')}`, is_day_off: 0, is_locked: 0 });
    for (let i = 0; i < offCount; i++)
      entries.push({ employee_id: 1, shift_type_id: null, date: `2025-01-${String(workCount+i+1).padStart(2,'0')}`, is_day_off: 1, is_locked: 0 });
    return entries;
  }

  it('não modifica se desvio <= 6h', () => {
    const entries = makeEntries(13, 5); // 156h — desvio 4h
    const result = correctHours(entries, shiftTypes, shiftMap, 156, 160);
    expect(result.filter(e => !e.is_day_off).length).toBe(13);
  });

  it('converte trabalho em folga quando está acima do alvo por >6h', () => {
    const entries = makeEntries(16, 2); // 192h — desvio +32h
    const result = correctHours(entries, shiftTypes, shiftMap, 192, 160);
    const hours = result.filter(e => !e.is_day_off).length * 12;
    expect(Math.abs(hours - 160)).toBeLessThanOrEqual(18);
  });

  it('converte folga em trabalho quando está abaixo do alvo por >6h', () => {
    const entries = makeEntries(10, 8); // 120h — desvio -40h
    const result = correctHours(entries, shiftTypes, shiftMap, 120, 160);
    const hours = result.filter(e => !e.is_day_off).length * 12;
    expect(hours).toBeGreaterThan(120);
  });
});
