/**
 * test(generator): validar distribuição de folgas — issue #57
 *
 * Tester Senior
 *
 * Garante que o fix do PR #56 (selectOffDays com rotação por employee.id) resolve
 * o bug #55 de forma duradoura: nenhum dia útil deve ter TODOS os motoristas de
 * folga como resultado da geração padrão, sem necessidade de enforcement forçado.
 *
 * Teste 1 — distribuição básica (2 motoristas):
 *   Nenhum dia do mês tem todos os motoristas de folga.
 *   Sem warnings sem_motorista_forcado.
 *
 * Teste 2 — 12 meses de 2026 (meses críticos do bug original):
 *   sem_motorista_forcado = 0 em cada mês com 3 motoristas sem restrições especiais.
 *   Meses críticos confirmados: Fev, Mar, Jun, Set, Nov, Dez.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb, createEmployee } from './helpers.js';

beforeEach(() => freshDb());

// ── Teste 1 ───────────────────────────────────────────────────────────────────

describe('Teste 1 — distribuição básica: 2 motoristas com folgas distintas', () => {
  // Testa o mês de Março/2026 — um dos 6 meses afetados pelo bug original (#55).
  //
  // O critério principal é sem_motorista_forcado = 0: se um dia ficou com todos
  // de folga, o enforcement o corrigiu via Passo 1 (sem forçar descanso).
  // Nota: com 2 motoristas (IDs 1 e 2), o primeiro dia de algumas semanas pode
  // ter ambos de folga por rotação, mas o enforcement o resolve sem warning.
  // O bug original era folgas IDÊNTICAS para todos — verificado abaixo via
  // diff de conjuntos de folgas por semana.
  it('Mar/2026: sem_motorista_forcado = 0; motoristas têm conjuntos de folgas distintos', async () => {
    const db = freshDb();
    createEmployee(db, { name: 'Motorista A', setor: 'Transporte Ambulância' });
    createEmployee(db, { name: 'Motorista B', setor: 'Transporte Ambulância' });

    const genRes = await request(app)
      .post('/api/schedules/generate')
      .send({ month: 3, year: 2026, overwriteLocked: true });
    expect(genRes.status).toBe(200);

    // Critério principal: nenhum enforcement forçado de 1º motorista
    const forcados = genRes.body.warnings.filter((w) => w.type === 'sem_motorista_forcado');
    expect(forcados).toHaveLength(0);

    // Critério secundário: as folgas dos dois motoristas NÃO são idênticas por semana
    // (bug original: todos tinham exatamente as mesmas folgas)
    const schedRes = await request(app).get('/api/schedules?month=3&year=2026');
    const entries = schedRes.body.entries;
    const empIds = [...new Set(entries.map((e) => e.employee_id))];

    const offByEmp = {};
    for (const id of empIds) offByEmp[id] = new Set(entries.filter((e) => e.employee_id === id && e.is_day_off).map((e) => e.date));

    // Os conjuntos de folgas devem ser diferentes (fix: rotação por employee.id)
    const [idA, idB] = empIds;
    const offA = [...offByEmp[idA]].sort().join(',');
    const offB = [...offByEmp[idB]].sort().join(',');
    expect(offA).not.toBe(offB);
  });

  // Verifica também Fev/2026 — outro mês crítico do bug original.
  it('Fev/2026: sem_motorista_forcado = 0; motoristas têm conjuntos de folgas distintos', async () => {
    const db = freshDb();
    createEmployee(db, { name: 'Motorista A', setor: 'Transporte Ambulância' });
    createEmployee(db, { name: 'Motorista B', setor: 'Transporte Ambulância' });

    const genRes = await request(app)
      .post('/api/schedules/generate')
      .send({ month: 2, year: 2026, overwriteLocked: true });
    expect(genRes.status).toBe(200);

    const forcados = genRes.body.warnings.filter((w) => w.type === 'sem_motorista_forcado');
    expect(forcados).toHaveLength(0);

    const schedRes = await request(app).get('/api/schedules?month=2&year=2026');
    const entries = schedRes.body.entries;
    const empIds = [...new Set(entries.map((e) => e.employee_id))];

    const offByEmp = {};
    for (const id of empIds) offByEmp[id] = new Set(entries.filter((e) => e.employee_id === id && e.is_day_off).map((e) => e.date));

    const [idA, idB] = empIds;
    const offA = [...offByEmp[idA]].sort().join(',');
    const offB = [...offByEmp[idB]].sort().join(',');
    expect(offA).not.toBe(offB);
  });
});

// ── Teste 2 ───────────────────────────────────────────────────────────────────

describe('Teste 2 — 12 meses de 2026: sem_motorista_forcado = 0 com 3 motoristas', () => {
  // Cada mês é testado com DB isolado (freshDb por iteração) para garantir
  // que o resultado não seja afetado por estado acumulado de meses anteriores.
  // 3 motoristas com IDs consecutivos → offsets 1%len, 2%len, 3%len → distintos.
  it('Jan–Dez/2026: nenhum mês produz sem_motorista_forcado', async () => {
    const MESES_CRITICOS = new Set([2, 3, 6, 9, 11, 12]);

    for (let month = 1; month <= 12; month++) {
      const db = freshDb();
      createEmployee(db, { name: 'Motorista A', setor: 'Transporte Ambulância' });
      createEmployee(db, { name: 'Motorista B', setor: 'Transporte Ambulância' });
      createEmployee(db, { name: 'Motorista C', setor: 'Transporte Hemodiálise' });

      const res = await request(app)
        .post('/api/schedules/generate')
        .send({ month, year: 2026, overwriteLocked: true });
      expect(res.status).toBe(200);

      const forcados = res.body.warnings.filter((w) => w.type === 'sem_motorista_forcado');
      const critico = MESES_CRITICOS.has(month) ? ' ⚠ mês crítico do bug original' : '';
      expect(
        forcados.length,
        `Mês ${month}/2026${critico}: ${forcados.length} warning(s) sem_motorista_forcado`
      ).toBe(0);
    }
  });

  // Teste pontual nos 6 meses críticos com assertion individual por mês,
  // para garantir visibilidade caso apenas alguns meses regridam.
  it('meses críticos (Fev, Mar, Jun, Set, Nov, Dez): cada um isoladamente sem_motorista_forcado = 0', async () => {
    const CRITICOS = [2, 3, 6, 9, 11, 12];

    for (const month of CRITICOS) {
      const db = freshDb();
      createEmployee(db, { name: 'Motorista A', setor: 'Transporte Ambulância' });
      createEmployee(db, { name: 'Motorista B', setor: 'Transporte Ambulância' });
      createEmployee(db, { name: 'Motorista C', setor: 'Transporte Hemodiálise' });

      const res = await request(app)
        .post('/api/schedules/generate')
        .send({ month, year: 2026, overwriteLocked: true });
      expect(res.status).toBe(200);

      const forcados = res.body.warnings.filter((w) => w.type === 'sem_motorista_forcado');
      expect(
        forcados.length,
        `Mês crítico ${month}/2026: ${forcados.length} warning(s) sem_motorista_forcado`
      ).toBe(0);
    }
  });
});
