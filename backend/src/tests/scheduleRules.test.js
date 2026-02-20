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

// ─── Regra 3: Folga de 24h mínima semanal ───────────────────────────────────

describe('Regra 3 — mínimo 1 folga por semana', () => {
  it('todo funcionário tem ao menos 1 folga por semana', async () => {
    const db = freshDb();
    createEmployee(db, { name: 'Carla' });

    await request(app).post('/api/schedules/generate').send({ month: 1, year: 2025 });

    const schedule = await request(app).get('/api/schedules?month=1&year=2025');
    const entries = schedule.body.entries;

    // Agrupa por semana (domingo-sábado)
    const byDate = {};
    for (const e of entries) byDate[e.date] = e;

    // Janeiro 2025: 5 semanas
    const weeks = [
      ['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04'],
      ['2025-01-05', '2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09', '2025-01-10', '2025-01-11'],
      ['2025-01-12', '2025-01-13', '2025-01-14', '2025-01-15', '2025-01-16', '2025-01-17', '2025-01-18'],
      ['2025-01-19', '2025-01-20', '2025-01-21', '2025-01-22', '2025-01-23', '2025-01-24', '2025-01-25'],
      ['2025-01-26', '2025-01-27', '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31'],
    ];

    for (const week of weeks) {
      const daysOff = week.filter((d) => byDate[d]?.is_day_off === 1 || !byDate[d]);
      expect(daysOff.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// ─── Regra 4: Emendado válido ────────────────────────────────────────────────

describe('Regra 4 — emendado Tarde→Noturno e Noturno→Manhã são permitidos', () => {
  it('permite Noturno seguido de Manhã (emendado válido, 18h total)', async () => {
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

// ─── Regra 5: Mínimo de motoristas ──────────────────────────────────────────

describe('Regra 5 — mínimo de motoristas por período', () => {
  it('gera warning quando não há motoristas suficientes no período diurno', async () => {
    const db = freshDb();
    // Somente 1 motorista (precisa de 4 durante o dia)
    createEmployee(db, { name: 'Eduardo', cargo: 'Motorista', setor: 'Transporte' });
    // Resto não são motoristas
    createEmployee(db, { name: 'Fernanda', cargo: 'Técnica', setor: 'TI' });

    const res = await request(app).post('/api/schedules/generate').send({ month: 1, year: 2025 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const motoristaWarnings = res.body.warnings.filter(
      (w) => w.type === 'motorista_dia' || w.type === 'motorista_noite'
    );
    expect(motoristaWarnings.length).toBeGreaterThan(0);
  });

  it('gera menos warnings noturnos com mais motoristas disponíveis', async () => {
    const db = freshDb();
    // 6 motoristas — acima do mínimo noturno (2) e diurno (4)
    for (let i = 0; i < 6; i++) {
      createEmployee(db, { name: `Motorista ${i}`, cargo: 'Motorista', setor: 'Transporte' });
    }

    const res = await request(app).post('/api/schedules/generate').send({ month: 1, year: 2025 });

    expect(res.body.success).toBe(true);

    // Verifica que checkMotoristaMinimums está ativa: com 6 motoristas todos no Noturno
    // (turno padrão de 12h), haverá warnings noturnos nos dias em que a folga obrigatória
    // coincide para múltiplos motoristas — mas bem menos do que com 1 motorista (31 warnings).
    const nightWarnings = res.body.warnings.filter((w) => w.type === 'motorista_noite');
    expect(nightWarnings.length).toBeGreaterThan(0); // regra ativa: warnings ainda detectados
    expect(nightWarnings.length).toBeLessThan(31);   // mas melhor cobertura que caso crítico (1 motorista)
  });
});
