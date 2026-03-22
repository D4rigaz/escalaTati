import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import app from '../app.js';
import { freshDb, createEmployee, shiftId } from './helpers.js';

beforeEach(() => freshDb());

// ─── Validação ────────────────────────────────────────────────────────────────

describe('GET /api/export/excel — validação', () => {
  it('retorna 400 sem month e year', async () => {
    const res = await request(app).get('/api/export/excel');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('retorna 400 sem month', async () => {
    const res = await request(app).get('/api/export/excel?year=2025');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('retorna 400 sem year', async () => {
    const res = await request(app).get('/api/export/excel?month=1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe('GET /api/export/pdf — validação', () => {
  it('retorna 400 sem month e year', async () => {
    const res = await request(app).get('/api/export/pdf');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('retorna 400 sem month', async () => {
    const res = await request(app).get('/api/export/pdf?year=2025');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('retorna 400 sem year', async () => {
    const res = await request(app).get('/api/export/pdf?month=1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

// ─── Excel ────────────────────────────────────────────────────────────────────

describe('GET /api/export/excel', () => {
  it('retorna 200 e Content-Type xlsx com banco vazio', async () => {
    const res = await request(app).get('/api/export/excel?month=1&year=2025');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
  });

  it('Content-Disposition contém filename com mês zero-padded', async () => {
    const res = await request(app).get('/api/export/excel?month=3&year=2025');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('escala_2025_03.xlsx');
  });

  it('Content-Disposition usa zero-pad para mês < 10', async () => {
    const res = await request(app).get('/api/export/excel?month=9&year=2024');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('escala_2024_09.xlsx');
  });

  it('retorna 200 com funcionário sem entradas (todos folga)', async () => {
    createEmployee(freshDb(), { name: 'Ana', setores: ['Transporte Ambulância'] });

    const res = await request(app).get('/api/export/excel?month=1&year=2025');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
  });

  it('retorna 200 com entrada de plantão noturno', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Bruno', setores: ['Transporte Ambulância'] });
    const nId = shiftId(db, 'Noturno');
    db.prepare(
      'INSERT INTO schedule_entries (employee_id, date, shift_type_id, is_day_off) VALUES (?, ?, ?, 0)'
    ).run(emp.id, '2025-01-15', nId);

    const res = await request(app).get('/api/export/excel?month=1&year=2025');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
  });

  it('retorna 200 com entrada de plantão diurno', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Carlos', setores: ['Transporte Hemodiálise'] });
    const dId = shiftId(db, 'Diurno');
    db.prepare(
      'INSERT INTO schedule_entries (employee_id, date, shift_type_id, is_day_off) VALUES (?, ?, ?, 0)'
    ).run(emp.id, '2025-01-10', dId);

    const res = await request(app).get('/api/export/excel?month=1&year=2025');
    expect(res.status).toBe(200);
  });

  it('retorna 200 com múltiplos funcionários e shift_type_id null (entrada sem turno)', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Diana' });
    db.prepare(
      'INSERT INTO schedule_entries (employee_id, date, shift_type_id, is_day_off) VALUES (?, ?, NULL, 0)'
    ).run(emp.id, '2025-01-05');

    const res = await request(app).get('/api/export/excel?month=1&year=2025');
    expect(res.status).toBe(200);
  });

  it('retorna 200 com cor de funcionário customizada (stripe no Excel)', async () => {
    const db = freshDb();
    db.prepare("UPDATE employees SET color = '#FF5733' WHERE id = ?").run(
      createEmployee(db, { name: 'Eduardo' }).id
    );

    const res = await request(app).get('/api/export/excel?month=1&year=2025');
    expect(res.status).toBe(200);
  });

  // ── Feature #122 — cabeçalho com dia da semana ──────────────────────────────

  async function loadExcel(month, year) {
    const res = await request(app)
      .get(`/api/export/excel?month=${month}&year=${year}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);
    return workbook;
  }

  it('cabeçalho Excel col 3 = "Qua\\n01" (Jan/2025 dia 1 é Quarta-feira)', async () => {
    // Jan 1, 2025 = Quarta-feira (dow=3 → DOW_ABBR[3]='Qua'), número do dia = '01'
    const workbook = await loadExcel(1, 2025);
    const row1 = workbook.worksheets[0].getRow(1);
    expect(row1.getCell(1).value).toBe('Funcionário');
    expect(row1.getCell(2).value).toBe('Total (h)');
    expect(row1.getCell(3).value).toBe('Qua\n01');
  });

  it('cabeçalho Excel col 33 = "Sex\\n31" (Jan/2025 dia 31 é Sexta-feira)', async () => {
    // Jan 31, 2025 = Sexta-feira (dow=5 → DOW_ABBR[5]='Sex'), número = '31'
    const workbook = await loadExcel(1, 2025);
    // col 1=Funcionário, col 2=Total (h), col 3=dia 1 … col 33=dia 31
    expect(workbook.worksheets[0].getRow(1).getCell(33).value).toBe('Sex\n31');
  });

  it('cabeçalho Excel — wrapText habilitado nas colunas de dias', async () => {
    const workbook = await loadExcel(1, 2025);
    // Verificar wrapText em col 3 (primeiro dia)
    expect(workbook.worksheets[0].getRow(1).getCell(3).alignment?.wrapText).toBe(true);
  });

  it('cabeçalho Excel — altura da linha de cabeçalho é 30', async () => {
    const workbook = await loadExcel(1, 2025);
    expect(workbook.worksheets[0].getRow(1).height).toBe(30);
  });

  it('cabeçalho Excel — Dom Jun 1, 2025 aparece como "Dom\\n01"', async () => {
    // Jun 1, 2025 = Domingo (dow=0 → DOW_ABBR[0]='Dom')
    const workbook = await loadExcel(6, 2025);
    expect(workbook.worksheets[0].getRow(1).getCell(3).value).toBe('Dom\n01');
  });

  it('total de horas dentro do alvo — sem afetar o status da resposta', async () => {
    // Verifica que funcionário com totalHours próximo de 160h (isOk=true)
    // e com totalHours distante (isOk=false) não causam erro na geração.
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Fábio' });
    const nId = shiftId(db, 'Noturno'); // 12h cada
    // 14 plantões = 168h (distante de 160 → isOk=false, fonte vermelha)
    for (let d = 1; d <= 14; d++) {
      const date = `2025-01-${String(d).padStart(2, '0')}`;
      db.prepare(
        'INSERT INTO schedule_entries (employee_id, date, shift_type_id, is_day_off) VALUES (?, ?, ?, 0)'
      ).run(emp.id, date, nId);
    }

    const res = await request(app).get('/api/export/excel?month=1&year=2025');
    expect(res.status).toBe(200);
  });
});

// ─── PDF ──────────────────────────────────────────────────────────────────────

describe('GET /api/export/pdf', () => {
  it('retorna 200 e Content-Type application/pdf com banco vazio', async () => {
    const res = await request(app).get('/api/export/pdf?month=1&year=2025');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  it('Content-Disposition contém filename com mês zero-padded', async () => {
    const res = await request(app).get('/api/export/pdf?month=6&year=2025');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('escala_2025_06.pdf');
  });

  it('Content-Disposition usa zero-pad para mês < 10', async () => {
    const res = await request(app).get('/api/export/pdf?month=2&year=2026');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('escala_2026_02.pdf');
  });

  it('retorna 200 com funcionário sem entradas', async () => {
    createEmployee(freshDb(), { name: 'Gisele', setores: ['Transporte Ambulância'] });

    const res = await request(app).get('/api/export/pdf?month=1&year=2025');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  it('retorna 200 com entrada de plantão e cor de turno (hexToRgb exercitado)', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Hugo', setores: ['Transporte Hemodiálise'] });
    const dId = shiftId(db, 'Diurno');
    db.prepare(
      'INSERT INTO schedule_entries (employee_id, date, shift_type_id, is_day_off) VALUES (?, ?, ?, 0)'
    ).run(emp.id, '2025-01-20', dId);

    const res = await request(app).get('/api/export/pdf?month=1&year=2025');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  it('retorna 200 com shift_type_id null (hexToRgb não é chamado — fallback vazio)', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Iara' });
    db.prepare(
      'INSERT INTO schedule_entries (employee_id, date, shift_type_id, is_day_off) VALUES (?, ?, NULL, 0)'
    ).run(emp.id, '2025-01-07');

    const res = await request(app).get('/api/export/pdf?month=1&year=2025');
    expect(res.status).toBe(200);
  });

  it('retorna 200 com múltiplos funcionários e entradas mistas', async () => {
    const db = freshDb();
    const emp1 = createEmployee(db, { name: 'João', setores: ['Transporte Ambulância'] });
    const emp2 = createEmployee(db, { name: 'Karla', setores: ['Transporte Hemodiálise'] });
    const nId = shiftId(db, 'Noturno');
    const dId = shiftId(db, 'Diurno');

    db.prepare(
      'INSERT INTO schedule_entries (employee_id, date, shift_type_id, is_day_off) VALUES (?, ?, ?, 0)'
    ).run(emp1.id, '2025-01-10', nId);
    db.prepare(
      'INSERT INTO schedule_entries (employee_id, date, shift_type_id, is_day_off) VALUES (?, ?, ?, 1)'
    ).run(emp2.id, '2025-01-10', null);

    const res = await request(app).get('/api/export/pdf?month=1&year=2025');
    expect(res.status).toBe(200);
  });

  it('total de horas fora do alvo (isOk=false) não causa erro na geração', async () => {
    const db = freshDb();
    const emp = createEmployee(db, { name: 'Lara' });
    const nId = shiftId(db, 'Noturno');
    for (let d = 1; d <= 14; d++) {
      const date = `2025-01-${String(d).padStart(2, '0')}`;
      db.prepare(
        'INSERT INTO schedule_entries (employee_id, date, shift_type_id, is_day_off) VALUES (?, ?, ?, 0)'
      ).run(emp.id, date, nId);
    }

    const res = await request(app).get('/api/export/pdf?month=1&year=2025');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });
});
