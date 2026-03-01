import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb } from './helpers.js';

beforeEach(() => freshDb());

describe('GET /api/shift-types', () => {
  it('retorna os 4 turnos fixos após seed — Diurno, Noturno, Manhã e Tarde', async () => {
    const res = await request(app).get('/api/shift-types');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    const names = res.body.map((s) => s.name);
    expect(names).toContain('Diurno');
    expect(names).toContain('Noturno');
    expect(names).toContain('Manhã');
    expect(names).toContain('Tarde');
  });

  it('Manhã tem horário 07:00–13:00 e 6h de duração', async () => {
    const res = await request(app).get('/api/shift-types');
    const manha = res.body.find((s) => s.name === 'Manhã');
    expect(manha.start_time).toBe('07:00');
    expect(manha.end_time).toBe('13:00');
    expect(manha.duration_hours).toBe(6);
  });

  it('Tarde tem horário 13:00–19:00 e 6h de duração', async () => {
    const res = await request(app).get('/api/shift-types');
    const tarde = res.body.find((s) => s.name === 'Tarde');
    expect(tarde.start_time).toBe('13:00');
    expect(tarde.end_time).toBe('19:00');
    expect(tarde.duration_hours).toBe(6);
  });

  it('Diurno tem horário 07:00–19:00 e 12h de duração', async () => {
    const res = await request(app).get('/api/shift-types');
    const diurno = res.body.find((s) => s.name === 'Diurno');
    expect(diurno.start_time).toBe('07:00');
    expect(diurno.end_time).toBe('19:00');
    expect(diurno.duration_hours).toBe(12);
  });

  it('Noturno tem horário 19:00–07:00 e 12h de duração', async () => {
    const res = await request(app).get('/api/shift-types');
    const noturno = res.body.find((s) => s.name === 'Noturno');
    expect(noturno.start_time).toBe('19:00');
    expect(noturno.end_time).toBe('07:00');
    expect(noturno.duration_hours).toBe(12);
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

describe('POST /api/shift-types — desabilitado (turnos fixos)', () => {
  it('retorna 403 ao tentar criar turno', async () => {
    const res = await request(app).post('/api/shift-types').send({
      name: 'Intermediário',
      start_time: '08:00',
      end_time: '14:00',
      duration_hours: 6,
      color: '#34D399',
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBeTruthy();
  });
});

describe('PUT /api/shift-types/:id — desabilitado (turnos fixos)', () => {
  it('retorna 403 ao tentar editar turno existente', async () => {
    const list = await request(app).get('/api/shift-types');
    const turno = list.body[0];
    const res = await request(app).put(`/api/shift-types/${turno.id}`).send({ color: '#FF0000' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBeTruthy();
  });

  it('retorna 403 para id inexistente (não 404)', async () => {
    const res = await request(app).put('/api/shift-types/9999').send({ color: '#000' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/shift-types/:id — desabilitado (turnos fixos)', () => {
  it('retorna 403 ao tentar excluir turno existente', async () => {
    const list = await request(app).get('/api/shift-types');
    const turno = list.body[0];
    const res = await request(app).delete(`/api/shift-types/${turno.id}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBeTruthy();
  });

  it('retorna 403 para id inexistente (não 404)', async () => {
    const res = await request(app).delete('/api/shift-types/9999');
    expect(res.status).toBe(403);
  });
});
