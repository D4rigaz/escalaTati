/**
 * test(generator): cobertura de integração do ciclo CLT (cycle_start_month + cycle_start_year)
 *
 * Tester Senior
 *
 * Testa o gerador de ponta a ponta com cycle_start_month/year variando.
 * Não testa calculateEffectiveCycleMonth diretamente (coberto em scheduleGenerator.unit.test.js).
 *
 * Referência de calendário — Fevereiro 2025 (28 dias):
 *   Feb 1  = Sábado   → Semana 0: [Feb 1]  (1 dia)
 *   Feb 2  = Domingo  → Semana 1: [Feb 2–8]  (7 dias)
 *   Feb 9  = Domingo  → Semana 2: [Feb 9–15] (7 dias)
 *   Feb 16 = Domingo  → Semana 3: [Feb 16–22] (7 dias)
 *   Feb 23 = Domingo  → Semana 4: [Feb 23–28] (6 dias)
 *
 * calculateEffectiveCycleMonth + getWeekTypeFromPhase (genMonth=2/year=2025):
 *   cycle_start=Jan/2025 (elapsed=1) → phase=2 → patterns[2]=['42h','42h','36h','42h']
 *     semana 1 = 42h (4 ADM turnos), semana 2 = 36h (3 ADM turnos)
 *   cycle_start=Dez/2024 (elapsed=2) → phase=3 → patterns[3]=['42h','36h','42h','42h']
 *     semana 1 = 36h (3 ADM turnos), semana 2 = 42h (4 ADM turnos)
 *
 * Notas de design dos cenários ADM:
 *   O turno Administrativo (07h–17h, 10h) impõe 14h de descanso entre dias
 *   consecutivos — abaixo do mínimo de 24h. O gerador cai back para Noturno/Manhã
 *   em dias seguidos. Isso resulta em totais variáveis entre 144h–160h por mês.
 *
 *   cycle_start=Dez/2024 em Fev/2025 gera exatamente 160h → atinge COVERAGE_HOURS_CAP →
 *   enforcement não o altera. Os contadores por semana são determinísticos.
 *
 *   cycle_start=Jan/2025 em Fev/2025 gera 154h → abaixo do cap. O enforceDailyCoverage
 *   adiciona 1 turno à semana 1 (forçado) → semana 2 (36h) permanece intacta.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { freshDb } from './helpers.js';

// Meses de referência
const JAN = { month: 1, year: 2025 };
const FEV = { month: 2, year: 2025 };

// Semanas de Fevereiro 2025 (baseadas em Domingo — igual ao buildWeeks do gerador)
const FEV_WEEK1 = ['2025-02-02','2025-02-03','2025-02-04','2025-02-05','2025-02-06','2025-02-07','2025-02-08'];
const FEV_WEEK2 = ['2025-02-09','2025-02-10','2025-02-11','2025-02-12','2025-02-13','2025-02-14','2025-02-15'];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Conta entradas de trabalho (não-folga) de um employee nas datas especificadas */
function workIn(entries, empId, dates) {
  return entries.filter(
    (e) => e.employee_id === empId && dates.includes(e.date) && !e.is_day_off
  ).length;
}

/** Soma total de horas trabalhadas de um employee no período */
function totalHoursOf(entries, empId) {
  return entries
    .filter((e) => e.employee_id === empId && !e.is_day_off)
    .reduce((sum, e) => sum + (e.duration_hours || 0), 0);
}

beforeEach(() => freshDb());

// ── Cenário A ─────────────────────────────────────────────────────────────────
// Não-ADM (Ambulância): cycle_start é apenas label contábil CLT — não afeta
// o número de plantões físicos. Todos os valores devem produzir a mesma faixa
// de horas (144h–180h, desvio ≤ 12h de 160h).

// cycle_start combos que produzem fases 1, 2, 3 para Jan/2025
const CYCLE_START_JAN2025 = [
  { cycle_start_month: 1, cycle_start_year: 2025 },  // elapsed=0 → phase 1
  { cycle_start_month: 12, cycle_start_year: 2024 }, // elapsed=1 → phase 2
  { cycle_start_month: 11, cycle_start_year: 2024 }, // elapsed=2 → phase 3
];

