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
 * Cenário de teste (atualizado pós fix #98):
 *   Motorista DIURNO, Transporte Ambulância (preferred_shift_id = null, não-ADM).
 *   cycle_start=Jan/2025 → fase 1 → padrão ['36h','42h','42h','36h'] em Jan/2025.
 *   Jan/2025 (5 semanas, cltWeekOffset=1 por semana parcial Jan 1–4):
 *     Week 0 (parcial Jan 1–4):  cltWi=-1 → isDiurnoPartialWeek → posições pares
 *     Week 1 (Jan 5–11):         cltWi=0  → 36h → else-branch
 *     Week 2 (Jan 12–18):        cltWi=1  → 42h → isDiurno42h — último turno = Sáb Jan 18
 *     Week 3 (Jan 19–25):        cltWi=2  → 42h → isDiurno42h — fix #98B: Dom bloqueado (12h rest)
 *     Week 4 (Jan 26–31, parcial): cltWi=3 → 36h → else-branch — recovery #94 aplica aqui
 *
 * Pós fix #98B: Week 3 é isDiurno42h e Dom Jan 19 é bloqueado (12h rest de Sáb Jan 18).
 * Week 3 gera ≥ 24h (2–3 turnos dependendo do extraPositionIndex).
 * Week 4 (36h else-branch) usa recovery #94 para compensar e atingir 3 turnos = 36h.
 *
 * Verificações:
 *   1. Total de horas mensal entre 144h e 192h.
 *   2. Week 4 (Jan 26–31) com pelo menos 36h (3 turnos de 12h) — valida recovery #94.
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

    // ── Verificação 2: Week 4 (Jan 26–31) tem pelo menos 36h ────────────────
    // Pós fix #98B: Week 3 (Jan 19–25) é isDiurno42h com Dom bloqueado — gera ≥ 24h.
    // Week 4 (Jan 26–31) é 36h else-branch onde recovery #94 aplica:
    // recovery usa virtual lastShiftEnd para contornar candidatos bloqueados.
    const week4Entries = allEntries.filter(
      (e) => e.date >= '2025-01-26' && e.date <= '2025-01-31'
    );
    const week4Hours = week4Entries.reduce(
      (sum, e) => (e.is_day_off ? sum : sum + (e.duration_hours || 0)),
      0
    );
    expect(week4Hours).toBeGreaterThanOrEqual(36);

    // ── Verificação 3: Regra 2 — nenhum par consecutivo totaliza >= 24h ─────
    // fix #98B garante que Dom Jan 19 não receba turno com rest=12h de Sáb Jan 18.
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
