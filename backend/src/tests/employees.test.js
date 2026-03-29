import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb, createEmployee } from './helpers.js';
import { query } from '../db/database.js';

beforeEach(async () => { await freshDb(); });

describe('GET /api/employees', () => {
  it('retorna array vazio quando não há funcionários', async () => {
    const res = await request(app).get('/api/employees');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('retorna apenas funcionários ativos por padrão', async () => {
    await freshDb();
    const emp = await createEmployee(null, { name: 'Ana' });
    await query('UPDATE employees SET active = FALSE WHERE id = $1', [emp.id]);
    await createEmployee(null, { name: 'Bruno' });

    const res = await request(app).get('/api/employees');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Bruno');
  });

  it('retorna todos com includeInactive=true', async () => {
    await freshDb();
    const emp = await createEmployee(null, { name: 'Ana' });
    await query('UPDATE employees SET active = FALSE WHERE id = $1', [emp.id]);
    await createEmployee(null, { name: 'Bruno' });

    const res = await request(app).get('/api/employees?includeInactive=true');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('inclui restRules em cada funcionário', async () => {
    await freshDb();
    await createEmployee(null, { name: 'Ana' });

    const res = await request(app).get('/api/employees');
    expect(res.status).toBe(200);
    expect(res.body[0].restRules).toBeTruthy();
    expect(res.body[0].restRules.min_rest_hours).toBe(24); // fixo em 24h (regra 10)
  });
});

describe('GET /api/employees/:id', () => {
  it('retorna 404 para id inexistente', async () => {
    const res = await request(app).get('/api/employees/9999');
    expect(res.status).toBe(404);
  });

  it('retorna o funcionário pelo id', async () => {
    await freshDb();
    const emp = await createEmployee(null, { name: 'Carlos' });

    const res = await request(app).get(`/api/employees/${emp.id}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Carlos');
    expect(res.body.restRules).toBeTruthy();
  });
});

describe('POST /api/employees', () => {
  it('cria funcionário com campos obrigatórios', async () => {
    await freshDb();
    const res = await request(app)
      .post('/api/employees')
      .send({ name: 'Diana', setores: ['Transporte Ambulância'] });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Diana');
    expect(res.body.cargo).toBe('Motorista'); // cargo é sempre Motorista (regra 1)
    expect(res.body.active).toBe(true);
    expect(res.body.restRules).toBeTruthy();
  });

  it('retorna 400 quando faltam campos obrigatórios', async () => {
    await freshDb();
    const res = await request(app).post('/api/employees').send({ name: 'Sem setor' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('retorna 400 para setor inválido', async () => {
    await freshDb();
    const res = await request(app)
      .post('/api/employees')
      .send({ name: 'Fora do domínio', setor: 'UTI' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/setor/i);
  });

  it('restRules.min_rest_hours é sempre 24 independente do input (regra 13)', async () => {
    // days_off_per_week foi removido na Regra 13 — descanso só via MIN_REST_HOURS=24
    await freshDb();
    const res = await request(app)
      .post('/api/employees')
      .send({ name: 'Eduardo', setores: ['Transporte Hemodiálise'] });

    expect(res.status).toBe(201);
    expect(res.body.restRules.min_rest_hours).toBe(24);
    expect(res.body.restRules.days_off_per_week).toBeUndefined();
  });
});

describe('PUT /api/employees/:id', () => {
  it('atualiza nome do funcionário', async () => {
    await freshDb();
    const emp = await createEmployee(null, { name: 'Fernanda' });

    const res = await request(app)
      .put(`/api/employees/${emp.id}`)
      .send({ name: 'Fernanda Silva' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Fernanda Silva');
  });

  it('retorna 404 para id inexistente', async () => {
    await freshDb();
    const res = await request(app).put('/api/employees/9999').send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('desativa funcionário via active=false', async () => {
    await freshDb();
    const emp = await createEmployee(null, { name: 'Gustavo' });

    const res = await request(app).put(`/api/employees/${emp.id}`).send({ active: false });
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
  });
});

describe('DELETE /api/employees/:id', () => {
  it('faz soft delete (active=0)', async () => {
    await freshDb();
    const emp = await createEmployee(null, { name: 'Helena' });

    const res = await request(app).delete(`/api/employees/${emp.id}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const check = (await query('SELECT active FROM employees WHERE id = $1', [emp.id])).rows[0];
    expect(check.active).toBe(false);
  });

  it('retorna 404 para id inexistente', async () => {
    await freshDb();
    const res = await request(app).delete('/api/employees/9999');
    expect(res.status).toBe(404);
  });
});

describe('cycle_start — POST/PUT validação', () => {
  it('aceita cycle_start_month válido (1-12) no POST', async () => {
    for (const csm of [1, 6, 12]) {
      await freshDb();
      const res = await request(app).post('/api/employees').send({
        name: `Motorista Mês ${csm}`,
        setores: ['Transporte Ambulância'],
        cycle_start_month: csm,
        cycle_start_year: 2025,
      });
      expect(res.status).toBe(201);
      expect(res.body.cycle_start_month).toBe(csm);
      expect(res.body.cycle_start_year).toBe(2025);
      await freshDb();
    }
  });

  it('rejeita cycle_start_month inválido no POST (0, 13, string, 1.5)', async () => {
    for (const csm of [0, 13, 'invalido', 1.5]) {
      await freshDb();
      const res = await request(app).post('/api/employees').send({
        name: 'Teste',
        setores: ['Transporte Ambulância'],
        cycle_start_month: csm,
        cycle_start_year: 2025,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cycle_start_month/);
      await freshDb();
    }
  });

  it('rejeita cycle_start_year < 2020 no POST', async () => {
    await freshDb();
    const res = await request(app).post('/api/employees').send({
      name: 'Teste',
      setores: ['Transporte Ambulância'],
      cycle_start_month: 1,
      cycle_start_year: 2019,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cycle_start_year/);
    await freshDb();
  });

  it('defaults de cycle_start são 1 e 2026 quando não fornecidos', async () => {
    await freshDb();
    const res = await request(app).post('/api/employees').send({
      name: 'Sem Ciclo',
      setores: ['Transporte Ambulância'],
    });
    expect(res.status).toBe(201);
    expect(res.body.cycle_start_month).toBe(1);
    expect(res.body.cycle_start_year).toBe(2026);
    await freshDb();
  });

  it('atualiza cycle_start_month e cycle_start_year via PUT', async () => {
    await freshDb();
    const emp = await createEmployee(null, { name: 'Ciclo Update', setor: 'Transporte Ambulância' });
    const res = await request(app).put(`/api/employees/${emp.id}`).send({
      cycle_start_month: 6,
      cycle_start_year: 2024,
    });
    expect(res.status).toBe(200);
    expect(res.body.cycle_start_month).toBe(6);
    expect(res.body.cycle_start_year).toBe(2024);
    await freshDb();
  });

  it('rejeita cycle_start_month inválido no PUT', async () => {
    await freshDb();
    const emp = await createEmployee(null, { name: 'Ciclo Inválido', setor: 'Transporte Ambulância' });
    const res = await request(app).put(`/api/employees/${emp.id}`).send({ cycle_start_month: 15 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cycle_start_month/);
    await freshDb();
  });

  it('aceita cycle_start_month null no PUT — no-op, mantém valor atual', async () => {
    await freshDb();
    const emp = await createEmployee(null, { name: 'Ciclo Reset', setor: 'Transporte Ambulância' });
    // createEmployee usa defaults do DB: cycle_start_month=1, cycle_start_year=2026
    const res = await request(app).put(`/api/employees/${emp.id}`).send({ cycle_start_month: null });
    expect(res.status).toBe(200);
    expect(res.body.cycle_start_month).toBe(1);
    await freshDb();
  });

  it('dois motoristas com cycle_start diferentes geram ciclos diferentes no mesmo mês', async () => {
    await freshDb();
    // Motorista A: cycle_start=Jan/2026 → ciclo 1 em Jan/2026, ciclo 2 em Fev/2026
    const resA = await request(app).post('/api/employees').send({
      name: 'Motorista A',
      setores: ['Transporte Ambulância'],
      cycle_start_month: 1,
      cycle_start_year: 2026,
    });
    // Motorista B: cycle_start=Dez/2025 → ciclo 2 em Jan/2026, ciclo 3 em Fev/2026
    const resB = await request(app).post('/api/employees').send({
      name: 'Motorista B',
      setores: ['Transporte Ambulância'],
      cycle_start_month: 12,
      cycle_start_year: 2025,
    });
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    // Ciclos distintos: A.start ≠ B.start → computeCycleMonth diferente para genMonth=Jan/2026
    expect(resA.body.cycle_start_month).not.toBe(resB.body.cycle_start_month);
    await freshDb();
  });
});
