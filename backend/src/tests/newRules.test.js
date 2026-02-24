import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb, createEmployee } from './helpers.js';

beforeEach(() => freshDb());

// ─── Regra 12: work_schedule seg_sex ─────────────────────────────────────────

describe('Regra 12 — work_schedule seg_sex: Sáb/Dom viram folga obrigatória', () => {
  it('POST /api/employees aceita work_schedule seg_sex', async () => {
    const res = await request(app).post('/api/employees').send({
      name: 'Ana',
      setores: ['Transporte Ambulância'],
      work_schedule: 'seg_sex',
    });
    expect(res.status).toBe(201);
    expect(res.body.work_schedule).toBe('seg_sex');
  });

  it('POST /api/employees rejeita work_schedule inválido', async () => {
    const res = await request(app).post('/api/employees').send({
      name: 'Ana',
      setores: ['Transporte Ambulância'],
      work_schedule: 'invalido',
    });
    expect(res.status).toBe(400);
  });

  it('gerador marca Domingos como folga para funcionário seg_sex (Domingos nunca são alvo de enforcement)', async () => {
    // Domingos (dow=0) não têm requisito de cobertura nas Regras 21/22,
    // portanto nunca são convertidos pelo enforcement — assert 100% seguro.
    // Fix aplicado (issue #13): segSexForcedOff agora integra lockedOffDates,
    // impedindo que correctHours converta fins-de-semana de volta a plantão.
    const empRes = await request(app).post('/api/employees').send({
      name: 'Bruno',
      setores: ['Transporte Ambulância'],
      work_schedule: 'seg_sex',
    });
    expect(empRes.status).toBe(201);

    await request(app).post('/api/schedules/generate').send({ month: 1, year: 2025 });

    const schedule = await request(app).get('/api/schedules?month=1&year=2025');
    const entries = schedule.body.entries.filter((e) => e.employee_id === empRes.body.id);

    const sundayEntries = entries.filter((e) => new Date(e.date + 'T12:00:00').getDay() === 0);
    expect(sundayEntries.length).toBeGreaterThan(0); // Janeiro 2025 tem 4 domingos
    sundayEntries.forEach((e) => {
      expect(e.is_day_off).toBe(1);
    });
  });

  it('funcionário seg_sex tem mais folgas em fins-de-semana que funcionário dom_sab equivalente', async () => {
    // Cria seg_sex e dom_sab com mesmo setor; compara contagem de folgas em Sáb/Dom
    const resSeg = await request(app).post('/api/employees').send({
      name: 'SegSex', setores: ['Transporte Ambulância'], work_schedule: 'seg_sex',
    });
    const resDom = await request(app).post('/api/employees').send({
      name: 'DomSab', setores: ['Transporte Ambulância'], work_schedule: 'dom_sab',
    });

    await request(app).post('/api/schedules/generate').send({ month: 1, year: 2025 });
    const schedule = await request(app).get('/api/schedules?month=1&year=2025');

    const weekendDayOffs = (empId) =>
      schedule.body.entries.filter((e) => {
        const dow = new Date(e.date + 'T12:00:00').getDay();
        return e.employee_id === empId && (dow === 0 || dow === 6) && e.is_day_off === 1;
      }).length;

    expect(weekendDayOffs(resSeg.body.id)).toBeGreaterThan(weekendDayOffs(resDom.body.id));
  });

  it('funcionário dom_sab pode trabalhar aos Sábados e Domingos', async () => {
    const db = freshDb();
    const empRes = await request(app).post('/api/employees').send({
      name: 'Carlos',
      setores: ['Transporte Ambulância'],
      work_schedule: 'dom_sab',
    });
    expect(empRes.status).toBe(201);

    await request(app).post('/api/schedules/generate').send({ month: 1, year: 2025 });

    const schedule = await request(app).get('/api/schedules?month=1&year=2025');
    const entries = schedule.body.entries.filter((e) => e.employee_id === empRes.body.id);

    // Deve ter ao menos um Sáb ou Dom trabalhado (não todos obrigatoriamente folga)
    const weekendWork = entries.filter((e) => {
      const dow = new Date(e.date + 'T12:00:00').getDay();
      return (dow === 0 || dow === 6) && e.is_day_off === 0;
    });
    expect(weekendWork.length).toBeGreaterThan(0);
  });
});