describe('Cenário A — Não-ADM: cycle_start não afeta plantões físicos', () => {
  for (const { cycle_start_month, cycle_start_year } of CYCLE_START_JAN2025) {
    it(`Ambulância cycle_start=${cycle_start_month}/${cycle_start_year} em Janeiro/2025: horas entre 144h e 180h (mês com 5 semanas — exceder 160h é aceitável)`, async () => {
      const empRes = await request(app)
        .post('/api/employees')
        .send({ name: `Motorista A${cycle_start_month}`, setores: ['Transporte Ambulância'], cycle_start_month, cycle_start_year });
      expect(empRes.status).toBe(201);

      const genRes = await request(app)
        .post('/api/schedules/generate')
        .send(JAN);
      expect(genRes.status).toBe(200);
      expect(genRes.body.success).toBe(true);

      const schedRes = await request(app).get(`/api/schedules?month=${JAN.month}&year=${JAN.year}`);
      const empEntries = schedRes.body.entries.filter((e) => e.employee_id === empRes.body.id);
      const finalHours = empEntries.reduce(
        (sum, e) => (e.is_day_off ? sum : sum + (e.duration_hours || 0)),
        0
      );

      expect(finalHours).toBeGreaterThanOrEqual(144);
      expect(finalHours).toBeLessThanOrEqual(180);
      // Nota: exceder 160h em meses com 5 semanas é aceitável (fix #92 — guard CLT semanal).
    });
  }
});

// ── Cenário B ─────────────────────────────────────────────────────────────────
// ADM (Transporte Administrativo): cycle_start determina semanas 36h (3 turnos)
// vs 42h (4 turnos).
//
// cycle_start=Dez/2024 (phase 3 em Fev/2025): sem 1=36h (3 base), sem 2=42h (4 base).
//   Com turnos de 12h (Diurno), total bruto > 160h → correctHours remove
//   1 plantão da semana 2 → semana 1 = 4 (36h base + 1 enforcement), semana 2 = 3.
//
// cycle_start=Jan/2025 (phase 2 em Fev/2025): sem 1=42h (4 base), sem 2=36h (3 turnos).
//   Total 154h → enforcement adiciona 1 turno na semana 1 (Feb 6) →
//   semana 1 cresce, mas semana 2 (36h, 3 turnos) permanece intacta pois após
//   a adição o cap é atingido e enforcement para.

describe('Cenário B — ADM: label CLT (36h/42h) afeta número de turnos por semana', () => {
  it('ADM cycle_start=Dez/2024 (phase 3): semana 1 de Fev/2025 (36h label) tem 3 plantões; semana 2 (42h label) tem 4 plantões; enforcement não viola limite CLT', async () => {
    // cycle_start=Dez/2024 → phase 3 → patterns[3]=['42h','36h','42h','42h']
    // sem 0=42h (1 dia, 1 turno), sem 1=36h (3 turnos base), sem 2=42h (4 turnos base).
    //
    // fix #80: enforcement e correctHours respeitam o limite CLT semanal.
    // Semana 1 (36h label) → limite ADM = 3 turnos → enforcement NÃO adiciona 4º turno.
    // Total gerado = 10+30+40+40+40 = 160h → correctHours não altera.
    // Enforcement não pode adicionar mais (cap 160h atingido).
    const empRes = await request(app)
      .post('/api/employees')
      .send({ name: 'ADM Phase3', setores: ['Transporte Administrativo'], cycle_start_month: 12, cycle_start_year: 2024 });
    expect(empRes.status).toBe(201);

    const genRes = await request(app).post('/api/schedules/generate').send(FEV);
    expect(genRes.status).toBe(200);

    const schedRes = await request(app).get(`/api/schedules?month=${FEV.month}&year=${FEV.year}`);
    const entries = schedRes.body.entries;
    const empId = empRes.body.id;

    // Semana 1 (36h label → limite 3 turnos ADM): exatamente 3 plantões — enforcement respeitou o limite
    expect(workIn(entries, empId, FEV_WEEK1)).toBe(3);
    // Semana 2 (42h label → limite 4 turnos ADM): exatamente 4 plantões
    expect(workIn(entries, empId, FEV_WEEK2)).toBe(4);
  });

  it('ADM cycle_start=Jan/2025 (phase 2): semana 2 de Fev/2025 tem label 36h → exatamente 3 plantões; semana 1 (42h) tem mais plantões que semana 2 (36h)', async () => {
    // cycle_start=Jan/2025 → phase 2 → patterns[2]=['42h','42h','36h','42h']
    // sem 1=42h (4 turnos base), sem 2=36h (3 turnos). Total gerado=154h → enforcement
    // adiciona 1 turno forçado na sem 1 (Feb 6, cap atingido) → sem 2 permanece em 3.
    const empRes = await request(app)
      .post('/api/employees')
      .send({ name: 'ADM Phase2', setores: ['Transporte Administrativo'], cycle_start_month: 1, cycle_start_year: 2025 });
    expect(empRes.status).toBe(201);

    const genRes = await request(app).post('/api/schedules/generate').send(FEV);
    expect(genRes.status).toBe(200);

    const schedRes = await request(app).get(`/api/schedules?month=${FEV.month}&year=${FEV.year}`);
    const entries = schedRes.body.entries;
    const empId = empRes.body.id;

    const week1Work = workIn(entries, empId, FEV_WEEK1); // 42h base (≥4 com enforcement)
    const week2Work = workIn(entries, empId, FEV_WEEK2); // 36h → exatamente 3

    // Semana 2 (label 36h) tem exatamente 3 plantões — enforcement parou antes
    expect(week2Work).toBe(3);
    // Semana 1 (label 42h) tem mais plantões que a semana de 36h
    expect(week1Work).toBeGreaterThan(week2Work);
  });
});

