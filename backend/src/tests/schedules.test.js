import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb, createEmployee, shiftId } from './helpers.js';

beforeEach(() => freshDb());

describe('GET /api/schedules', () => {
  it('retorna 400 sem month e year', async () => {
    const res = await request(app).get('/api/schedules');
    expect(res.status).toBe(400);
  });

  it('retorna estrutura correta sem entradas', async () => {
    const res = await request(app).get('/api/schedules?month=1&year=2025');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('month', 1);
    expect(res.body).toHaveProperty('year', 2025);
    expect(res.body.entries).toEqual([]);
    expect(res.body.totals).toEqual([]);
  });
});

describe('POST /api/schedules/generate', () => {
  it('retorna 400 sem month e year', async () => {
    const res = await request(app).post('/api/schedules/generate').send({});
    expect(res.status).toBe(400);
  });

  it('retorna 400 com month fora do intervalo (0)', async () => {
    const res = await request(app).post('/api/schedules/generate').send({ month: 0, year: 2025 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('retorna 400 com month fora do intervalo (13)', async () => {
    const res = await request(app).post('/api/schedules/generate').send({ month: 13, year: 2025 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('retorna 400 com year fora do intervalo (1999)', async () => {
    const res = await request(app).post('/api/schedules/generate').send({ month: 1, year: 1999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('retorna 400 com year fora do intervalo (2101)', async () => {
    const res = await request(app).post('/api/schedules/generate').send({ month: 1, year: 2101 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('gera escala com sucesso e retorna estrutura esperada', async () => {
    const db = freshDb();
    createEmployee(db, { name: 'João', cargo: 'Técnico', setor: 'TI' });
    createEmployee(db, { name: 'Maria', cargo: 'Técnica', setor: 'TI' });

    const res = await request(app)
      .post('/api/schedules/generate')
      .send({ month: 1, year: 2025 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.warnings)).toBe(true);

    // Com 2 funcionários, deve gerar entradas para os 31 dias de janeiro
    const schedule = await request(app).get('/api/schedules?month=1&year=2025');
    expect(schedule.body.entries.length).toBeGreaterThan(0);
    expect(schedule.body.entries.every((e) => e.employee_id != null)).toBe(true);
    expect(schedule.body.entries.every((e) => e.date.startsWith('2025-01'))).toBe(true);
  });

  it('gera escala vazia quando não há funcionários', async () => {
    freshDb();
    const res = await request(app)
      .post('/api/schedules/generate')
      .send({ month: 1, year: 2025 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const schedule = await request(app).get('/api/schedules?month=1&year=2025');
    expect(schedule.body.entries).toHaveLength(0);
  });

  it('não sobrescreve entradas bloqueadas por padrão', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Ana' });
    const sid = shiftId(db, 'Manhã');

    // Insere entrada bloqueada manualmente
    db.prepare(
      'INSERT INTO schedule_entries (employee_id, shift_type_id, date, is_day_off, is_locked) VALUES (?, ?, ?, 0, 1)'
    ).run(emp.id, sid, '2025-01-15');

    await request(app).post('/api/schedules/generate').send({ month: 1, year: 2025 });

    const entry = db
      .prepare('SELECT * FROM schedule_entries WHERE employee_id = ? AND date = ?')
      .get(emp.id, '2025-01-15');

    expect(entry.shift_type_id).toBe(sid);
    expect(entry.is_locked).toBe(1);
  });
});

describe('PUT /api/schedules/entry/:id', () => {
  it('retorna 404 para id inexistente', async () => {
    freshDb();
    const res = await request(app).put('/api/schedules/entry/9999').send({ is_day_off: true });
    expect(res.status).toBe(404);
  });

  it('atualiza is_day_off de uma entrada', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Carlos' });
    const sid = shiftId(db, 'Tarde');

    const result = db
      .prepare('INSERT INTO schedule_entries (employee_id, shift_type_id, date, is_day_off) VALUES (?, ?, ?, 0)')
      .run(emp.id, sid, '2025-03-10');

    const res = await request(app)
      .put(`/api/schedules/entry/${result.lastInsertRowid}`)
      .send({ is_day_off: true });

    expect(res.status).toBe(200);
    expect(res.body.is_day_off).toBe(1);
  });

  it('atualiza notas de uma entrada', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Diana' });

    const result = db
      .prepare('INSERT INTO schedule_entries (employee_id, date, is_day_off) VALUES (?, ?, 1)')
      .run(emp.id, '2025-03-12');

    const res = await request(app)
      .put(`/api/schedules/entry/${result.lastInsertRowid}`)
      .send({ notes: 'Licença médica' });

    expect(res.status).toBe(200);
    expect(res.body.notes).toBe('Licença médica');
  });
});

describe('DELETE /api/schedules/month', () => {
  it('retorna 400 sem month e year', async () => {
    const res = await request(app).delete('/api/schedules/month');
    expect(res.status).toBe(400);
  });

  it('remove todas as entradas do mês', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Eduardo' });
    const sid = shiftId(db, 'Noturno');

    db.prepare('INSERT INTO schedule_entries (employee_id, shift_type_id, date, is_day_off) VALUES (?, ?, ?, 0)')
      .run(emp.id, sid, '2025-05-01');
    db.prepare('INSERT INTO schedule_entries (employee_id, shift_type_id, date, is_day_off) VALUES (?, ?, ?, 0)')
      .run(emp.id, sid, '2025-05-02');

    const res = await request(app).delete('/api/schedules/month?month=5&year=2025');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(2);

    const schedule = await request(app).get('/api/schedules?month=5&year=2025');
    expect(schedule.body.entries).toHaveLength(0);
  });

  it('não remove entradas de outros meses', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Flávia' });
    const sid = shiftId(db, 'Manhã');

    db.prepare('INSERT INTO schedule_entries (employee_id, shift_type_id, date, is_day_off) VALUES (?, ?, ?, 0)')
      .run(emp.id, sid, '2025-04-15');

    await request(app).delete('/api/schedules/month?month=5&year=2025');

    const other = await request(app).get('/api/schedules?month=4&year=2025');
    expect(other.body.entries).toHaveLength(1);
  });
});

describe('GET /api/health', () => {
  it('retorna status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeTruthy();
  });
});