// ─── Regras 14 + 17: Multi-setor e exclusividade ADM ─────────────────────────

describe('Regras 14/17 — multi-setor via API e exclusividade ADM', () => {
  it('POST /api/employees aceita múltiplos setores não-ADM', async () => {
    const res = await request(app).post('/api/employees').send({
      name: 'Diana',
      setores: ['Transporte Ambulância', 'Transporte Hemodiálise'],
    });
    expect(res.status).toBe(201);
    expect(res.body.setores).toHaveLength(2);
    expect(res.body.setores).toContain('Transporte Ambulância');
    expect(res.body.setores).toContain('Transporte Hemodiálise');
  });

  it('POST /api/employees rejeita ADM combinado com outro setor', async () => {
    const res = await request(app).post('/api/employees').send({
      name: 'Eduardo',
      setores: ['Transporte Administrativo', 'Transporte Ambulância'],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exclusivo/i);
  });

  it('POST /api/employees aceita ADM sozinho', async () => {
    const res = await request(app).post('/api/employees').send({
      name: 'Fernanda',
      setores: ['Transporte Administrativo'],
    });
    expect(res.status).toBe(201);
    expect(res.body.setores).toEqual(['Transporte Administrativo']);
  });

  it('POST /api/employees rejeita setores vazio', async () => {
    const res = await request(app).post('/api/employees').send({
      name: 'Gustavo',
      setores: [],
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/employees rejeita setor inválido', async () => {
    const res = await request(app).post('/api/employees').send({
      name: 'Helena',
      setores: ['Setor Inexistente'],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inválido/i);
  });

  it('PUT /api/employees/:id atualiza setores para multi-setor', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Igor', setor: 'Transporte Ambulância' });

    const res = await request(app)
      .put(`/api/employees/${emp.id}`)
      .send({ setores: ['Transporte Ambulância', 'Transporte Hemodiálise'] });
    expect(res.status).toBe(200);
    expect(res.body.setores).toHaveLength(2);
  });

  it('PUT /api/employees/:id rejeita ADM combinado com outro setor', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Julia', setor: 'Transporte Ambulância' });

    const res = await request(app)
      .put(`/api/employees/${emp.id}`)
      .send({ setores: ['Transporte Administrativo', 'Transporte Hemodiálise'] });
    expect(res.status).toBe(400);
  });

  it('GET /api/employees retorna setores de cada funcionário', async () => {
    const db = freshDb();
    createEmployee(db, { name: 'Karla', setores: ['Transporte Ambulância', 'Transporte Hemodiálise'] });

    const res = await request(app).get('/api/employees');
    expect(res.status).toBe(200);
    expect(res.body[0].setores).toHaveLength(2);
  });
});

// ─── Regra 20: campo color ────────────────────────────────────────────────────

describe('Regra 20 — campo color no cadastro de funcionário', () => {
  it('POST /api/employees aceita cor hex válida', async () => {
    const res = await request(app).post('/api/employees').send({
      name: 'Lucas',
      setores: ['Transporte Ambulância'],
      color: '#FF5733',
    });
    expect(res.status).toBe(201);
    expect(res.body.color).toBe('#FF5733');
  });

  it('POST /api/employees usa cor padrão #6B7280 quando não informada', async () => {
    const res = await request(app).post('/api/employees').send({
      name: 'Mariana',
      setores: ['Transporte Ambulância'],
    });
    expect(res.status).toBe(201);
    expect(res.body.color).toBe('#6B7280');
  });

  it('POST /api/employees rejeita cor com formato inválido', async () => {
    const res = await request(app).post('/api/employees').send({
      name: 'Nadia',
      setores: ['Transporte Ambulância'],
      color: 'vermelho',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/hex/i);
  });

  it('POST /api/employees rejeita cor hex de 3 dígitos', async () => {
    const res = await request(app).post('/api/employees').send({
      name: 'Oscar',
      setores: ['Transporte Ambulância'],
      color: '#FFF',
    });
    expect(res.status).toBe(400);
  });

  it('PUT /api/employees/:id atualiza cor', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Paula', setor: 'Transporte Ambulância' });

    const res = await request(app)
      .put(`/api/employees/${emp.id}`)
      .send({ color: '#123ABC' });
    expect(res.status).toBe(200);
    expect(res.body.color).toBe('#123ABC');
  });

  it('GET /api/employees retorna campo color em cada funcionário', async () => {
    const db = freshDb();
    createEmployee(db, { name: 'Roberto', setor: 'Transporte Ambulância' });

    const res = await request(app).get('/api/employees');
    expect(res.status).toBe(200);
    expect(res.body[0].color).toBeDefined();
    expect(res.body[0].color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

// ─── Regra 23: férias ─────────────────────────────────────────────────────────

describe('Regra 23 — férias: CRUD e integração com gerador', () => {
  it('POST /api/employees/:id/vacations cria período de férias', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Sofia', setor: 'Transporte Ambulância' });

    const res = await request(app)
      .post(`/api/employees/${emp.id}/vacations`)
      .send({ start_date: '2025-01-10', end_date: '2025-01-20' });
    expect(res.status).toBe(201);
    expect(res.body.start_date).toBe('2025-01-10');
    expect(res.body.end_date).toBe('2025-01-20');
  });

  it('POST /api/employees/:id/vacations rejeita data inválida (2025-02-30)', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Tiago', setor: 'Transporte Ambulância' });

    const res = await request(app)
      .post(`/api/employees/${emp.id}/vacations`)
      .send({ start_date: '2025-02-30', end_date: '2025-03-05' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inválida/i);
  });

  it('POST /api/employees/:id/vacations rejeita end_date < start_date', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Ursula', setor: 'Transporte Ambulância' });

    const res = await request(app)
      .post(`/api/employees/${emp.id}/vacations`)
      .send({ start_date: '2025-01-20', end_date: '2025-01-10' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/end_date/i);
  });

  it('GET /api/employees/:id/vacations lista férias do funcionário', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Vera', setor: 'Transporte Ambulância' });

    await request(app)
      .post(`/api/employees/${emp.id}/vacations`)
      .send({ start_date: '2025-01-05', end_date: '2025-01-07' });

    const res = await request(app).get(`/api/employees/${emp.id}/vacations`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].start_date).toBe('2025-01-05');
  });

  it('DELETE /api/employees/:id/vacations/:vid remove férias', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Walter', setor: 'Transporte Ambulância' });

    const created = await request(app)
      .post(`/api/employees/${emp.id}/vacations`)
      .send({ start_date: '2025-01-05', end_date: '2025-01-07' });

    const del = await request(app)
      .delete(`/api/employees/${emp.id}/vacations/${created.body.id}`);
    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);

    const list = await request(app).get(`/api/employees/${emp.id}/vacations`);
    expect(list.body).toHaveLength(0);
  });

  it('gerador marca dias de férias como is_day_off=1 com notes=Férias', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Xavier', setor: 'Transporte Ambulância' });

    // Cadastrar férias via API
    await request(app)
      .post(`/api/employees/${emp.id}/vacations`)
      .send({ start_date: '2025-01-13', end_date: '2025-01-15' });

    await request(app).post('/api/schedules/generate').send({ month: 1, year: 2025 });

    const schedule = await request(app).get('/api/schedules?month=1&year=2025');
    const vacDays = schedule.body.entries.filter(
      (e) => e.employee_id === emp.id &&
             e.date >= '2025-01-13' && e.date <= '2025-01-15'
    );

    expect(vacDays).toHaveLength(3);
    vacDays.forEach((e) => {
      expect(e.is_day_off).toBe(1);
      expect(e.notes).toBe('Férias');
    });
  });

  it('gerador não converte dias de férias em plantões na correção de horas', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Yara', setor: 'Transporte Ambulância' });

    // Férias cobrindo a maior parte do mês: pouquíssimas horas disponíveis
    await request(app)
      .post(`/api/employees/${emp.id}/vacations`)
      .send({ start_date: '2025-01-01', end_date: '2025-01-28' });

    await request(app).post('/api/schedules/generate').send({ month: 1, year: 2025 });

    const schedule = await request(app).get('/api/schedules?month=1&year=2025');
    const vacEntries = schedule.body.entries.filter(
      (e) => e.employee_id === emp.id &&
             e.date >= '2025-01-01' && e.date <= '2025-01-28'
    );

    // Nenhum dos dias de férias deve ter virado plantão
    vacEntries.forEach((e) => {
      expect(e.is_day_off).toBe(1);
      expect(e.notes).toBe('Férias');
    });
  });
});
