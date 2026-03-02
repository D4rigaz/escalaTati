/**
 * test(fix): validação de sobreposição de férias — issue #71
 *
 * Desenvolvedor Pleno
 *
 * Cobre POST e PUT /api/employees/:id/vacations com:
 *   - sobreposição parcial (início ou fim dentro de período existente)
 *   - sobreposição total (novo período contém o existente)
 *   - adjacência (não é sobreposição)
 *   - sem sobreposição (comportamento atual preservado)
 *   - PUT editando o próprio registro (não deve conflitar consigo mesmo)
 *   - PUT criando conflito com outro registro existente → 400
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb } from './helpers.js';

beforeEach(() => freshDb());

async function createEmp(name = 'Motorista') {
  const res = await request(app).post('/api/employees').send({
    name,
    setores: ['Transporte Ambulância'],
  });
  expect(res.status).toBe(201);
  return res.body;
}

async function createVacation(empId, start_date, end_date) {
  const res = await request(app)
    .post(`/api/employees/${empId}/vacations`)
    .send({ start_date, end_date });
  expect(res.status).toBe(201);
  return res.body;
}

// ── POST — sobreposição ───────────────────────────────────────────────────────

describe('POST /vacations — sobreposição', () => {
  it('rejeita sobreposição parcial: novo início dentro do período existente', async () => {
    const emp = await createEmp();
    await createVacation(emp.id, '2025-01-01', '2025-01-10');

    const res = await request(app)
      .post(`/api/employees/${emp.id}/vacations`)
      .send({ start_date: '2025-01-08', end_date: '2025-01-15' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/conflita com férias existente/);
  });

  it('rejeita sobreposição parcial: novo fim dentro do período existente', async () => {
    const emp = await createEmp();
    await createVacation(emp.id, '2025-01-10', '2025-01-20');

    const res = await request(app)
      .post(`/api/employees/${emp.id}/vacations`)
      .send({ start_date: '2025-01-05', end_date: '2025-01-12' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/conflita com férias existente/);
  });

  it('rejeita sobreposição total: novo período contém o existente', async () => {
    const emp = await createEmp();
    await createVacation(emp.id, '2025-01-05', '2025-01-10');

    const res = await request(app)
      .post(`/api/employees/${emp.id}/vacations`)
      .send({ start_date: '2025-01-01', end_date: '2025-01-15' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/conflita com férias existente/);
  });

  it('rejeita sobreposição exata: mesmo período', async () => {
    const emp = await createEmp();
    await createVacation(emp.id, '2025-02-01', '2025-02-10');

    const res = await request(app)
      .post(`/api/employees/${emp.id}/vacations`)
      .send({ start_date: '2025-02-01', end_date: '2025-02-10' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/conflita com férias existente/);
  });

  it('mensagem de erro inclui o ID da férias conflitante', async () => {
    const emp = await createEmp();
    const existing = await createVacation(emp.id, '2025-01-01', '2025-01-10');

    const res = await request(app)
      .post(`/api/employees/${emp.id}/vacations`)
      .send({ start_date: '2025-01-05', end_date: '2025-01-15' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain(`ID ${existing.id}`);
  });
});

// ── POST — sem sobreposição (deve aceitar) ────────────────────────────────────

describe('POST /vacations — sem sobreposição', () => {
  it('aceita período sem sobreposição (antes)', async () => {
    const emp = await createEmp();
    await createVacation(emp.id, '2025-02-01', '2025-02-10');

    const res = await request(app)
      .post(`/api/employees/${emp.id}/vacations`)
      .send({ start_date: '2025-01-01', end_date: '2025-01-31' });

    expect(res.status).toBe(201);
  });

  it('aceita período sem sobreposição (depois)', async () => {
    const emp = await createEmp();
    await createVacation(emp.id, '2025-01-01', '2025-01-10');

    const res = await request(app)
      .post(`/api/employees/${emp.id}/vacations`)
      .send({ start_date: '2025-01-11', end_date: '2025-01-20' });

    expect(res.status).toBe(201);
  });

  it('aceita períodos adjacentes (start = end anterior + 1 dia)', async () => {
    const emp = await createEmp();
    await createVacation(emp.id, '2025-01-01', '2025-01-10');

    // Jan 11 começa logo após Jan 10 — não sobrepõe
    const res = await request(app)
      .post(`/api/employees/${emp.id}/vacations`)
      .send({ start_date: '2025-01-11', end_date: '2025-01-20' });

    expect(res.status).toBe(201);
  });

  it('sobreposição de um funcionário não afeta outro', async () => {
    const emp1 = await createEmp('Motorista A');
    const emp2 = await createEmp('Motorista B');
    await createVacation(emp1.id, '2025-01-01', '2025-01-10');

    // mesmo período mas para outro funcionário — deve aceitar
    const res = await request(app)
      .post(`/api/employees/${emp2.id}/vacations`)
      .send({ start_date: '2025-01-01', end_date: '2025-01-10' });

    expect(res.status).toBe(201);
  });
});

// ── PUT — sobreposição ────────────────────────────────────────────────────────

describe('PUT /vacations/:vid — sobreposição', () => {
  it('rejeita edição que cria sobreposição com outra férias', async () => {
    const emp = await createEmp();
    await createVacation(emp.id, '2025-01-01', '2025-01-10');
    const v2 = await createVacation(emp.id, '2025-02-01', '2025-02-10');

    // Tentar expandir v2 para sobrepor v1
    const res = await request(app)
      .put(`/api/employees/${emp.id}/vacations/${v2.id}`)
      .send({ start_date: '2025-01-08', end_date: '2025-02-10' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/conflita com férias existente/);
  });

  it('aceita edição do próprio registro sem conflito consigo mesmo', async () => {
    const emp = await createEmp();
    const v = await createVacation(emp.id, '2025-01-01', '2025-01-10');

    // Editar as datas sem conflito com outros registros
    const res = await request(app)
      .put(`/api/employees/${emp.id}/vacations/${v.id}`)
      .send({ start_date: '2025-01-01', end_date: '2025-01-15' });

    expect(res.status).toBe(200);
    expect(res.body.end_date).toBe('2025-01-15');
  });

  it('aceita edição que mantém as mesmas datas (no-op)', async () => {
    const emp = await createEmp();
    const v = await createVacation(emp.id, '2025-03-01', '2025-03-10');

    const res = await request(app)
      .put(`/api/employees/${emp.id}/vacations/${v.id}`)
      .send({ notes: 'Atualizado' });

    expect(res.status).toBe(200);
    expect(res.body.start_date).toBe('2025-03-01');
    expect(res.body.end_date).toBe('2025-03-10');
  });
});
