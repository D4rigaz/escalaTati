import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { query } from '../db/database.js';
import { freshDb, createEmployee, shiftId } from './helpers.js';

beforeEach(async () => { await freshDb(); });

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
    await createEmployee(null, { name: 'João', cargo: 'Técnico', setor: 'TI' });
    await createEmployee(null, { name: 'Maria', cargo: 'Técnica', setor: 'TI' });

    const res = await request(app)
      .post('/api/schedules/generate')
      .send({ month: 1, year: 2025 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.warnings)).toBe(true);

    // Issue #112: período Jan/2025 = 05/01–01/02 (28 dias, primeira Dom→Sáb anterior ao próximo Dom)
    const schedule = await request(app).get('/api/schedules?month=1&year=2025');
    expect(schedule.body.entries.length).toBeGreaterThan(0);
    expect(schedule.body.entries.every((e) => e.employee_id != null)).toBe(true);
    expect(schedule.body.entries.every((e) => e.date >= '2025-01-05' && e.date <= '2025-02-01')).toBe(true);
  });

  it('gera escala vazia quando não há funcionários', async () => {
    const res = await request(app)
      .post('/api/schedules/generate')
      .send({ month: 1, year: 2025 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const schedule = await request(app).get('/api/schedules?month=1&year=2025');
    expect(schedule.body.entries).toHaveLength(0);
  });

  it('não sobrescreve entradas bloqueadas por padrão', async () => {
    const emp = await createEmployee(null, { name: 'Ana' });
    const sid = await shiftId(null, 'Diurno');

    // Insere entrada bloqueada manualmente
    await query(
      'INSERT INTO schedule_entries (employee_id, shift_type_id, date, is_day_off, is_locked) VALUES ($1, $2, $3, FALSE, TRUE)',
      [emp.id, sid, '2025-01-15']
    );

    await request(app).post('/api/schedules/generate').send({ month: 1, year: 2025 });

    const entry = (await query(
      'SELECT * FROM schedule_entries WHERE employee_id = $1 AND date = $2',
      [emp.id, '2025-01-15']
    )).rows[0];

    expect(entry.shift_type_id).toBe(sid);
    expect(entry.is_locked).toBe(true);
  });
});

