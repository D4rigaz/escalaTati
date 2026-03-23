/**
 * db:seed — popula o banco com um conjunto representativo de funcionários.
 * Idempotente: não insere duplicatas se o seed já foi executado.
 *
 * Uso: npm run db:seed
 * Recomendado após: npm run db:reset
 */

import { getDb, runTransaction } from './database.js';

const db = getDb();

const existing = db.prepare('SELECT COUNT(*) as n FROM employees').get();
if (existing.n > 0) {
  console.log(`Banco já tem ${existing.n} funcionário(s) — seed ignorado.`);
  console.log('Para resetar, execute "npm run db:reset" antes do seed.');
  process.exit(0);
}

const shifts = db.prepare('SELECT id, name FROM shift_types').all();
const shiftId = (name) => shifts.find((s) => s.name === name)?.id ?? null;

const SETORES = {
  amb: 'Transporte Ambulância',
  hemo: 'Transporte Hemodiálise',
  adm: 'Transporte Administrativo',
};

function insertEmployee({ name, cycleMonth, preferredShift, setores, color }) {
  const res = db.prepare(
    "INSERT INTO employees (name, cargo, color, cycle_start_month, cycle_start_year) VALUES (?, 'Motorista', ?, ?, 2026)"
  ).run(name, color, cycleMonth);

  const empId = res.lastInsertRowid;

  for (const setor of setores) {
    db.prepare('INSERT INTO employee_sectors (employee_id, setor) VALUES (?, ?)').run(empId, setor);
  }

  db.prepare(
    'INSERT INTO employee_rest_rules (employee_id, min_rest_hours, preferred_shift_id) VALUES (?, 24, ?)'
  ).run(empId, preferredShift);
}

runTransaction(() => {
  // Ambulância — 4 motoristas: 2 Diurno (ciclos Jan/Fev) + 2 Noturno (ciclos Jan/Mar)
  insertEmployee({ name: 'Amb Diurno 1',  cycleMonth: 1, preferredShift: shiftId('Diurno'),  setores: [SETORES.amb],  color: '#3B82F6' });
  insertEmployee({ name: 'Amb Diurno 2',  cycleMonth: 2, preferredShift: shiftId('Diurno'),  setores: [SETORES.amb],  color: '#2563EB' });
  insertEmployee({ name: 'Amb Noturno 1', cycleMonth: 1, preferredShift: shiftId('Noturno'), setores: [SETORES.amb],  color: '#6366F1' });
  insertEmployee({ name: 'Amb Noturno 2', cycleMonth: 3, preferredShift: shiftId('Noturno'), setores: [SETORES.amb],  color: '#4F46E5' });

  // Hemodiálise — 4 motoristas: 2 Diurno (ciclos Fev/Mar) + 2 Noturno (ciclos Jan/Fev)
  insertEmployee({ name: 'Hemo Diurno 1',  cycleMonth: 2, preferredShift: shiftId('Diurno'),  setores: [SETORES.hemo], color: '#10B981' });
  insertEmployee({ name: 'Hemo Diurno 2',  cycleMonth: 3, preferredShift: shiftId('Diurno'),  setores: [SETORES.hemo], color: '#059669' });
  insertEmployee({ name: 'Hemo Noturno 1', cycleMonth: 1, preferredShift: shiftId('Noturno'), setores: [SETORES.hemo], color: '#34D399' });
  insertEmployee({ name: 'Hemo Noturno 2', cycleMonth: 2, preferredShift: shiftId('Noturno'), setores: [SETORES.hemo], color: '#6EE7B7' });

  // Administrativo — 4 motoristas sem turno preferido (null-preferred, ciclos variados)
  insertEmployee({ name: 'Adm Flex 1', cycleMonth: 1, preferredShift: null, setores: [SETORES.adm], color: '#F59E0B' });
  insertEmployee({ name: 'Adm Flex 2', cycleMonth: 2, preferredShift: null, setores: [SETORES.adm], color: '#D97706' });
  insertEmployee({ name: 'Adm Flex 3', cycleMonth: 3, preferredShift: null, setores: [SETORES.adm], color: '#FBBF24' });

  // Polivalente — atende Ambulância e Hemodiálise
  insertEmployee({ name: 'Polivalente 1', cycleMonth: 1, preferredShift: shiftId('Diurno'), setores: [SETORES.amb, SETORES.hemo], color: '#EC4899' });
});

const total = db.prepare('SELECT COUNT(*) as n FROM employees').get();
console.log(`Seed concluído: ${total.n} funcionários inseridos.`);
console.log('Execute "npm run dev" para iniciar o servidor.');