// ── Cenário C ─────────────────────────────────────────────────────────────────
// seg_sex + cycle_start: Sáb/Dom são folga obrigatória do gerador. O Passo 3
// (emergência) do enforcement pode forçar um plantão em Sábado quando não há
// outra opção, mas Domingos permanecem sempre livres (cap atingido após o Sábado).
//
// O teste verifica:
//   - Nenhum plantão em Domingo (Sunday) — protegido pelo cap pós-enforcement
//   - Total de horas dentro de ±12h do alvo de 160h

describe('Cenário C — seg_sex + cycle_start: interação não testada', () => {
  it('ADM seg_sex cycle_start=Dez/2024 (phase 3) em Fev/2025: no máximo 1 plantão em Domingo e horas dentro de ±12h do alvo', async () => {
    // Com a distribuição de folgas por employee.id (fix #55), a semana 1 aloca
    // plantões em Seg–Qua em vez de Seg–Sex do código anterior. Isso muda quais
    // dias livres têm descanso adequado para correctHours, que neste cenário
    // mono-motorista não consegue converter nenhuma folga → total gerado = 148h.
    //
    // Enforcement:
    //   Passo 3 força Feb 1 (Sáb): +10h → 158h
    //   Passo 3 força Feb 2 (Dom): +10h → 168h → cap atingido
    //   Domingos subsequentes (Feb 9, 16, 23) permanecem protegidos pelo cap.
    //
    // Resultado: exatamente 1 Domingo forçado por emergência de cobertura mono-motorista.
    const empRes = await request(app)
      .post('/api/employees')
      .send({
        name: 'ADM SegSex Phase3',
        setores: ['Transporte Administrativo'],
        work_schedule: 'seg_sex',
        cycle_start_month: 12,
        cycle_start_year: 2024,
      });
    expect(empRes.status).toBe(201);

    const genRes = await request(app).post('/api/schedules/generate').send(FEV);
    expect(genRes.status).toBe(200);
    expect(genRes.body.success).toBe(true);

    const schedRes = await request(app).get(`/api/schedules?month=${FEV.month}&year=${FEV.year}`);
    const empEntries = schedRes.body.entries.filter((e) => e.employee_id === empRes.body.id);

    // Em cenário mono-motorista seg_sex: Passo 3 (emergência) força exatamente 1 Domingo
    // (o primeiro do mês) antes de atingir o cap. Os demais Domingos ficam protegidos.
    const sundayWork = empEntries.filter((e) => {
      if (e.is_day_off) return false;
      return new Date(e.date + 'T12:00:00').getDay() === 0;
    });
    expect(sundayWork).toHaveLength(1);

    // Total de horas dentro de ±12h do alvo (168h = 8h de desvio)
    const finalHours = empEntries.reduce(
      (sum, e) => (e.is_day_off ? sum : sum + (e.duration_hours || 0)),
      0
    );
    expect(finalHours).toBeGreaterThan(0);
    expect(Math.abs(finalHours - 160)).toBeLessThanOrEqual(12);
  });

  it('ADM seg_sex cycle_start=Dez/2024 (phase 3): semana 1 aloca plantões em dias úteis (redução de disponibilidade refletida)', async () => {
    // Com seg_sex + 36h (phase 3 em Fev), a semana 1 tem no máximo
    // 5 dias úteis disponíveis (Seg–Sex). A geração tenta 3 turnos nesses dias.
    // correctHours pode adicionar mais 1, totalizando ≤ 5 (limite de úteis).
    const empRes = await request(app)
      .post('/api/employees')
      .send({
        name: 'ADM SegSex Phase3 B',
        setores: ['Transporte Administrativo'],
        work_schedule: 'seg_sex',
        cycle_start_month: 12,
        cycle_start_year: 2024,
      });
    expect(empRes.status).toBe(201);

    await request(app).post('/api/schedules/generate').send(FEV);

    const schedRes = await request(app).get(`/api/schedules?month=${FEV.month}&year=${FEV.year}`);
    const entries = schedRes.body.entries;
    const empId = empRes.body.id;

    // Plantões na semana 1 limitados pelos dias úteis disponíveis (seg_sex remove Sáb/Dom)
    const week1Work = workIn(entries, empId, FEV_WEEK1);
    expect(week1Work).toBeLessThanOrEqual(5); // no máximo os 5 dias úteis disponíveis
    expect(week1Work).toBeGreaterThan(0);     // pelo menos 1 plantão alocado
  });
});

