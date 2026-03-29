/**
 * test: crew minimum validation — issue #110
 *
 * Desenvolvedor Pleno
 *
 * Verifica que generateSchedule retorna crew_warnings quando o elenco ativo
 * está abaixo da configuração mínima recomendada (4 Hemo + 4 Amb Noturno).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb } from './helpers.js';

beforeEach(async () => { await freshDb(); });

const SHIFT_NOTURNO_ID = 2;
const SHIFT_DIURNO_ID  = 1;

async function createWorker(name, setor, preferredShiftId = null) {
  const body = {
    name,
    setores: [setor],
    cycle_start_month: 1,
    cycle_start_year: 2026,
    work_schedule: 'dom_sab',
  };
  if (preferredShiftId !== null) body.restRules = { preferred_shift_id: preferredShiftId };
  const res = await request(app).post('/api/employees').send(body);
  expect(res.status, `createWorker ${name}`).toBe(201);
  return res.body.id;
}

async function generate() {
  const res = await request(app)
    .post('/api/schedules/generate')
    .send({ month: 4, year: 2026, overwriteLocked: true });
  expect(res.status, 'generate').toBe(200);
  return res.body;
}

describe('crew_warnings — configuração mínima de crew', () => {
  it('retorna crew_warnings vazio quando elenco atende ao mínimo (4 Hemo + 4 Amb Noturno)', async () => {
    for (let i = 1; i <= 4; i++) {
      await createWorker(`Hemo ${i}`, 'Transporte Hemodiálise', SHIFT_DIURNO_ID);
    }
    for (let i = 1; i <= 4; i++) {
      await createWorker(`Amb ${i}`, 'Transporte Ambulância', SHIFT_NOTURNO_ID);
    }

    const result = await generate();
    expect(result.crew_warnings).toBeDefined();
    expect(result.crew_warnings).toHaveLength(0);
  });

  it('emite crew_hemo_insuficiente quando há menos de 4 workers Hemo', async () => {
    await createWorker('Hemo 1', 'Transporte Hemodiálise', SHIFT_DIURNO_ID);
    await createWorker('Hemo 2', 'Transporte Hemodiálise', SHIFT_DIURNO_ID);
    for (let i = 1; i <= 4; i++) {
      await createWorker(`Amb ${i}`, 'Transporte Ambulância', SHIFT_NOTURNO_ID);
    }

    const result = await generate();
    const hemoWarn = result.crew_warnings.find(w => w.type === 'crew_hemo_insuficiente');
    expect(hemoWarn).toBeDefined();
    expect(hemoWarn.message).toContain('2/4');
  });

  it('emite crew_amb_noturno_insuficiente quando há menos de 4 Amb com turno Noturno', async () => {
    for (let i = 1; i <= 4; i++) {
      await createWorker(`Hemo ${i}`, 'Transporte Hemodiálise', SHIFT_DIURNO_ID);
    }
    await createWorker('Amb 1', 'Transporte Ambulância', SHIFT_NOTURNO_ID);
    await createWorker('Amb 2', 'Transporte Ambulância', SHIFT_NOTURNO_ID);
    // Amb 3 e 4 sem preferred shift (não conta para o mínimo noturno)
    await createWorker('Amb 3', 'Transporte Ambulância');
    await createWorker('Amb 4', 'Transporte Ambulância');

    const result = await generate();
    const ambWarn = result.crew_warnings.find(w => w.type === 'crew_amb_noturno_insuficiente');
    expect(ambWarn).toBeDefined();
    expect(ambWarn.message).toContain('2/4');
  });

  it('emite todos os warnings quando elenco está completamente abaixo do mínimo', async () => {
    await createWorker('Hemo 1', 'Transporte Hemodiálise', SHIFT_DIURNO_ID);
    await createWorker('Amb 1', 'Transporte Ambulância', SHIFT_NOTURNO_ID);

    const result = await generate();
    const types = result.crew_warnings.map(w => w.type);
    expect(types).toContain('crew_hemo_insuficiente');
    expect(types).toContain('crew_amb_noturno_insuficiente');
    expect(types).toContain('crew_dom_sab_insuficiente');
  });

  it('crew_warnings nao bloqueia a geracao — success=true mesmo com warnings', async () => {
    // Elenco mínimo (1 de cada)
    await createWorker('Hemo 1', 'Transporte Hemodiálise', SHIFT_DIURNO_ID);
    await createWorker('Amb 1', 'Transporte Ambulância', SHIFT_NOTURNO_ID);

    const result = await generate();
    expect(result.success).toBe(true);
    expect(result.crew_warnings.length).toBeGreaterThan(0);
  });
});

describe('crew_warnings — cobertura diária geral (dom_sab)', () => {
  it('nao emite crew_dom_sab_insuficiente quando há 4 ou mais workers dom_sab', async () => {
    for (let i = 1; i <= 4; i++) {
      await createWorker(`Hemo ${i}`, 'Transporte Hemodiálise', SHIFT_DIURNO_ID);
    }

    const result = await generate();
    const types = result.crew_warnings.map(w => w.type);
    expect(types).not.toContain('crew_dom_sab_insuficiente');
  });

  it('emite crew_dom_sab_insuficiente quando há menos de 4 workers dom_sab', async () => {
    await createWorker('Hemo 1', 'Transporte Hemodiálise', SHIFT_DIURNO_ID);
    await createWorker('Hemo 2', 'Transporte Hemodiálise', SHIFT_DIURNO_ID);

    const result = await generate();
    const warn = result.crew_warnings.find(w => w.type === 'crew_dom_sab_insuficiente');
    expect(warn).toBeDefined();
    expect(warn.message).toContain('2/4');
  });

  it('workers seg_sex nao contam para o minimo dom_sab', async () => {
    // 3 dom_sab + 2 seg_sex = total 5 ativos, mas dom_sab=3 < 4
    for (let i = 1; i <= 3; i++) {
      await createWorker(`Hemo ${i}`, 'Transporte Hemodiálise', SHIFT_DIURNO_ID);
    }
    const body = {
      name: 'Adm 1',
      setores: ['Transporte Administrativo'],
      cycle_start_month: 1,
      cycle_start_year: 2026,
      work_schedule: 'seg_sex',
    };
    await request(app).post('/api/employees').send(body).expect(201);
    await request(app).post('/api/employees').send({ ...body, name: 'Adm 2' }).expect(201);

    const result = await generate();
    const warn = result.crew_warnings.find(w => w.type === 'crew_dom_sab_insuficiente');
    expect(warn).toBeDefined();
    expect(warn.message).toContain('3/4');
  });

  it('nao emite crew_dom_sab_insuficiente com exatamente 4 workers dom_sab e alguns seg_sex', async () => {
    for (let i = 1; i <= 4; i++) {
      await createWorker(`Hemo ${i}`, 'Transporte Hemodiálise', SHIFT_DIURNO_ID);
    }
    const body = {
      name: 'Adm 1',
      setores: ['Transporte Administrativo'],
      cycle_start_month: 1,
      cycle_start_year: 2026,
      work_schedule: 'seg_sex',
    };
    await request(app).post('/api/employees').send(body).expect(201);

    const result = await generate();
    const types = result.crew_warnings.map(w => w.type);
    expect(types).not.toContain('crew_dom_sab_insuficiente');
  });
});
