import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb, createEmployee } from './helpers.js';

beforeEach(() => freshDb());

describe('GET /api/employees', () => {
  it('retorna array vazio quando não há funcionários', async () => {
    const res = await request(app).get('/api/employees');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('retorna apenas funcionários ativos por padrão', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Ana' });
    db.prepare("UPDATE employees SET active = 0 WHERE id = ?").run(emp.id);
    createEmployee(db, { name: 'Bruno' });

    const res = await request(app).get('/api/employees');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Bruno');
  });

  it('retorna todos com includeInactive=true', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Ana' });
    db.prepare("UPDATE employees SET active = 0 WHERE id = ?").run(emp.id);
    createEmployee(db, { name: 'Bruno' });

    const res = await request(app).get('/api/employees?includeInactive=true');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('inclui restRules em cada funcionário', async () => {
    const db = freshDb();
    createEmployee(db, { name: 'Ana' });

    const res = await request(app).get('/api/employees');
    expect(res.status).toBe(200);
    expect(res.body[0].restRules).toBeTruthy();
    expect(res.body[0].restRules.min_rest_hours).toBe(11);
  });
});

describe('GET /api/employees/:id', () => {
  it('retorna 404 para id inexistente', async () => {
    const res = await request(app).get('/api/employees/9999');
    expect(res.status).toBe(404);
  });

  it('retorna o funcionário pelo id', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Carlos' });

    const res = await request(app).get(`/api/employees/${emp.id}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Carlos');
    expect(res.body.restRules).toBeTruthy();
  });
});

describe('POST /api/employees', () => {
  it('cria funcionário com campos obrigatórios', async () => {
    freshDb();
    const res = await request(app)
      .post('/api/employees')
      .send({ name: 'Diana', cargo: 'Médica', setor: 'UTI' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Diana');
    expect(res.body.cargo).toBe('Médica');
    expect(res.body.active).toBe(1);
    expect(res.body.restRules).toBeTruthy();
  });

  it('retorna 400 quando faltam campos obrigatórios', async () => {
    freshDb();
    const res = await request(app).post('/api/employees').send({ name: 'Sem cargo' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('aplica regras de descanso customizadas', async () => {
    freshDb();
    const res = await request(app)
      .post('/api/employees')
      .send({ name: 'Eduardo', cargo: 'Enfermeiro', setor: 'PS', restRules: { min_rest_hours: 12, days_off_per_week: 2 } });

    expect(res.status).toBe(201);
    expect(res.body.restRules.min_rest_hours).toBe(12);
    expect(res.body.restRules.days_off_per_week).toBe(2);
  });
});

describe('PUT /api/employees/:id', () => {
  it('atualiza nome do funcionário', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Fernanda' });

    const res = await request(app)
      .put(`/api/employees/${emp.id}`)
      .send({ name: 'Fernanda Silva' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Fernanda Silva');
  });

  it('retorna 404 para id inexistente', async () => {
    freshDb();
    const res = await request(app).put('/api/employees/9999').send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('desativa funcionário via active=false', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Gustavo' });

    const res = await request(app).put(`/api/employees/${emp.id}`).send({ active: false });
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(0);
  });
});

describe('DELETE /api/employees/:id', () => {
  it('faz soft delete (active=0)', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Helena' });

    const res = await request(app).delete(`/api/employees/${emp.id}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const check = db.prepare('SELECT active FROM employees WHERE id = ?').get(emp.id);
    expect(check.active).toBe(0);
  });

  it('retorna 404 para id inexistente', async () => {
    freshDb();
    const res = await request(app).delete('/api/employees/9999');
    expect(res.status).toBe(404);
  });
});
