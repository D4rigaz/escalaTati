import { describe, it, expect, beforeEach } from 'vitest';
import { isValidEmendado, correctHours, enforceDailyCoverage, getWeekType } from '../services/scheduleGenerator.js';
import { freshDb, createEmployee } from './helpers.js';

describe('isValidEmendado', () => {
  it('permite Tarde → Noturno', () => expect(isValidEmendado('Tarde', 'Noturno')).toBe(true));
  it('permite Noturno → Manhã', () => expect(isValidEmendado('Noturno', 'Manhã')).toBe(true));
  it('permite Manhã → Tarde (emendado diurno, regra 11)', () => expect(isValidEmendado('Manhã', 'Tarde')).toBe(true));
  it('bloqueia Noturno → Noturno', () => expect(isValidEmendado('Noturno', 'Noturno')).toBe(false));
  it('bloqueia Tarde → Manhã', () => expect(isValidEmendado('Tarde', 'Manhã')).toBe(false));
  it('retorna false para valores nulos', () => expect(isValidEmendado(null, 'Noturno')).toBe(false));
});

describe('correctHours', () => {
  // helpers locais
  const shiftTypes = [
    { id: 1, name: 'Noturno', duration_hours: 12 },
    { id: 2, name: 'Manhã',   duration_hours: 6  },
  ];
  const shiftMap = { 1: shiftTypes[0], 2: shiftTypes[1] };

  function makeEntries(workCount, offCount) {
    const entries = [];
    for (let i = 0; i < workCount; i++)
      entries.push({ employee_id: 1, shift_type_id: 1, date: `2025-01-${String(i+1).padStart(2,'0')}`, is_day_off: 0, is_locked: 0 });
    for (let i = 0; i < offCount; i++)
      entries.push({ employee_id: 1, shift_type_id: null, date: `2025-01-${String(workCount+i+1).padStart(2,'0')}`, is_day_off: 1, is_locked: 0 });
    return entries;
  }

  it('não modifica se desvio <= 6h', () => {
    const entries = makeEntries(13, 5); // 156h — desvio 4h
    const result = correctHours(entries, shiftTypes, shiftMap, 156, 160);
    expect(result.filter(e => !e.is_day_off).length).toBe(13);
  });

  it('converte trabalho em folga quando está acima do alvo por >6h', () => {
    const entries = makeEntries(16, 2); // 192h — desvio +32h
    const result = correctHours(entries, shiftTypes, shiftMap, 192, 160);
    const hours = result.filter(e => !e.is_day_off).length * 12;
    expect(Math.abs(hours - 160)).toBeLessThanOrEqual(18);
  });

  it('converte folga em trabalho quando está abaixo do alvo por >6h', () => {
    const entries = makeEntries(10, 8); // 120h — desvio -40h
    const result = correctHours(entries, shiftTypes, shiftMap, 120, 160);
    const hours = result.filter(e => !e.is_day_off).length * 12;
    expect(hours).toBeGreaterThan(120);
  });

  it('não converte folga que viola 24h de descanso após turno noturno', () => {
    const nocturno = { id: 1, name: 'Noturno', duration_hours: 12, start_time: '19:00' };
    const localShiftTypes = [nocturno];
    const localShiftMap   = { 1: nocturno };

    // Sex Noturno (19:00 → Sáb 07:00); Sáb folga = apenas 12h rest → deve ser ignorada
    // Seg e Ter folgas (>24h de descanso) → devem ser convertidas para cobrir o déficit
    const entries = [
      { date: '2025-01-06', is_day_off: 0, shift_type_id: 1 }, // Seg
      { date: '2025-01-07', is_day_off: 0, shift_type_id: 1 }, // Ter
      { date: '2025-01-08', is_day_off: 0, shift_type_id: 1 }, // Qua
      { date: '2025-01-09', is_day_off: 0, shift_type_id: 1 }, // Qui
      { date: '2025-01-10', is_day_off: 0, shift_type_id: 1 }, // Sex (termina Sáb 07:00)
      { date: '2025-01-11', is_day_off: 1, shift_type_id: null }, // Sáb (12h rest → ignorar)
      { date: '2025-01-13', is_day_off: 1, shift_type_id: null }, // Seg folga boa
      { date: '2025-01-14', is_day_off: 1, shift_type_id: null }, // Ter folga boa
    ];
    // currentHours = 5*12 = 60, target = 84 → deficit = 24h (precisa converter 2 folgas)

    correctHours(entries, localShiftTypes, localShiftMap, 60, 84, nocturno);

    const sab = entries.find(e => e.date === '2025-01-11');
    expect(sab.is_day_off).toBe(1); // NÃO convertida — violaria 24h rest

    const converted = entries.filter(e => !e.is_day_off);
    expect(converted.length).toBeGreaterThan(5); // folgas boas foram convertidas
  });

  it('não converte folga que criaria mais de 6 dias consecutivos de trabalho', () => {
    // Turno sem start_time — wouldExceedConsecutive opera por data de calendário (independe de start_time)
    const turno = { id: 1, name: 'Noturno', duration_hours: 12 };
    const localShiftTypes = [turno];
    const localShiftMap   = { 1: turno };

    // 6 dias consecutivos de trabalho (Jan 1–6), folga no Jan 7, trabalho Jan 8
    // Converter Jan 7 criaria 8 consecutivos (Jan 1–8) → deve ser ignorada
    // Jan 9 e Jan 10 são folgas sem adjacência que exceda o limite → podem ser convertidas
    const entries = [
      { date: '2025-01-01', is_day_off: 0, shift_type_id: 1 },
      { date: '2025-01-02', is_day_off: 0, shift_type_id: 1 },
      { date: '2025-01-03', is_day_off: 0, shift_type_id: 1 },
      { date: '2025-01-04', is_day_off: 0, shift_type_id: 1 },
      { date: '2025-01-05', is_day_off: 0, shift_type_id: 1 },
      { date: '2025-01-06', is_day_off: 0, shift_type_id: 1 }, // 6º consecutivo
      { date: '2025-01-07', is_day_off: 1, shift_type_id: null }, // folga — converter criaria 8 consec.
      { date: '2025-01-08', is_day_off: 0, shift_type_id: 1 },
      { date: '2025-01-09', is_day_off: 1, shift_type_id: null }, // folga boa (antes: 1 consec., depois: 0)
      { date: '2025-01-10', is_day_off: 1, shift_type_id: null }, // folga boa
    ];
    // currentHours = 7*12 = 84, target = 120 → deficit = 36h (até 3 folgas)

    correctHours(entries, localShiftTypes, localShiftMap, 84, 120, turno);

    const jan7 = entries.find(e => e.date === '2025-01-07');
    expect(jan7.is_day_off).toBe(1); // NÃO convertida — criaria 8 consecutivos

    const workDays = entries.filter(e => !e.is_day_off);
    expect(workDays.length).toBeGreaterThan(7); // folgas boas convertidas
  });
});

