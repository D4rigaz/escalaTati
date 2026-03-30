/**
 * test(generator): cobertura de integração de observabilidade em schedule_generations — issue #46
 *
 * Tester Senior
 *
 * Verifica que após POST /generate, a tabela schedule_generations persiste
 * corretamente warnings, hours e weekClassifications em params_json.
 *
 * Critérios de aceitação (issue #46):
 *   AC1 — results: cada entry contém { employee, hours (number), weekClassifications (array) }
 *   AC2 — weekClassifications: cada item tem { weekIndex (number), type ('36h'|'42h') }
 *   AC3 — warnings: persiste como array (vazio ou não), cada warning tem campo message (string)
 *
 * Casos:
 *   Caso 1 — 1 motorista Ambulância: results[0] com hours e weekClassifications; warnings é array
 *   Caso 2 — 1 motorista Hemodiálise: warnings[] não-vazio (diurno_hemo — 1 hemo não cobre 2/dia)
 *   Caso 3 — zero motoristas: warnings=[], results=[], sem crash de serialização
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb, createEmployee } from './helpers.js';
import { query } from '../db/database.js';

beforeEach(async () => { await freshDb(); });

describe('POST /api/schedules/generate — observabilidade em schedule_generations (issue #46)', () => {
  // ── Caso 1 ──────────────────────────────────────────────────────────────────
  // 1 motorista Ambulância → geração típica.
  // Verifica: results[0].hours (number), results[0].weekClassifications (array de {weekIndex, type}),
  // warnings é array, todos os warnings têm campo message (string).

  it('Caso 1 — 1 motorista sem warnings de desvio: results e warnings persistidos em params_json', async () => {
    await freshDb();
    await createEmployee(null, { name: 'Motorista A', setor: 'Transporte Ambulância' });

    const genRes = await request(app)
      .post('/api/schedules/generate')
      .send({ month: 2, year: 2026, overwriteLocked: true });
    expect(genRes.status).toBe(200);
    expect(genRes.body.success).toBe(true);

    // Lê diretamente da tabela schedule_generations via query
    const row = (await query('SELECT params_json FROM schedule_generations ORDER BY id DESC LIMIT 1')).rows[0];
    expect(row).toBeDefined();

    const params = JSON.parse(row.params_json);

    // AC3 — warnings persiste como array; cada entry tem campo message
    expect(params.warnings).toBeInstanceOf(Array);
    params.warnings.forEach((w) => {
      expect(w).toHaveProperty('message');
      expect(typeof w.message).toBe('string');
    });

    // AC1 — results persiste como array com 1 entry
    expect(params.results).toBeInstanceOf(Array);
    expect(params.results).toHaveLength(1);

    const result = params.results[0];
    expect(result.employee).toBe('Motorista A');

    // AC1 — hours é um número positivo
    expect(typeof result.hours).toBe('number');
    expect(result.hours).toBeGreaterThan(0);

    // AC2 — weekClassifications é array não-vazio de { weekIndex (number), type ('36h'|'42h') }
    expect(result.weekClassifications).toBeInstanceOf(Array);
    expect(result.weekClassifications.length).toBeGreaterThan(0);
    result.weekClassifications.forEach((wc) => {
      expect(typeof wc.weekIndex).toBe('number');
      expect(['36h', '42h']).toContain(wc.type);
    });

    // employeeCount também é persistido
    expect(params.employeeCount).toBe(1);
  });

  // ── Caso 2 ──────────────────────────────────────────────────────────────────
  // 1 motorista Hemodiálise → enforceDiurnoCoverage não consegue atingir 2 Hemo/dia
  // na maior parte dos dias → emite warnings do tipo 'diurno_hemo'.
  // Verifica: params_json.warnings.length > 0, cada warning.message é string não-vazia.

  it('Caso 2 — 1 motorista Hemodiálise: warnings[] não-vazio com campo message serializado', async () => {
    await freshDb();
    // 1 Hemo employee: enforcement exige 2 Hemo por dia → sempre insuficiente
    await createEmployee(null, { name: 'Hemo 1', setor: 'Transporte Hemodiálise' });

    const genRes = await request(app)
      .post('/api/schedules/generate')
      .send({ month: 2, year: 2026, overwriteLocked: true });
    expect(genRes.status).toBe(200);

    const row = (await query('SELECT params_json FROM schedule_generations ORDER BY id DESC LIMIT 1')).rows[0];
    expect(row).toBeDefined();

    const params = JSON.parse(row.params_json);

    // AC3 — warnings é array com pelo menos 1 entry
    expect(params.warnings).toBeInstanceOf(Array);
    expect(params.warnings.length).toBeGreaterThan(0);

    // Cada warning persiste com campo message (string não-vazia)
    params.warnings.forEach((w) => {
      expect(w).toHaveProperty('message');
      expect(typeof w.message).toBe('string');
      expect(w.message.length).toBeGreaterThan(0);
    });

    // Pelo menos 1 warning de cobertura insuficiente Hemodiálise (diurno_hemo)
    const hemoWarnings = params.warnings.filter((w) => w.type === 'diurno_hemo');
    expect(hemoWarnings.length).toBeGreaterThan(0);

    // AC1 — results também persiste corretamente para 1 employee
    expect(params.results).toBeInstanceOf(Array);
    expect(params.results).toHaveLength(1);
    expect(typeof params.results[0].hours).toBe('number');

    // AC2 — weekClassifications persiste mesmo com warnings
    expect(params.results[0].weekClassifications).toBeInstanceOf(Array);
    expect(params.results[0].weekClassifications.length).toBeGreaterThan(0);
    params.results[0].weekClassifications.forEach((wc) => {
      expect(typeof wc.weekIndex).toBe('number');
      expect(['36h', '42h']).toContain(wc.type);
    });
  });

  // ── Caso 3 ───────────────────────────────────────────────────────────────────────
  // Zero motoristas → geração sem loop de employees.
  // Verifica: results=[], employeeCount=0, sem crash de serialização.
  // Nota: com zero employees, enforceDailyCoverage emite warnings 'sem_motorista'
  // para cada dia do mês — warnings[] não é vazio, mas é serializado corretamente.

  it('Caso 3 — zero motoristas: results=[] e sem_motorista warnings — sem erro de serialização', async () => {
    // beforeEach já chama freshDb() — tabela employees está vazia

    const genRes = await request(app)
      .post('/api/schedules/generate')
      .send({ month: 2, year: 2026, overwriteLocked: true });
    expect(genRes.status).toBe(200);
    expect(genRes.body.success).toBe(true);

    // Verifica via resposta da rota: results é array vazio
    expect(Array.isArray(genRes.body.results)).toBe(true);
    expect(genRes.body.results).toEqual([]);

    // warnings da rota: contém warnings de cobertura (diurno_hemo, diurno_ambul, sem_motorista)
    // — com zero employees, todos os checks de cobertura falham
    expect(Array.isArray(genRes.body.warnings)).toBe(true);
    expect(genRes.body.warnings.length).toBeGreaterThan(0);
    genRes.body.warnings.forEach((w) => {
      expect(w).toHaveProperty('message');
      expect(typeof w.message).toBe('string');
    });

    // Verifica via schedule_generations (persistência)
    const row = (await query('SELECT params_json FROM schedule_generations ORDER BY id DESC LIMIT 1')).rows[0];
    expect(row).toBeDefined();

    // Garante que params_json é JSON válido (sem crash de serialização)
    expect(() => JSON.parse(row.params_json)).not.toThrow();
    const params = JSON.parse(row.params_json);

    // AC1 — results serializado como array vazio
    expect(params.results).toEqual([]);

    // AC3 — warnings serializado como array com sem_motorista entries (não-vazio)
    expect(params.warnings).toBeInstanceOf(Array);
    expect(params.warnings.length).toBeGreaterThan(0);
    params.warnings.forEach((w) => {
      expect(w).toHaveProperty('message');
      expect(typeof w.message).toBe('string');
    });

    // employeeCount persiste como 0
    expect(params.employeeCount).toBe(0);
  });
});
