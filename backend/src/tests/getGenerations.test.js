/**
 * test(api): cobertura de integração para GET /api/schedules/generations — issue #50
 *
 * Tester Senior
 *
 * Verifica o endpoint GET /api/schedules/generations com e sem filtros de mês/ano.
 *
 * Critérios de aceitação (issue #50):
 *   AC1 — GET sem filtro retorna todas as gerações em ordem DESC por id
 *   AC2 — GET com ?month e ?year filtra corretamente
 *   AC3 — GET com filtro sem correspondência retorna []
 *   AC4 — params_json é retornado como objeto (não string) com campos results e warnings
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb, createEmployee } from './helpers.js';

beforeEach(async () => { await freshDb(); });

describe('GET /api/schedules/generations (issue #50)', () => {
  // ── AC1 ──────────────────────────────────────────────────────────────────────
  // GET sem filtro → retorna todas as gerações em ordem DESC por id.
  // Gera 2 escalas em meses distintos e confirma: array com ≥2 entradas,
  // res.body[0].id > res.body[1].id.

  it('AC1 — GET sem filtro retorna todas as gerações em ordem DESC por id', async () => {
    // Gerar 2 escalas em meses diferentes
    const res1 = await request(app)
      .post('/api/schedules/generate')
      .send({ month: 1, year: 2026, overwriteLocked: true });
    expect(res1.status).toBe(200);

    const res2 = await request(app)
      .post('/api/schedules/generate')
      .send({ month: 2, year: 2026, overwriteLocked: true });
    expect(res2.status).toBe(200);

    const res = await request(app)
      .get('/api/schedules/generations')
      .expect(200);

    expect(res.body).toBeInstanceOf(Array);
    expect(res.body.length).toBeGreaterThanOrEqual(2);

    // Ordem DESC: id do último inserido vem primeiro
    expect(res.body[0].id).toBeGreaterThan(res.body[1].id);
  });

  // ── AC2 ──────────────────────────────────────────────────────────────────────
  // GET com ?month e ?year → filtra corretamente.
  // Gera escalas para janeiro e fevereiro, filtra por janeiro:
  // todas as entradas retornadas devem ter month=1 e year=2026.

  it('AC2 — GET com ?month e ?year filtra corretamente', async () => {
    await request(app)
      .post('/api/schedules/generate')
      .send({ month: 1, year: 2026, overwriteLocked: true });
    await request(app)
      .post('/api/schedules/generate')
      .send({ month: 2, year: 2026, overwriteLocked: true });

    const res = await request(app)
      .get('/api/schedules/generations?month=1&year=2026')
      .expect(200);

    expect(res.body).toBeInstanceOf(Array);
    expect(res.body.length).toBeGreaterThanOrEqual(1);

    res.body.forEach((g) => {
      expect(g.month).toBe(1);
      expect(g.year).toBe(2026);
    });
  });

  // ── AC3 ──────────────────────────────────────────────────────────────────────
  // GET com filtro sem correspondência → retorna [] sem erro 500.
  // Nenhuma geração no banco para 12/1999.

  it('AC3 — GET com filtro sem correspondência retorna []', async () => {
    const res = await request(app)
      .get('/api/schedules/generations?month=12&year=1999')
      .expect(200);

    expect(res.body).toEqual([]);
  });

  // ── AC4 ──────────────────────────────────────────────────────────────────────
  // params_json é retornado como objeto (não string).
  // Gera uma escala com 1 motorista e verifica que params_json é objeto com
  // campos results (array) e warnings (array).

  it('AC4 — params_json retornado como objeto com campos results e warnings', async () => {
    await createEmployee(null, { name: 'Motorista X', setor: 'Transporte Ambulância' });

    await request(app)
      .post('/api/schedules/generate')
      .send({ month: 2, year: 2026, overwriteLocked: true });

    const res = await request(app)
      .get('/api/schedules/generations?month=2&year=2026')
      .expect(200);

    expect(res.body.length).toBeGreaterThanOrEqual(1);

    const params = res.body[0].params_json;

    // Deve ser objeto, não string
    expect(typeof params).toBe('object');
    expect(params).not.toBeNull();

    // Campos obrigatórios presentes
    expect(params).toHaveProperty('results');
    expect(params).toHaveProperty('warnings');
    expect(params.results).toBeInstanceOf(Array);
    expect(params.warnings).toBeInstanceOf(Array);
  });

  // ── Bônus: campo generated_at presente ────────────────────────────────────
  // Confirma que o campo generated_at é retornado como string não-vazia.

  it('Bônus — campo generated_at é retornado como string não-vazia', async () => {
    await request(app)
      .post('/api/schedules/generate')
      .send({ month: 3, year: 2026, overwriteLocked: true });

    const res = await request(app)
      .get('/api/schedules/generations?month=3&year=2026')
      .expect(200);

    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const gen = res.body[0];
    expect(typeof gen.generated_at).toBe('string');
    expect(gen.generated_at.length).toBeGreaterThan(0);
  });
});
