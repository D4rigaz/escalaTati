import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb, createEmployee, shiftId } from './helpers.js';

beforeEach(() => freshDb());

// ─── Validação ────────────────────────────────────────────────────────────────

describe('GET /api/export/excel — validação', () => {
  it('retorna 400 sem month e year', async () => {
    const res = await request(app).get('/api/export/excel');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('retorna 400 sem month', async () => {
    const res = await request(app).get('/api/export/excel?year=2025');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('retorna 400 sem year', async () => {
    const res = await request(app).get('/api/export/excel?month=1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe('GET /api/export/pdf — validação', () => {
  it('retorna 400 sem month e year', async () => {
    const res = await request(app).get('/api/export/pdf');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('retorna 400 sem month', async () => {
    const res = await request(app).get('/api/export/pdf?year=2025');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('retorna 400 sem year', async () => {
    const res = await request(app).get('/api/export/pdf?month=1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

// ─── Excel ────────────────────────────────────────────────────────────────────

describe('GET /api/export/excel', () => {
  it('retorna 200 e Content-Type xlsx com banco vazio', async () => {
    const res = await request(app).get('/api/export/excel?month=1&year=2025');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
  });

  it('Content-Disposition contém filename com mês zero-padded', async () => {
    const res = await request(app).get('/api/export/excel?month=3&year=2025');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('escala_2025_03.xlsx');
  });

  it('Content-Disposition usa zero-pad para mês < 10', async () => {
    const res = await request(app).get('/api/export/excel?month=9&year=2024');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('escala_2024_09.xlsx');
  });

  it('retorna 200 com funcionário sem entradas (todos folga)', async () => {
    createEmployee(freshDb(), { name: 'Ana', setores: ['Transporte Ambulância'] });

    const res = await request(app).get('/api/export/excel?month=1&year=2025');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
  });

  it('retorna 200 com entrada de plantão noturno', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Bruno', setores: ['Transporte Ambulância'] });
    const nId = shiftId(db, 'Noturno');
    db.prepare(
      'INSERT INTO schedule_entries (employee_id, date, shift_type_id, is_day_off) VALUES (?, ?, ?, 0)'
    ).run(emp.id, '2025-01-15', nId);

    const res = await request(app).get('/api/export/excel?month=1&year=2025');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
  });

  it('retorna 200 com entrada de plantão diurno', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Carlos', setores: ['Transporte Hemodiálise'] });
    const dId = shiftId(db, 'Diurno');
    db.prepare(
      'INSERT INTO schedule_entries (employee_id, date, shift_type_id, is_day_off) VALUES (?, ?, ?, 0)'
    ).run(emp.id, '2025-01-10', dId);

    const res = await request(app).get('/api/export/excel?month=1&year=2025');
    expect(res.status).toBe(200);
  });

  it('retorna 200 com múltiplos funcionários e shift_type_id null (entrada sem turno)', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Diana' });
    db.prepare(
      'INSERT INTO schedule_entries (employee_id, date, shift_type_id, is_day_off) VALUES (?, ?, NULL, 0)'
    ).run(emp.id, '2025-01-05');

    const res = await request(app).get('/api/export/excel?month=1&year=2025');
    expect(res.status).toBe(200);
  });

  it('retorna 200 com cor de funcionário customizada (stripe no Excel)', async () => {
    const db = freshDb();
    db.prepare("UPDATE employees SET color = '#FF5733' WHERE id = ?").run(
      createEmployee(db, { name: 'Eduardo' }).id
    );

    const res = await request(app).get('/api/export/excel?month=1&year=2025');
    expect(res.status).toBe(200);
  });

  it('total de horas dentro do alvo — sem afetar o status da resposta', async () => {
    // Verifica que funcionário com totalHours próximo de 160h (isOk=true)
    // e com totalHours distante (isOk=false) não causam erro na geração.
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Fábio' });
    const nId = shiftId(db, 'Noturno'); // 12h cada
    // 14 plantões = 168h (distante de 160 → isOk=false, fonte vermelha)
    for (let d = 1; d <= 14; d++) {
      const date = `2025-01-${String(d).padStart(2, '0')}`;
      db.prepare(
        'INSERT INTO schedule_entries (employee_id, date, shift_type_id, is_day_off) VALUES (?, ?, ?, 0)'
      ).run(emp.id, date, nId);
    }

    const res = await request(app).get('/api/export/excel?month=1&year=2025');
    expect(res.status).toBe(200);
  });
});

// ─── PDF ──────────────────────────────────────────────────────────────────────

describe('GET /api/export/pdf', () => {
  it('retorna 200 e Content-Type application/pdf com banco vazio', async () => {
    const res = await request(app).get('/api/export/pdf?month=1&year=2025');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  it('Content-Disposition contém filename com mês zero-padded', async () => {
    const res = await request(app).get('/api/export/pdf?month=6&year=2025');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('escala_2025_06.pdf');
  });

  it('Content-Disposition usa zero-pad para mês < 10', async () => {
    const res = await request(app).get('/api/export/pdf?month=2&year=2026');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('escala_2026_02.pdf');
  });

  it('retorna 200 com funcionário sem entradas', async () => {
    createEmployee(freshDb(), { name: 'Gisele', setores: ['Transporte Ambulância'] });

    const res = await request(app).get('/api/export/pdf?month=1&year=2025');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  it('retorna 200 com entrada de plantão e cor de turno (hexToRgb exercitado)', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Hugo', setores: ['Transporte Hemodiálise'] });
    const dId = shiftId(db, 'Diurno');
    db.prepare(
      'INSERT INTO schedule_entries (employee_id, date, shift_type_id, is_day_off) VALUES (?, ?, ?, 0)'
    ).run(emp.id, '2025-01-20', dId);

    const res = await request(app).get('/api/export/pdf?month=1&year=2025');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  it('retorna 200 com shift_type_id null (hexToRgb não é chamado — fallback vazio)', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Iara' });
    db.prepare(
      'INSERT INTO schedule_entries (employee_id, date, shift_type_id, is_day_off) VALUES (?, ?, NULL, 0)'
    ).run(emp.id, '2025-01-07');

    const res = await request(app).get('/api/export/pdf?month=1&year=2025');
    expect(res.status).toBe(200);
  });

  it('retorna 200 com múltiplos funcionários e entradas mistas', async () => {
    const db = freshDb();
    const emp1 = createEmployee(db, { name: 'João', setores: ['Transporte Ambulância'] });
    const emp2 = createEmployee(db, { name: 'Karla', setores: ['Transporte Hemodiálise'] });
    const nId = shiftId(db, 'Noturno');
    const dId = shiftId(db, 'Diurno');

    db.prepare(
      'INSERT INTO schedule_entries (employee_id, date, shift_type_id, is_day_off) VALUES (?, ?, ?, 0)'
    ).run(emp1.id, '2025-01-10', nId);
    db.prepare(
      'INSERT INTO schedule_entries (employee_id, date, shift_type_id, is_day_off) VALUES (?, ?, ?, 1)'
    ).run(emp2.id, '2025-01-10', null);

    const res = await request(app).get('/api/export/pdf?month=1&year=2025');
    expect(res.status).toBe(200);
  });

  it('total de horas fora do alvo (isOk=false) não causa erro na geração', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Lara' });
    const nId = shiftId(db, 'Noturno');
    for (let d = 1; d <= 14; d++) {
      const date = `2025-01-${String(d).padStart(2, '0')}`;
      db.prepare(
        'INSERT INTO schedule_entries (employee_id, date, shift_type_id, is_day_off) VALUES (?, ?, ?, 0)'
      ).run(emp.id, date, nId);
    }

    const res = await request(app).get('/api/export/pdf?month=1&year=2025');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });
});