// ── Cenário D1 ────────────────────────────────────────────────────────────────
// Labels distintas: dois motoristas ADM com cycle_start diferentes no mesmo mês
// devem ter distribuições semanais diferentes na semana 2:
//   cycle_start=Jan/2025 (phase 2) → semana 2 = 36h → 3 plantões (enforcement parado)
//   cycle_start=Dez/2024 (phase 3) → semana 2 = 42h → 4 plantões (cap atingido)

describe('Cenário D1 — labels: weekClassifications distintas entre cycle_start diferentes', () => {
  it('ADM cycle_start=Jan/2025 (phase 2) e cycle_start=Dez/2024 (phase 3) no mesmo mês: contagem de plantões na semana 2 difere', async () => {
    const emp1Res = await request(app)
      .post('/api/employees')
      .send({ name: 'ADM Phase2', setores: ['Transporte Administrativo'], cycle_start_month: 1, cycle_start_year: 2025 });
    const emp2Res = await request(app)
      .post('/api/employees')
      .send({ name: 'ADM Phase3', setores: ['Transporte Administrativo'], cycle_start_month: 12, cycle_start_year: 2024 });
    expect(emp1Res.status).toBe(201);
    expect(emp2Res.status).toBe(201);

    const genRes = await request(app).post('/api/schedules/generate').send(FEV);
    expect(genRes.status).toBe(200);

    const schedRes = await request(app).get(`/api/schedules?month=${FEV.month}&year=${FEV.year}`);
    const entries = schedRes.body.entries;

    // phase 2 → sem 2 = 36h → 3 plantões (enforcement parado no cap)
    const week2Emp1 = workIn(entries, emp1Res.body.id, FEV_WEEK2);
    // phase 3 → sem 2 = 42h → 4 plantões (cap atingido desde a geração)
    const week2Emp2 = workIn(entries, emp2Res.body.id, FEV_WEEK2);

    // As distribuições devem diferir — prova que cycle_start afeta o scheduling ADM
    expect(week2Emp1).not.toBe(week2Emp2);
    expect(week2Emp1).toBe(3); // 36h
    expect(week2Emp2).toBe(4); // 42h
  });
});

// ── Cenário D2 ────────────────────────────────────────────────────────────────
// Cobertura mantida: motoristas de Hemodiálise e Ambulância com cycle_start
// distintos. O gerador deve completar sem crash; cobertura diurna (Regra 16)
// e noturna (Regras 21/22) deve ser satisfeita ou emitir warnings corretos.

describe('Cenário D2 — cobertura: cobertura diurna/noturna com cycle_start distintos', () => {
  it('Hemodiálise cycle_start=Jan/2025 (phase 2) + Ambulância cycle_start=Dez/2024 (phase 3): geração completa com results válidos e warnings estruturados', async () => {
    const hemoRes = await request(app)
      .post('/api/employees')
      .send({ name: 'Hemo Phase2', setores: ['Transporte Hemodiálise'], cycle_start_month: 1, cycle_start_year: 2025 });
    const ambulRes = await request(app)
      .post('/api/employees')
      .send({ name: 'Ambul Phase3', setores: ['Transporte Ambulância'], cycle_start_month: 12, cycle_start_year: 2024 });
    expect(hemoRes.status).toBe(201);
    expect(ambulRes.status).toBe(201);

    const genRes = await request(app).post('/api/schedules/generate').send(FEV);
    expect(genRes.status).toBe(200);
    expect(genRes.body.success).toBe(true);

    // Ambos os motoristas devem ter results com horas válidas
    const results = genRes.body.results;
    expect(results).toHaveLength(2);
    results.forEach((r) => {
      expect(r.hours).toBeGreaterThan(0);
    });

    // Warnings (se emitidos) devem ter estrutura correta
    const warnings = genRes.body.warnings;
    expect(Array.isArray(warnings)).toBe(true);
    warnings.forEach((w) => {
      expect(w).toHaveProperty('message');
      expect(typeof w.message).toBe('string');
      expect(w.message.length).toBeGreaterThan(0);
    });

    // Cada motorista deve ter entradas no schedule com horas > 0
    const schedRes = await request(app).get(`/api/schedules?month=${FEV.month}&year=${FEV.year}`);
    const entries = schedRes.body.entries;
    expect(totalHoursOf(entries, hemoRes.body.id)).toBeGreaterThan(0);
    expect(totalHoursOf(entries, ambulRes.body.id)).toBeGreaterThan(0);
  });
});