// ─── enforceDailyCoverage ─────────────────────────────────────────────────────

describe('enforceDailyCoverage', () => {
  let db;

  beforeEach(() => { db = freshDb(); });

  // Helper: insere entrada de escala diretamente no DB
  function insertEntry(db, { employee_id, date, is_day_off, shift_type_id = null, is_locked = 0, notes = null }) {
    db.prepare(
      'INSERT INTO schedule_entries (employee_id, date, is_day_off, shift_type_id, is_locked, notes) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(employee_id, date, is_day_off, shift_type_id, is_locked, notes);
  }

  // Helper: retorna entry do DB para (employee_id, date)
  function getEntry(db, employee_id, date) {
    return db.prepare('SELECT * FROM schedule_entries WHERE employee_id = ? AND date = ?').get(employee_id, date);
  }

  it('converte 2 folgas em turnos sem warning quando dia não tem motorista (passo 1 ambos)', () => {
    // 2 funcionários com folgas → ambos atribuídos via passo 1 sem forçar → 0 warnings
    const emp1 = createEmployee(db, { name: 'Ana', setor: 'Transporte Ambulância' });
    const emp2 = createEmployee(db, { name: 'Beatriz', setor: 'Transporte Ambulância' });
    insertEntry(db, { employee_id: emp1.id, date: '2025-01-05', is_day_off: 1, shift_type_id: null });
    insertEntry(db, { employee_id: emp2.id, date: '2025-01-05', is_day_off: 1, shift_type_id: null });

    const employees = [
      { ...emp1, setores: ['Transporte Ambulância'] },
      { ...emp2, setores: ['Transporte Ambulância'] },
    ];
    const sectorMap = {
      [emp1.id]: ['Transporte Ambulância'],
      [emp2.id]: ['Transporte Ambulância'],
    };
    const shiftTypes = db.prepare('SELECT * FROM shift_types').all();
    const warnings = [];

    enforceDailyCoverage(db, employees, sectorMap, shiftTypes, ['2025-01-05'], warnings);

    expect(getEntry(db, emp1.id, '2025-01-05').is_day_off).toBe(0);
    expect(getEntry(db, emp2.id, '2025-01-05').is_day_off).toBe(0);
    expect(warnings).toHaveLength(0);
  });

  it('emite warning sem_motorista_forcado quando único candidato viola restrições de descanso', () => {
    // Jan 4 noturno (termina Jan 5 07:00); Jan 5 folga — 12h rest → canAssign rejeita (< 24h)
    // Passo 2 força Bruno; depois não há mais folgas → cobertura_minima_insuficiente
    const noturno = db.prepare("SELECT * FROM shift_types WHERE name = 'Noturno'").get();
    const emp = createEmployee(db, { name: 'Bruno', setor: 'Transporte Ambulância' });

    insertEntry(db, { employee_id: emp.id, date: '2025-01-04', is_day_off: 0, shift_type_id: noturno.id });
    insertEntry(db, { employee_id: emp.id, date: '2025-01-05', is_day_off: 1, shift_type_id: null });

    const employees = [{ ...emp, setores: ['Transporte Ambulância'] }];
    const sectorMap = { [emp.id]: ['Transporte Ambulância'] };
    const shiftTypes = db.prepare('SELECT * FROM shift_types').all();
    const warnings = [];

    enforceDailyCoverage(db, employees, sectorMap, shiftTypes, ['2025-01-05'], warnings);

    // 1º motorista forçado
    expect(warnings.some(w => w.type === 'sem_motorista_forcado')).toBe(true);
    // Sem 2º candidato → cobertura_minima_insuficiente
    expect(warnings.some(w => w.type === 'cobertura_minima_insuficiente')).toBe(true);
    const entry = getEntry(db, emp.id, '2025-01-05');
    expect(entry.is_day_off).toBe(0);
  });

  it('emite warning sem_motorista quando não há nenhuma folga disponível no dia', () => {
    const emp = createEmployee(db, { name: 'Carlos', setor: 'Transporte Ambulância' });
    // Nenhuma entry no DB para Jan 10 — folgas.length = 0
    const employees = [{ ...emp, setores: ['Transporte Ambulância'] }];
    const sectorMap = { [emp.id]: ['Transporte Ambulância'] };
    const shiftTypes = db.prepare('SELECT * FROM shift_types').all();
    const warnings = [];

    enforceDailyCoverage(db, employees, sectorMap, shiftTypes, ['2025-01-10'], warnings);

    expect(warnings.some(w => w.type === 'sem_motorista' && w.date === '2025-01-10')).toBe(true);
  });

  it('força funcionário seg_sex no Domingo via passo 3 (emergência) quando não há dom_sab disponível', () => {
    // Jan 5, 2025 = Domingo; único candidato é seg_sex
    // Passo 1 e 2 ignoram seg_sex em fins de semana; passo 3 força com warning distinto
    const emp = db.prepare("INSERT INTO employees (name, cargo, work_schedule) VALUES ('Diana', 'Motorista', 'seg_sex')").run();
    const empId = emp.lastInsertRowid;
    db.prepare('INSERT INTO employee_sectors (employee_id, setor) VALUES (?, ?)').run(empId, 'Transporte Ambulância');
    db.prepare('INSERT INTO employee_rest_rules (employee_id, min_rest_hours) VALUES (?, 24)').run(empId);
    insertEntry(db, { employee_id: empId, date: '2025-01-05', is_day_off: 1, shift_type_id: null });

    const empObj = db.prepare('SELECT * FROM employees WHERE id = ?').get(empId);
    const employees = [{ ...empObj, setores: ['Transporte Ambulância'] }];
    const sectorMap = { [empId]: ['Transporte Ambulância'] };
    const shiftTypes = db.prepare('SELECT * FROM shift_types').all();
    const warnings = [];

    enforceDailyCoverage(db, employees, sectorMap, shiftTypes, ['2025-01-05'], warnings);

    // Passo 3: 1º motorista forçado mesmo sendo seg_sex
    const entry = getEntry(db, empId, '2025-01-05');
    expect(entry.is_day_off).toBe(0);
    expect(warnings.some(w => w.type === 'sem_motorista_forcado_seg_sex')).toBe(true);
    expect(warnings.some(w => w.type === 'sem_motorista')).toBe(false); // dia foi coberto (parcialmente)
    // Não há 2º candidato → cobertura_minima_insuficiente
    expect(warnings.some(w => w.type === 'cobertura_minima_insuficiente')).toBe(true);
  });

  it('passo 3 não é acionado quando há 2 dom_sab disponíveis no Sábado', () => {
    // Sáb Jan 4, 2025: 1 seg_sex + 2 dom_sab → 2 dom_sab cobrem o dia, seg_sex preservado
    const empSegSex = db.prepare("INSERT INTO employees (name, cargo, work_schedule) VALUES ('Eduardo', 'Motorista', 'seg_sex')").run();
    const empDomSab1 = db.prepare("INSERT INTO employees (name, cargo, work_schedule) VALUES ('Fernanda', 'Motorista', 'dom_sab')").run();
    const empDomSab2 = db.prepare("INSERT INTO employees (name, cargo, work_schedule) VALUES ('Gabriela', 'Motorista', 'dom_sab')").run();
    for (const id of [empSegSex.lastInsertRowid, empDomSab1.lastInsertRowid, empDomSab2.lastInsertRowid]) {
      db.prepare('INSERT INTO employee_sectors (employee_id, setor) VALUES (?, ?)').run(id, 'Transporte Ambulância');
      db.prepare('INSERT INTO employee_rest_rules (employee_id, min_rest_hours) VALUES (?, 24)').run(id);
      insertEntry(db, { employee_id: id, date: '2025-01-04', is_day_off: 1, shift_type_id: null });
    }

    const allEmps = db.prepare('SELECT * FROM employees WHERE active = 1').all()
      .map(e => ({ ...e, setores: ['Transporte Ambulância'] }));
    const sectorMap = Object.fromEntries(allEmps.map(e => [e.id, ['Transporte Ambulância']]));
    const shiftTypes = db.prepare('SELECT * FROM shift_types').all();
    const warnings = [];

    enforceDailyCoverage(db, allEmps, sectorMap, shiftTypes, ['2025-01-04'], warnings);

    // Fernanda e Gabriela (dom_sab) trabalham; Eduardo (seg_sex) preservado
    const entrySegSex  = getEntry(db, empSegSex.lastInsertRowid,  '2025-01-04');
    const entryDomSab1 = getEntry(db, empDomSab1.lastInsertRowid, '2025-01-04');
    const entryDomSab2 = getEntry(db, empDomSab2.lastInsertRowid, '2025-01-04');
    expect(entryDomSab1.is_day_off).toBe(0);
    expect(entryDomSab2.is_day_off).toBe(0);
    expect(entrySegSex.is_day_off).toBe(1); // Eduardo preservado
    expect(warnings.some(w => w.type === 'sem_motorista_forcado_seg_sex')).toBe(false);
    expect(warnings).toHaveLength(0);
  });

  it('não toca dias que já têm MIN_DAILY_COVERAGE (2) motoristas escalados', () => {
    const noturno = db.prepare("SELECT * FROM shift_types WHERE name = 'Noturno'").get();
    const emp1 = createEmployee(db, { name: 'Eva', setor: 'Transporte Ambulância' });
    const emp2 = createEmployee(db, { name: 'Felipe', setor: 'Transporte Ambulância' });
    insertEntry(db, { employee_id: emp1.id, date: '2025-01-15', is_day_off: 0, shift_type_id: noturno.id });
    insertEntry(db, { employee_id: emp2.id, date: '2025-01-15', is_day_off: 0, shift_type_id: noturno.id });

    const employees = [
      { ...emp1, setores: ['Transporte Ambulância'] },
      { ...emp2, setores: ['Transporte Ambulância'] },
    ];
    const sectorMap = {
      [emp1.id]: ['Transporte Ambulância'],
      [emp2.id]: ['Transporte Ambulância'],
    };
    const shiftTypes = db.prepare('SELECT * FROM shift_types').all();
    const warnings = [];

    enforceDailyCoverage(db, employees, sectorMap, shiftTypes, ['2025-01-15'], warnings);

    expect(warnings).toHaveLength(0);
    expect(getEntry(db, emp1.id, '2025-01-15').is_day_off).toBe(0);
    expect(getEntry(db, emp2.id, '2025-01-15').is_day_off).toBe(0);
  });

  it('dia com 1 motorista já escalado e 1 folga disponível → segundo atribuído sem warning', () => {
    // initialCount=1 < MIN_DAILY_COVERAGE=2 → entra no loop e atribui o 2º sem forçar
    const noturno = db.prepare("SELECT * FROM shift_types WHERE name = 'Noturno'").get();
    const emp1 = createEmployee(db, { name: 'Gabi', setor: 'Transporte Ambulância' });
    const emp2 = createEmployee(db, { name: 'Hugo', setor: 'Transporte Ambulância' });
    insertEntry(db, { employee_id: emp1.id, date: '2025-01-06', is_day_off: 0, shift_type_id: noturno.id });
    insertEntry(db, { employee_id: emp2.id, date: '2025-01-06', is_day_off: 1, shift_type_id: null });

    const employees = [
      { ...emp1, setores: ['Transporte Ambulância'] },
      { ...emp2, setores: ['Transporte Ambulância'] },
    ];
    const sectorMap = {
      [emp1.id]: ['Transporte Ambulância'],
      [emp2.id]: ['Transporte Ambulância'],
    };
    const shiftTypes = db.prepare('SELECT * FROM shift_types').all();
    const warnings = [];

    enforceDailyCoverage(db, employees, sectorMap, shiftTypes, ['2025-01-06'], warnings);

    expect(getEntry(db, emp2.id, '2025-01-06').is_day_off).toBe(0); // Hugo atribuído
    expect(warnings).toHaveLength(0); // sem forçar → sem warning
  });

  it('dia com 1 motorista escalado, único candidato viola descanso → segundo_motorista_forcado', () => {
    // emp1 já trabalhando; emp2 tem folga mas violaria descanso → forçado via passo 2
    const noturno = db.prepare("SELECT * FROM shift_types WHERE name = 'Noturno'").get();
    const emp1 = createEmployee(db, { name: 'Iara', setor: 'Transporte Ambulância' });
    const emp2 = createEmployee(db, { name: 'Jonas', setor: 'Transporte Ambulância' });
    insertEntry(db, { employee_id: emp1.id, date: '2025-01-06', is_day_off: 0, shift_type_id: noturno.id });
    // Jonas trabalhou no noturno anterior → canAssignShift rejeita no passo 1
    insertEntry(db, { employee_id: emp2.id, date: '2025-01-05', is_day_off: 0, shift_type_id: noturno.id });
    insertEntry(db, { employee_id: emp2.id, date: '2025-01-06', is_day_off: 1, shift_type_id: null });

    const employees = [
      { ...emp1, setores: ['Transporte Ambulância'] },
      { ...emp2, setores: ['Transporte Ambulância'] },
    ];
    const sectorMap = {
      [emp1.id]: ['Transporte Ambulância'],
      [emp2.id]: ['Transporte Ambulância'],
    };
    const shiftTypes = db.prepare('SELECT * FROM shift_types').all();
    const warnings = [];

    enforceDailyCoverage(db, employees, sectorMap, shiftTypes, ['2025-01-06'], warnings);

    expect(getEntry(db, emp2.id, '2025-01-06').is_day_off).toBe(0); // Jonas forçado
    expect(warnings.some(w => w.type === 'segundo_motorista_forcado' && w.employee === 'Jonas')).toBe(true);
    expect(warnings.some(w => w.type === 'sem_motorista_forcado')).toBe(false); // não é 1º
  });

  it('dia com 0 motoristas e apenas 1 folga → 1 atribuído + cobertura_minima_insuficiente', () => {
    // Só 1 funcionário disponível como folga → preenche 1, não consegue 2
    const emp = createEmployee(db, { name: 'Karina', setor: 'Transporte Ambulância' });
    insertEntry(db, { employee_id: emp.id, date: '2025-01-07', is_day_off: 1, shift_type_id: null });

    const employees = [{ ...emp, setores: ['Transporte Ambulância'] }];
    const sectorMap = { [emp.id]: ['Transporte Ambulância'] };
    const shiftTypes = db.prepare('SELECT * FROM shift_types').all();
    const warnings = [];

    enforceDailyCoverage(db, employees, sectorMap, shiftTypes, ['2025-01-07'], warnings);

    expect(getEntry(db, emp.id, '2025-01-07').is_day_off).toBe(0); // Karina atribuída
    expect(warnings.some(w => w.type === 'cobertura_minima_insuficiente' && w.date === '2025-01-07')).toBe(true);
    expect(warnings.some(w => w.type === 'sem_motorista')).toBe(false); // 1 motorista cobriu parcialmente
  });

  it('dia com 1 motorista escalado e sem folgas disponíveis → cobertura_minima_insuficiente', () => {
    // emp1 trabalha; emp2 está de férias (locked notes=Férias) → sem candidatos para 2º
    const noturno = db.prepare("SELECT * FROM shift_types WHERE name = 'Noturno'").get();
    const emp1 = createEmployee(db, { name: 'Leo', setor: 'Transporte Ambulância' });
    const emp2 = createEmployee(db, { name: 'Marta', setor: 'Transporte Ambulância' });
    insertEntry(db, { employee_id: emp1.id, date: '2025-01-08', is_day_off: 0, shift_type_id: noturno.id });
    insertEntry(db, { employee_id: emp2.id, date: '2025-01-08', is_day_off: 1, shift_type_id: null, notes: 'Férias' });

    const employees = [
      { ...emp1, setores: ['Transporte Ambulância'] },
      { ...emp2, setores: ['Transporte Ambulância'] },
    ];
    const sectorMap = {
      [emp1.id]: ['Transporte Ambulância'],
      [emp2.id]: ['Transporte Ambulância'],
    };
    const shiftTypes = db.prepare('SELECT * FROM shift_types').all();
    const warnings = [];

    enforceDailyCoverage(db, employees, sectorMap, shiftTypes, ['2025-01-08'], warnings);

    expect(getEntry(db, emp1.id, '2025-01-08').is_day_off).toBe(0); // Leo permanece
    expect(getEntry(db, emp2.id, '2025-01-08').is_day_off).toBe(1); // Marta em férias intocada
    expect(warnings.some(w => w.type === 'cobertura_minima_insuficiente' && w.date === '2025-01-08')).toBe(true);
    expect(warnings.some(w => w.type === 'sem_motorista')).toBe(false);
  });
});

describe('getWeekType', () => {
  it('fase 1, mês 1, semana 0 → 36h', () => expect(getWeekType(1, 1, 0)).toBe('36h'));
  it('fase 1, mês 1, semana 1 → 42h', () => expect(getWeekType(1, 1, 1)).toBe('42h'));
  it('fase 1, mês 1, semana 2 → 42h', () => expect(getWeekType(1, 1, 2)).toBe('42h'));
  it('fase 1, mês 1, semana 3 → 36h', () => expect(getWeekType(1, 1, 3)).toBe('36h'));

  it('fase 2, mês 1, semana 0 → 42h', () => expect(getWeekType(2, 1, 0)).toBe('42h'));
  it('fase 2, mês 1, semana 2 → 36h', () => expect(getWeekType(2, 1, 2)).toBe('36h'));

  it('fase 3, mês 1, semana 1 → 36h', () => expect(getWeekType(3, 1, 1)).toBe('36h'));

  it('weekIndex >= 4 é clamped em 3', () => {
    expect(getWeekType(1, 1, 4)).toBe(getWeekType(1, 1, 3));
    expect(getWeekType(1, 1, 5)).toBe(getWeekType(1, 1, 3));
  });

  it('ciclo fecha após 3 meses: fase 1 mês 4 == fase 1 mês 1', () => {
    expect(getWeekType(1, 4, 0)).toBe(getWeekType(1, 1, 0));
    expect(getWeekType(1, 4, 1)).toBe(getWeekType(1, 1, 1));
  });

  it('fase 1 mês 2: motorista está no 2º mês do ciclo → patterns[1]', () => {
    expect(getWeekType(1, 2, 0)).toBe('42h');
    expect(getWeekType(1, 2, 2)).toBe('36h');
  });
});
