/**
 * test(schedules): funcionários inativos (active=0) não aparecem no GET /api/schedules — bug #141
 *
 * Critérios de aceite (issue #141):
 *   - GET /api/schedules não retorna entries de funcionários com active=0
 *   - generateSchedule não processa funcionários com active=0 (já era correto — regressão)
 *   - Fluxo: gerar → inativar → regenerar → entries do inativo não reaparecem
 *   - Entries históricas do inativo permanecem no banco (soft delete — dados preservados)
 *
 * Tester Senior
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb, createEmployee } from './helpers.js';

const MONTH = { month: 4, year: 2026 };

beforeEach(() => freshDb());

// ── Suíte 1: GET /api/schedules filtra active=0 ──────────────────────────────

describe('GET /api/schedules — funcionários inativos excluídos da resposta', () => {
  it('entries de funcionário inativado não aparecem no GET /api/schedules', async () => {
    const db = freshDb();
    const ativo = createEmployee(db, { name: 'Ativo' });
    const inativo = createEmployee(db, { name: 'Inativo' });

    // Gerar escala com ambos ativos
    const gen = await request(app).post('/api/schedules/generate').send(MONTH);
    expect(gen.status).toBe(200);

    // Inativar funcionário
    db.prepare('UPDATE employees SET active = 0 WHERE id = ?').run(inativo.id);

    // GET /api/schedules não deve retornar entries do inativo
    const res = await request(app).get('/api/schedules?month=4&year=2026');
    expect(res.status).toBe(200);

    const ids = [...new Set(res.body.entries.map((e) => e.employee_id))];
    expect(ids).toContain(ativo.id);
    expect(ids).not.toContain(inativo.id);
  });

  it('totals não incluem funcionário inativado', async () => {
    const db = freshDb();
    const ativo = createEmployee(db, { name: 'Ativo' });
    const inativo = createEmployee(db, { name: 'Inativo' });

    await request(app).post('/api/schedules/generate').send(MONTH);
    db.prepare('UPDATE employees SET active = 0 WHERE id = ?').run(inativo.id);

    const res = await request(app).get('/api/schedules?month=4&year=2026');
    expect(res.status).toBe(200);

    const totalIds = res.body.totals.map((t) => t.employee_id);
    expect(totalIds).toContain(ativo.id);
    expect(totalIds).not.toContain(inativo.id);
  });

  it('entries do inativo permanecem no banco (soft delete — dados preservados)', async () => {
    const db = freshDb();
    const inativo = createEmployee(db, { name: 'Inativo' });

    await request(app).post('/api/schedules/generate').send(MONTH);

    // Confirmar que entries existem antes de inativar
    const antes = db
      .prepare('SELECT COUNT(*) as n FROM schedule_entries WHERE employee_id = ?')
      .get(inativo.id);
    expect(antes.n).toBeGreaterThan(0);

    db.prepare('UPDATE employees SET active = 0 WHERE id = ?').run(inativo.id);

    // Entries ainda existem no banco após inativação
    const depois = db
      .prepare('SELECT COUNT(*) as n FROM schedule_entries WHERE employee_id = ?')
      .get(inativo.id);
    expect(depois.n).toBe(antes.n);
  });
});

// ── Suíte 2: regeneração não recria entries para inativos ────────────────────

describe('generateSchedule — funcionário inativado não reaparece após regeneração', () => {
  it('regenerar o mês não cria novas entries para funcionário inativo', async () => {
    const db = freshDb();
    const ativo = createEmployee(db, { name: 'Ativo' });
    const inativo = createEmployee(db, { name: 'Inativo' });

    // Primeira geração com ambos
    await request(app).post('/api/schedules/generate').send(MONTH);

    const entriesAntes = db
      .prepare('SELECT COUNT(*) as n FROM schedule_entries WHERE employee_id = ?')
      .get(inativo.id).n;

    // Inativar e regenerar
    db.prepare('UPDATE employees SET active = 0 WHERE id = ?').run(inativo.id);
    const regen = await request(app)
      .post('/api/schedules/generate')
      .send({ ...MONTH, overwriteLocked: true });
    expect(regen.status).toBe(200);

    // Entries do inativo não devem ter aumentado
    const entriesDepois = db
      .prepare('SELECT COUNT(*) as n FROM schedule_entries WHERE employee_id = ?')
      .get(inativo.id).n;
    expect(entriesDepois).toBe(entriesAntes);

    // GET não retorna entries do inativo
    const res = await request(app).get('/api/schedules?month=4&year=2026');
    const ids = [...new Set(res.body.entries.map((e) => e.employee_id))];
    expect(ids).toContain(ativo.id);
    expect(ids).not.toContain(inativo.id);
  });

  it('funcionário nunca ativo não aparece em GET /api/schedules', async () => {
    const db = freshDb();
    const ativo = createEmployee(db, { name: 'Ativo' });
    const nunca = createEmployee(db, { name: 'Nunca Ativo' });

    // Inativar antes da primeira geração
    db.prepare('UPDATE employees SET active = 0 WHERE id = ?').run(nunca.id);

    await request(app).post('/api/schedules/generate').send(MONTH);

    const res = await request(app).get('/api/schedules?month=4&year=2026');
    const ids = [...new Set(res.body.entries.map((e) => e.employee_id))];
    expect(ids).toContain(ativo.id);
    expect(ids).not.toContain(nunca.id);
  });
});
