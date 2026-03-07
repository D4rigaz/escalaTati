/**
 * test(generator): regressão fix #94 — recovery usa virtual rest cross-semana
 *
 * Desenvolvedor Pleno
 *
 * Bug #94: no else-branch do gerador (semanas 36h), o bloco de recovery falhava
 * quando a semana anterior (isDiurno42h) colocava um turno no último dia da semana
 * (Sáb), avançando lastShiftEnd para além dos candidatos de selectedOff da semana
 * seguinte. O rest calculado pelo selectShift era negativo → todos os candidatos
 * pulados → semana 36h gerava somente 24h (2 turnos ao invés de 3).
 *
 * Fix: recovery calcula virtual lastShiftEnd = último turno cronologicamente
 * anterior ao candidato. Guarda: se não houver preceding (data retroativa),
 * mantém o lastShiftEnd global (rest negativo → rejeição correta).
 * hasAdequateRest verifica restrições para frente (turno seguinte).
 *
 * Cenário de teste:
 *   Motorista DIURNO, Transporte Ambulância (preferred_shift_id = null, não-ADM).
 *   cycle_start=Jan/2025 → fase 1 → padrão ['36h','42h','42h','36h','36h'] em Jan/2025.
 *   Jan/2025 (5 semanas):
 *     Week 0: 36h (4 dias: Jan 1–4)
 *     Week 1: 42h → isDiurno42h (Jan 5–11)
 *     Week 2: 42h → isDiurno42h (Jan 12–18) — último turno = Sáb Jan 18
 *     Week 3: 36h → else-branch (Jan 19–25) — Jan 19 Dom pode ser bloqueado (12h rest)
 *     Week 4: 36h → else-branch (Jan 26–31)
 *
 * Antes do fix: Week 3 gerava somente 2×12h = 24h (recovery falhava).
 * Depois do fix: Week 3 gera 3×12h = 36h (recovery usa virtual rest).
 *
 * Verificações:
 *   1. Total de horas mensal entre 144h e 192h.
 *   2. Week 3 (Jan 19–25) com pelo menos 36h (3 turnos de 12h).
 *   3. Nenhum par consecutivo de turnos totaliza >= 24h (Regra 2).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb } from './helpers.js';

beforeEach(() => freshDb());

const JAN2025 = { month: 1, year: 2025 };

describe('Fix #94 — recovery virtual rest cross-semana', () => {
  it('semana 36h após isDiurno42h gera 36h (3 turnos 12h) mesmo quando Dom é bloqueado por rest=12h', async () => {
    // Criar motorista DIURNO (Ambulância, cycle_start=Jan/2025 → fase 1)
    const empRes = await request(app)
      .post('/api/employees')
      .send({
        name: 'Alex Fix94',
        setores: ['Transporte Ambulância'],
        cycle_start_month: 1,
        cycle_start_year: 2025,
      });
    expect(empRes.status).toBe(201);
    const empId = empRes.body.id;

    // Gerar escala de Janeiro/2025
    const genRes = await request(app)
      .post('/api/schedules/generate')
      .send(JAN2025);
    expect(genRes.status).toBe(200);
    expect(genRes.body.success).toBe(true);

    // Buscar entries geradas
    const schedRes = await request(app)
      .get(`/api/schedules?month=${JAN2025.month}&year=${JAN2025.year}`);
    expect(schedRes.status).toBe(200);

    const allEntries = schedRes.body.entries.filter((e) => e.employee_id === empId);

    // ── Verificação 1: total mensal entre 144h e 192h ────────────────────────
    const totalHours = allEntries.reduce(
      (sum, e) => (e.is_day_off ? sum : sum + (e.duration_hours || 0)),
      0
    );
    expect(totalHours).toBeGreaterThanOrEqual(144);
    expect(totalHours).toBeLessThanOrEqual(192);

    // ── Verificação 2: Week 3 (Jan 19–25) tem pelo menos 36h ────────────────
    // Phase 1, Week 3 = 36h → expected 3 turnos de 12h = 36h.
    // Antes do fix, a semana gerava 24h (2 turnos) por causa do bug no recovery.
    const week3Entries = allEntries.filter(
      (e) => e.date >= '2025-01-19' && e.date <= '2025-01-25'
    );
    const week3Hours = week3Entries.reduce(
      (sum, e) => (e.is_day_off ? sum : sum + (e.duration_hours || 0)),
      0
    );
    expect(week3Hours).toBeGreaterThanOrEqual(36);

    // ── Verificação 3: Regra 2 — nenhum par consecutivo totaliza >= 24h ─────
    const workEntries = allEntries
      .filter((e) => !e.is_day_off && e.start_time && e.duration_hours)
      .sort((a, b) => a.date.localeCompare(b.date));

    let consecutiveHours = 0;
    let lastEnd = null;

    for (const entry of workEntries) {
      const [h, m] = entry.start_time.split(':').map(Number);
      const start = new Date(
        `${entry.date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
      );
      const restHours = lastEnd ? (start - lastEnd) / (1000 * 60 * 60) : Infinity;

      if (restHours === 0) {
        consecutiveHours += entry.duration_hours;
      } else {
        consecutiveHours = entry.duration_hours;
      }

      expect(consecutiveHours).toBeLessThan(24);
      lastEnd = new Date(start.getTime() + entry.duration_hours * 60 * 60 * 1000);
    }
  });
});
