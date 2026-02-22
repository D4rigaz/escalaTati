import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb } from './helpers.js';

beforeEach(() => freshDb());

describe('GET /api/shift-types', () => {
  it('retorna os 3 turnos padrão após seed', async () => {
    const res = await request(app).get('/api/shift-types');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    const names = res.body.map((s) => s.name);
    expect(names).toContain('Manhã');
    expect(names).toContain('Tarde');
    expect(names).toContain('Noturno');
  });

  it('cada turno tem os campos necessários', async () => {
    const res = await request(app).get('/api/shift-types');
    const turno = res.body[0];
    expect(turno).toHaveProperty('id');
    expect(turno).toHaveProperty('name');
    expect(turno).toHaveProperty('start_time');
    expect(turno).toHaveProperty('end_time');
    expect(turno).toHaveProperty('duration_hours');
    expect(turno).toHaveProperty('color');
  });
});

describe('POST /api/shift-types', () => {
  it('cria novo turno com todos os campos', async () => {
    const res = await request(app).post('/api/shift-types').send({
      name: 'Intermediário',
      start_time: '08:00',
      end_time: '14:00',
      duration_hours: 6,
      color: '#34D399',
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Intermediário');
    expect(res.body.id).toBeTruthy();
  });

  it('retorna 400 quando faltam campos', async () => {
    const res = await request(app).post('/api/shift-types').send({ name: 'Incompleto' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('retorna 409 para nome duplicado', async () => {
    const res = await request(app).post('/api/shift-types').send({
      name: 'Manhã',
      start_time: '06:00',
      end_time: '12:00',
      duration_hours: 6,
      color: '#FCD34D',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/já existe/i);
  });
});

describe('PUT /api/shift-types/:id', () => {
  it('atualiza a cor de um turno', async () => {
    const list = await request(app).get('/api/shift-types');
    const turno = list.body[0];

    const res = await request(app)
      .put(`/api/shift-types/${turno.id}`)
      .send({ color: '#FF0000' });

    expect(res.status).toBe(200);
    expect(res.body.color).toBe('#FF0000');
  });

  it('retorna 404 para id inexistente', async () => {
    const res = await request(app).put('/api/shift-types/9999').send({ color: '#000' });
    expect(res.status).toBe(404);
  });

  it('retorna 409 ao renomear para nome já existente', async () => {
    const list = await request(app).get('/api/shift-types');
    const turno = list.body[0];

    const res = await request(app)
      .put(`/api/shift-types/${turno.id}`)
      .send({ name: 'Tarde' });

    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/shift-types/:id', () => {
  it('exclui turno não utilizado', async () => {
    const created = await request(app).post('/api/shift-types').send({
      name: 'Temporário',
      start_time: '10:00',
      end_time: '16:00',
      duration_hours: 6,
      color: '#000000',
    });
    expect(created.status).toBe(201);

    const res = await request(app).delete(`/api/shift-types/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const list = await request(app).get('/api/shift-types');
    expect(list.body.find((s) => s.id === created.body.id)).toBeUndefined();
  });

  it('retorna 404 para id inexistente', async () => {
    const res = await request(app).delete('/api/shift-types/9999');
    expect(res.status).toBe(404);
  });
});