describe('PUT /api/schedules/entry/:id', () => {
  it('retorna 404 para id inexistente', async () => {
    const res = await request(app).put('/api/schedules/entry/9999').send({ is_day_off: true });
    expect(res.status).toBe(404);
  });

  it('atualiza is_day_off de uma entrada', async () => {
    const emp = await createEmployee(null, { name: 'Carlos' });
    const sid = await shiftId(null, 'Noturno');

    const { rows } = await query(
      'INSERT INTO schedule_entries (employee_id, shift_type_id, date, is_day_off) VALUES ($1, $2, $3, FALSE) RETURNING id',
      [emp.id, sid, '2025-03-10']
    );

    const res = await request(app)
      .put(`/api/schedules/entry/${rows[0].id}`)
      .send({ is_day_off: true });

    expect(res.status).toBe(200);
    expect(res.body.is_day_off).toBe(true);
  });

  it('atualiza notas de uma entrada', async () => {
    const emp = await createEmployee(null, { name: 'Diana' });

    const { rows } = await query(
      'INSERT INTO schedule_entries (employee_id, date, is_day_off) VALUES ($1, $2, TRUE) RETURNING id',
      [emp.id, '2025-03-12']
    );

    const res = await request(app)
      .put(`/api/schedules/entry/${rows[0].id}`)
      .send({ notes: 'Licença médica' });

    expect(res.status).toBe(200);
    expect(res.body.notes).toBe('Licença médica');
  });

  it('setor_override "" é normalizado para null (issue #15)', async () => {
    const emp = await createEmployee(null, { name: 'Eduardo', setores: ['Transporte Ambulância'] });

    const { rows } = await query(
      'INSERT INTO schedule_entries (employee_id, date, is_day_off, setor_override) VALUES ($1, $2, FALSE, $3) RETURNING id',
      [emp.id, '2025-03-15', 'Transporte Ambulância']
    );

    const res = await request(app)
      .put(`/api/schedules/entry/${rows[0].id}`)
      .send({ setor_override: '' });

    expect(res.status).toBe(200);
    expect(res.body.setor_override).toBeNull();
  });

  it('setor_override null limpa o override existente', async () => {
    const emp = await createEmployee(null, { name: 'Flávia', setores: ['Transporte Ambulância'] });

    const { rows } = await query(
      'INSERT INTO schedule_entries (employee_id, date, is_day_off, setor_override) VALUES ($1, $2, FALSE, $3) RETURNING id',
      [emp.id, '2025-03-16', 'Transporte Ambulância']
    );

    const res = await request(app)
      .put(`/api/schedules/entry/${rows[0].id}`)
      .send({ setor_override: null });

    expect(res.status).toBe(200);
    expect(res.body.setor_override).toBeNull();
  });

  it('setor_override válido é aceito e persistido', async () => {
    const emp = await createEmployee(null, {
      name: 'Gustavo',
      setores: ['Transporte Ambulância', 'Transporte Hemodiálise'],
    });

    const { rows } = await query(
      'INSERT INTO schedule_entries (employee_id, date, is_day_off) VALUES ($1, $2, FALSE) RETURNING id',
      [emp.id, '2025-03-17']
    );

    const res = await request(app)
      .put(`/api/schedules/entry/${rows[0].id}`)
      .send({ setor_override: 'Transporte Hemodiálise' });

    expect(res.status).toBe(200);
    expect(res.body.setor_override).toBe('Transporte Hemodiálise');
  });

  it('setor_override inválido (não pertence ao funcionário) retorna 400', async () => {
    const emp = await createEmployee(null, { name: 'Helena', setores: ['Transporte Ambulância'] });

    const { rows } = await query(
      'INSERT INTO schedule_entries (employee_id, date, is_day_off) VALUES ($1, $2, FALSE) RETURNING id',
      [emp.id, '2025-03-18']
    );

    const res = await request(app)
      .put(`/api/schedules/entry/${rows[0].id}`)
      .send({ setor_override: 'Transporte Hemodiálise' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/setor_override/i);
  });

  it('omitir setor_override não altera valor existente (no-op)', async () => {
    // Garante que o guard `setor_override !== undefined` funciona corretamente:
    // campos não enviados no payload não devem sobrescrever o valor no DB.
    const emp = await createEmployee(null, { name: 'Igor', setores: ['Transporte Ambulância'] });

    const { rows } = await query(
      'INSERT INTO schedule_entries (employee_id, date, is_day_off, setor_override) VALUES ($1, $2, FALSE, $3) RETURNING id',
      [emp.id, '2025-03-19', 'Transporte Ambulância']
    );

    // Atualiza apenas notes — setor_override não enviado
    const res = await request(app)
      .put(`/api/schedules/entry/${rows[0].id}`)
      .send({ notes: 'Observação' });

    expect(res.status).toBe(200);
    expect(res.body.setor_override).toBe('Transporte Ambulância'); // inalterado
    expect(res.body.notes).toBe('Observação');
  });
});

describe('DELETE /api/schedules/month', () => {
  it('retorna 400 sem month e year', async () => {
    const res = await request(app).delete('/api/schedules/month');
    expect(res.status).toBe(400);
  });

  it('remove todas as entradas do mês', async () => {
    const emp = await createEmployee(null, { name: 'Eduardo' });
    const sid = await shiftId(null, 'Noturno');

    // Issue #112: período Mai/2025 começa em 04/05 (primeiro domingo). Usar datas dentro do período.
    await query(
      'INSERT INTO schedule_entries (employee_id, shift_type_id, date, is_day_off) VALUES ($1, $2, $3, FALSE)',
      [emp.id, sid, '2025-05-04']
    );
    await query(
      'INSERT INTO schedule_entries (employee_id, shift_type_id, date, is_day_off) VALUES ($1, $2, $3, FALSE)',
      [emp.id, sid, '2025-05-05']
    );

    const res = await request(app).delete('/api/schedules/month?month=5&year=2025');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(2);

    const schedule = await request(app).get('/api/schedules?month=5&year=2025');
    expect(schedule.body.entries).toHaveLength(0);
  });

  it('não remove entradas de outros meses', async () => {
    const emp = await createEmployee(null, { name: 'Flávia' });
    const sid = await shiftId(null, 'Diurno');

    await query(
      'INSERT INTO schedule_entries (employee_id, shift_type_id, date, is_day_off) VALUES ($1, $2, $3, FALSE)',
      [emp.id, sid, '2025-04-15']
    );

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
