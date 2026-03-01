import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb, createEmployee, shiftId } from './helpers.js';

beforeEach(() => freshDb());

// ─── Regra 1: Padrão de 12 horas ────────────────────────────────────────────

describe('Regra 1 — padrão de 12h', () => {
  it('prefere turnos de 12h (Noturno) sobre turnos de 6h', async () => {
    const db = freshDb();
    createEmployee(db, { name: 'Ana' });

    await request(app).post('/api/schedules/generate').send({ month: 1, year: 2025 });

    const schedule = await request(app).get('/api/schedules?month=1&year=2025');
    const workEntries = schedule.body.entries.filter(
      (e) => !e.is_day_off && e.shift_name === 'Noturno'
    );
    const sixHourEntries = schedule.body.entries.filter(
      (e) => !e.is_day_off && e.duration_hours === 6
    );

    // Deve ter mais turnos de 12h do que de 6h
    expect(workEntries.length).toBeGreaterThan(sixHourEntries.length);
  });
});

// ─── Regra 2: Proibido 24h consecutivas ─────────────────────────────────────

describe('Regra 2 — proibido 24h consecutivas', () => {
  it('nunca gera entradas que totalizam 24h consecutivas para o mesmo funcionário', async () => {
    const db = freshDb();
    createEmployee(db, { name: 'Bruno' });

    await request(app).post('/api/schedules/generate').send({ month: 1, year: 2025 });

    const schedule = await request(app).get('/api/schedules?month=1&year=2025');
    const entries = schedule.body.entries
      .filter((e) => !e.is_day_off)
      .sort((a, b) => a.date.localeCompare(b.date));

    let consecutiveHours = 0;
    let lastEnd = null;

    for (const entry of entries) {
      if (!entry.start_time || !entry.duration_hours) continue;

      const [h, m] = entry.start_time.split(':').map(Number);
      const start = new Date(`${entry.date}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`);
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

// ─── Regra 3 (Regra 13 nova): descanso gerenciado pelo MIN_REST_HOURS ────────
// days_off_per_week foi removido — o descanso é garantido apenas pela regra
// de 24h mínimas entre turnos (regra 10). Não há mais folga semanal forçada.

describe('Regra 13 — sem days_off_per_week, total de horas próximo de 160h', () => {
  it('a escala não tem campo days_off_per_week nas rest_rules', async () => {
    const db = freshDb();
    createEmployee(db, { name: 'Carla' });

    const res = await request(app).get('/api/employees');
    expect(res.status).toBe(200);
    expect(res.body[0].restRules).toBeDefined();
    expect(res.body[0].restRules.days_off_per_week).toBeUndefined();
  });

  it('total de horas mensal fica próximo de 160h (desvio ≤ 12h)', async () => {
    const db = freshDb();
    createEmployee(db, { name: 'Carla' });

    await request(app).post('/api/schedules/generate').send({ month: 1, year: 2025 });

    const schedule = await request(app).get('/api/schedules?month=1&year=2025');
    const total = schedule.body.totals[0]?.total_hours ?? 0;
    expect(Math.abs(total - 160)).toBeLessThanOrEqual(12);
  });
});

// ─── Regra 4: Emendado válido ────────────────────────────────────────────────

describe('Regra 4 — emendado Tarde→Noturno e Noturno→Manhã são permitidos', () => {
  it.skip('permite Noturno seguido de Manhã (emendado válido, 18h total) — Manhã disponível após #65', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Diego' });
    const noturnoId = shiftId(db, 'Noturno');
    const manhaId   = shiftId(db, 'Manhã');

    // Força emendado manualmente: Noturno dia 10 (termina 06:00 dia 11) + Manhã dia 11 (06:00-12:00)
    db.prepare(
      'INSERT INTO schedule_entries (employee_id, shift_type_id, date, is_day_off, is_locked) VALUES (?, ?, ?, 0, 1)'
    ).run(emp.id, noturnoId, '2025-02-10');
    db.prepare(
      'INSERT INTO schedule_entries (employee_id, shift_type_id, date, is_day_off, is_locked) VALUES (?, ?, ?, 0, 1)'
    ).run(emp.id, manhaId, '2025-02-11');

    const schedule = await request(app).get('/api/schedules?month=2&year=2025');
    const n = schedule.body.entries.find((e) => e.date === '2025-02-10');
    const m = schedule.body.entries.find((e) => e.date === '2025-02-11');

    expect(n?.shift_name).toBe('Noturno');
    expect(m?.shift_name).toBe('Manhã');
    // Total de horas das duas = 12 + 6 = 18h (não viola regra)
    expect((n?.duration_hours ?? 0) + (m?.duration_hours ?? 0)).toBe(18);
  });
});

// ─── Regra 5 (atualizada): Cobertura mínima por setor e período ──────────────

describe('Regra 5 — cobertura diurna mínima (Regra 16)', () => {
  it('gera warnings de cobertura Diurno quando não há motoristas Hemodiálise suficientes', async () => {
    const db = freshDb();
    // Somente 1 motorista de Ambulância — sem Hemodiálise
    createEmployee(db, { name: 'Eduardo', setor: 'Transporte Ambulância' });

    const res = await request(app).post('/api/schedules/generate').send({ month: 1, year: 2025 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const coverageWarnings = res.body.warnings.filter(
      (w) => w.type === 'diurno_hemo' || w.type === 'diurno_ambul' || w.type === 'noturno_ambul'
    );
    expect(coverageWarnings.length).toBeGreaterThan(0);
  });

  it('com 6 motoristas de Ambulância gera menos warnings noturnos que com 1 motorista', async () => {
    // Cenário A: 6 motoristas
    const db6 = freshDb();
    for (let i = 0; i < 6; i++) {
      createEmployee(db6, { name: `Motorista ${i}`, setor: 'Transporte Ambulância' });
    }
    const res6 = await request(app).post('/api/schedules/generate').send({ month: 1, year: 2025 });
    expect(res6.body.success).toBe(true);
    const nightWarnings6 = res6.body.warnings.filter((w) => w.type === 'noturno_ambul');

    // Cenário B: 1 motorista (linha base para comparação)
    const dbSolo = freshDb();
    createEmployee(dbSolo, { name: 'Solo', setor: 'Transporte Ambulância' });
    const resSolo = await request(app).post('/api/schedules/generate').send({ month: 1, year: 2025 });
    const nightWarningsSolo = resSolo.body.warnings.filter((w) => w.type === 'noturno_ambul');

    // 6 motoristas devem produzir ≤ warnings do que 1 motorista
    expect(nightWarnings6.length).toBeLessThanOrEqual(nightWarningsSolo.length);
  });

  it('com 1 motorista de Ambulância gera warnings noturnos em vários dias', async () => {
    const db = freshDb();
    createEmployee(db, { name: 'Solo', setor: 'Transporte Ambulância' });

    const res = await request(app).post('/api/schedules/generate').send({ month: 1, year: 2025 });

    expect(res.body.success).toBe(true);
    const nightWarnings = res.body.warnings.filter((w) => w.type === 'noturno_ambul');
    // 1 motorista não consegue cobrir todos os dias que exigem ≥2 Ambulância
    expect(nightWarnings.length).toBeGreaterThan(0);
  });

  it('entries convertidas pelo enforcement têm shift_type_id consistente com shift_name (issue #17)', async () => {
    // Issue #17: após enforcement converter uma folga em plantão, a cópia em
    // memória não atualizava shift_type_id (nem is_day_off/shift_name no bloco
    // Ambul diurno). Garante invariante: shift_type_id e shift_name são coerentes
    // em todas as entries de plantão.
    const db = freshDb();
    createEmployee(db, { name: 'HemoA', setor: 'Transporte Hemodiálise' });
    createEmployee(db, { name: 'HemoB', setor: 'Transporte Hemodiálise' });
    createEmployee(db, { name: 'AmbuA', setor: 'Transporte Ambulância' });

    await request(app).post('/api/schedules/generate').send({ month: 1, year: 2025 });

    const shiftsRes = await request(app).get('/api/shift-types');
    const shiftById = {};
    for (const s of shiftsRes.body) shiftById[s.id] = s.name;

    const schedule = await request(app).get('/api/schedules?month=1&year=2025');
    const workEntries = schedule.body.entries.filter((e) => !e.is_day_off);

    expect(workEntries.length).toBeGreaterThan(0);
    workEntries.forEach((e) => {
      expect(shiftById[e.shift_type_id]).toBe(e.shift_name);
    });
  });
});
