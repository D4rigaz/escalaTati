/**
 * test(e2e): testes de integração end-to-end — issue #52
 *
 * Tester Senior
 *
 * Exercita o fluxo completo: criar motoristas → gerar escala → exportar,
 * verificando o encadeamento entre os módulos CRUD, gerador e exportService.
 *
 * Cenário 1 — fluxo completo básico:
 *   2 motoristas (setores distintos) → POST /generate → entries criadas → GET /export/excel OK
 *
 * Cenário 2 — geração + observabilidade:
 *   POST /generate → GET /api/schedules/generations retorna params_json com results e warnings
 *
 * Cenário 3 — regeneração:
 *   POST /generate duas vezes no mesmo mês (overwriteLocked: true) → sem erro;
 *   schedule_generations acumula 2 registros
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb, createEmployee } from './helpers.js';

beforeEach(() => freshDb());

// ── Cenário 1 ─────────────────────────────────────────────────────────────────

describe('E2E Cenário 1 — fluxo completo: criar → gerar → exportar', () => {
  it('2 motoristas em setores distintos: entries criadas e Excel exportado com Content-Type correto', async () => {
    const db = freshDb();
    createEmployee(db, { name: 'Motorista Amb', setor: 'Transporte Ambulância' });
    createEmployee(db, { name: 'Motorista Hemo', setor: 'Transporte Hemodiálise' });

    // Gerar escala
    const genRes = await request(app)
      .post('/api/schedules/generate')
      .send({ month: 1, year: 2026, overwriteLocked: true });
    expect(genRes.status).toBe(200);
    expect(genRes.body.success).toBe(true);

    // Verificar que entries foram criadas no banco
    const schedRes = await request(app).get('/api/schedules?month=1&year=2026');
    expect(schedRes.status).toBe(200);
    expect(schedRes.body.entries.length).toBeGreaterThan(0);
    // Todas as entries pertencem ao mês correto
    expect(schedRes.body.entries.every((e) => e.date.startsWith('2026-01'))).toBe(true);
    // Ambos os motoristas têm entries
    const empIds = new Set(schedRes.body.entries.map((e) => e.employee_id));
    expect(empIds.size).toBe(2);

    // Exportar Excel — deve retornar 200 com Content-Type xlsx
    const exportRes = await request(app).get('/api/export/excel?month=1&year=2026');
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers['content-type']).toMatch(
      /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/
    );
    // Body não-vazio
    expect(exportRes.body).toBeDefined();
  });
});

// ── Cenário 2 ─────────────────────────────────────────────────────────────────

describe('E2E Cenário 2 — geração + observabilidade via GET /api/schedules/generations', () => {
  it('após geração, generations contém params_json com results (por motorista) e warnings', async () => {
    const db = freshDb();
    createEmployee(db, { name: 'Motorista Amb', setor: 'Transporte Ambulância' });
    createEmployee(db, { name: 'Motorista Hemo', setor: 'Transporte Hemodiálise' });

    await request(app)
      .post('/api/schedules/generate')
      .send({ month: 2, year: 2026, overwriteLocked: true });

    const listRes = await request(app)
      .get('/api/schedules/generations?month=2&year=2026');
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBe(1);

    const gen = listRes.body[0];
    expect(gen.month).toBe(2);
    expect(gen.year).toBe(2026);

    // params_json deve ser objeto (não string)
    expect(typeof gen.params_json).toBe('object');
    expect(gen.params_json).not.toBeNull();

    // results: um entry por motorista
    expect(Array.isArray(gen.params_json.results)).toBe(true);
    expect(gen.params_json.results.length).toBe(2);
    // Cada result tem employee (nome) e hours
    gen.params_json.results.forEach((r) => {
      expect(r).toHaveProperty('employee');
      expect(r).toHaveProperty('hours');
    });

    // warnings: array (pode ser vazio)
    expect(Array.isArray(gen.params_json.warnings)).toBe(true);
  });
});

// ── Cenário 3 ─────────────────────────────────────────────────────────────────

describe('E2E Cenário 3 — regeneração do mesmo mês', () => {
  it('duas gerações com overwriteLocked: true → ambas bem-sucedidas e 2 registros em schedule_generations', async () => {
    const db = freshDb();
    createEmployee(db, { name: 'Motorista Amb', setor: 'Transporte Ambulância' });

    const res1 = await request(app)
      .post('/api/schedules/generate')
      .send({ month: 3, year: 2026, overwriteLocked: true });
    expect(res1.status).toBe(200);
    expect(res1.body.success).toBe(true);

    const res2 = await request(app)
      .post('/api/schedules/generate')
      .send({ month: 3, year: 2026, overwriteLocked: true });
    expect(res2.status).toBe(200);
    expect(res2.body.success).toBe(true);

    // schedule_generations deve ter 2 registros para Mar/2026
    const listRes = await request(app)
      .get('/api/schedules/generations?month=3&year=2026');
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBe(2);

    // Ordem DESC por id: geração mais recente primeiro
    expect(listRes.body[0].id).toBeGreaterThan(listRes.body[1].id);
  });
});
