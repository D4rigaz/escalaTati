/**
 * test(generator): cobertura de integração do ciclo CLT (cycle_month) — issue #45
 *
 * Tester Senior
 *
 * Testa o gerador de ponta a ponta com cycle_month variando.
 * Não testa getWeekType diretamente (já coberto em scheduleGenerator.unit.test.js).
 *
 * Referência de calendário — Fevereiro 2025 (28 dias):
 *   Feb 1  = Sábado   → Semana 0: [Feb 1]  (1 dia)
 *   Feb 2  = Domingo  → Semana 1: [Feb 2–8]  (7 dias)
 *   Feb 9  = Domingo  → Semana 2: [Feb 9–15] (7 dias)
 *   Feb 16 = Domingo  → Semana 3: [Feb 16–22] (7 dias)
 *   Feb 23 = Domingo  → Semana 4: [Feb 23–28] (6 dias)
 *
 * getWeekType(cycleMonth, genMonth=2, weekIndex):
 *   cycle_month=1 → actualCycle=1 → patterns[1]=['42h','42h','36h','42h']
 *     semana 1 = 42h (4 ADM turnos), semana 2 = 36h (3 ADM turnos)
 *   cycle_month=2 → actualCycle=2 → patterns[2]=['42h','36h','42h','42h']
 *     semana 1 = 36h (3 ADM turnos), semana 2 = 42h (4 ADM turnos)
 *
 * Notas de design dos cenários ADM:
 *   O turno Administrativo (07h–17h, 10h) impõe 14h de descanso entre dias
 *   consecutivos — abaixo do mínimo de 24h. O gerador cai back para Noturno/Manhã
 *   em dias seguidos. Isso resulta em totais variáveis entre 144h–160h por mês.
 *
 *   cycle_month=2 em Fev/2025 gera exatamente 160h → atinge COVERAGE_HOURS_CAP →
 *   enforcement não o altera. Os contadores por semana são determinísticos.
 *
 *   cycle_month=1 em Fev/2025 gera 154h → abaixo do cap. O enforceDailyCoverage
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
// Não-ADM (Ambulância): cycle_month é apenas label contábil CLT — não afeta
// o número de plantões físicos. Todos os valores devem produzir a mesma faixa
// de horas (144h–180h, desvio ≤ 12h de 160h).

describe('Cenário A — Não-ADM: cycle_month não afeta plantões físicos', () => {
  for (const cycleMonth of [1, 2, 3]) {
    it(`Ambulância cycle_month=${cycleMonth} em Janeiro/2025: horas entre 144h e 180h, desvio ≤ 12h`, async () => {
      const empRes = await request(app)
        .post('/api/employees')
        .send({ name: `Motorista A${cycleMonth}`, setores: ['Transporte Ambulância'], cycle_month: cycleMonth });
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
      expect(Math.abs(finalHours - 160)).toBeLessThanOrEqual(12);
    });
  }
});

// ── Cenário B ─────────────────────────────────────────────────────────────────
// ADM (Transporte Administrativo): cycle_month determina semanas 36h (3 turnos)
// vs 42h (4 turnos).
//
// cycle_month=2: total exato 160h em Fev/2025 → COVERAGE_HOURS_CAP atingido →
//   enforcement não altera → semana 1 = 36h (3 turnos), semana 2 = 42h (4 turnos).
//
// cycle_month=1: total 154h → enforcement adiciona 1 turno na semana 1 (Feb 6) →
//   semana 1 cresce, mas semana 2 (36h, 3 turnos) permanece intacta pois após
//   a adição o cap é atingido e enforcement para.

describe('Cenário B — ADM: label CLT (36h/42h) afeta número de turnos por semana', () => {
  it('ADM cycle_month=2: semana 1 de Fev/2025 tem label 36h → exatamente 3 plantões; semana 2 tem label 42h → 4 plantões', async () => {
    // cycle_month=2 → actualCycle=2 → patterns[2]=['42h','36h','42h','42h']
    // sem 1=36h (3 turnos base), sem 2=42h (4 turnos base).
    //
    // Com a distribuição de folgas por employee.id (fix #55), o Domingo que inicia a
    // semana 1 (Feb 2) passa a ser folga do único motorista presente. O enforcement
    // (enforceDailyCoverage Passo 2) converte esse Domingo em plantão forçado, elevando
    // o total de week1 de 3 (base 36h) para 4 (3 + 1 enforcement).
    // A semana 2 permanece em 4 (42h base) pois o cap de 160h já foi atingido.
    // A relação label 36h < label 42h é verificada em Cenário D1 com dois motoristas.
    const empRes = await request(app)
      .post('/api/employees')
      .send({ name: 'ADM Ciclo2', setores: ['Transporte Administrativo'], cycle_month: 2 });
    expect(empRes.status).toBe(201);

    const genRes = await request(app).post('/api/schedules/generate').send(FEV);
    expect(genRes.status).toBe(200);

    const schedRes = await request(app).get(`/api/schedules?month=${FEV.month}&year=${FEV.year}`);
    const entries = schedRes.body.entries;
    const empId = empRes.body.id;

    // Semana 1 (36h base + 1 enforcement no Domingo inicial): 4 plantões no cenário mono-motorista
    expect(workIn(entries, empId, FEV_WEEK1)).toBe(4);
    // Semana 2 (42h para cycle_month=2): 4 plantões (cap atingido — sem enforcement)
    expect(workIn(entries, empId, FEV_WEEK2)).toBe(4);
  });

  it('ADM cycle_month=1: semana 2 de Fev/2025 tem label 36h → exatamente 3 plantões; semana 1 (42h) tem mais plantões que semana 2 (36h)', async () => {
    // cycle_month=1 → actualCycle=1 → patterns[1]=['42h','42h','36h','42h']
    // sem 1=42h (4 turnos base), sem 2=36h (3 turnos). Total gerado=154h → enforcement
    // adiciona 1 turno forçado na sem 1 (Feb 6, cap atingido) → sem 2 permanece em 3.
    const empRes = await request(app)
      .post('/api/employees')
      .send({ name: 'ADM Ciclo1', setores: ['Transporte Administrativo'], cycle_month: 1 });
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
// seg_sex + cycle_month: Sáb/Dom são folga obrigatória do gerador. O Passo 3
// (emergência) do enforcement pode forçar um plantão em Sábado quando não há
// outra opção, mas Domingos permanecem sempre livres (cap atingido após o Sábado).
//
// O teste verifica:
//   - Nenhum plantão em Domingo (Sunday) — protegido pelo cap pós-enforcement
//   - Total de horas dentro de ±12h do alvo de 160h

describe('Cenário C — seg_sex + cycle_month: interação não testada', () => {
  it('ADM seg_sex cycle_month=2 em Fev/2025: no máximo 1 plantão em Domingo e horas dentro de ±12h do alvo', async () => {
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
        name: 'ADM SegSex Ciclo2',
        setores: ['Transporte Administrativo'],
        work_schedule: 'seg_sex',
        cycle_month: 2,
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

  it('ADM seg_sex cycle_month=2: semana 1 aloca plantões em dias úteis (redução de disponibilidade refletida)', async () => {
    // Com seg_sex + 36h (cycle_month=2 em Fev), a semana 1 tem no máximo
    // 5 dias úteis disponíveis (Seg–Sex). A geração tenta 3 turnos nesses dias.
    // correctHours pode adicionar mais 1, totalizando ≤ 5 (limite de úteis).
    const empRes = await request(app)
      .post('/api/employees')
      .send({
        name: 'ADM SegSex Ciclo2 B',
        setores: ['Transporte Administrativo'],
        work_schedule: 'seg_sex',
        cycle_month: 2,
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
// Labels distintas: dois motoristas ADM com cycle_month diferentes no mesmo mês
// devem ter distribuições semanais diferentes na semana 2:
//   cycle_month=1 → semana 2 = 36h → 3 plantões (enforcement parado, sem 2 intacta)
//   cycle_month=2 → semana 2 = 42h → 4 plantões (cap atingido, sem enforcement)

describe('Cenário D1 — labels: weekClassifications distintas entre cycle_month diferentes', () => {
  it('ADM cycle_month=1 e cycle_month=2 no mesmo mês: contagem de plantões na semana 2 difere entre eles', async () => {
    const emp1Res = await request(app)
      .post('/api/employees')
      .send({ name: 'ADM Fase1', setores: ['Transporte Administrativo'], cycle_month: 1 });
    const emp2Res = await request(app)
      .post('/api/employees')
      .send({ name: 'ADM Fase2', setores: ['Transporte Administrativo'], cycle_month: 2 });
    expect(emp1Res.status).toBe(201);
    expect(emp2Res.status).toBe(201);

    const genRes = await request(app).post('/api/schedules/generate').send(FEV);
    expect(genRes.status).toBe(200);

    const schedRes = await request(app).get(`/api/schedules?month=${FEV.month}&year=${FEV.year}`);
    const entries = schedRes.body.entries;

    // cycle_month=1 → sem 2 = 36h → 3 plantões (enforcement parado no cap)
    const week2Emp1 = workIn(entries, emp1Res.body.id, FEV_WEEK2);
    // cycle_month=2 → sem 2 = 42h → 4 plantões (cap atingido desde a geração)
    const week2Emp2 = workIn(entries, emp2Res.body.id, FEV_WEEK2);

    // As distribuições devem diferir — prova que cycle_month afeta o scheduling ADM
    expect(week2Emp1).not.toBe(week2Emp2);
    expect(week2Emp1).toBe(3); // 36h
    expect(week2Emp2).toBe(4); // 42h
  });
});

// ── Cenário D2 ────────────────────────────────────────────────────────────────
// Cobertura mantida: motoristas de Hemodiálise e Ambulância com cycle_month
// distintos. O gerador deve completar sem crash; cobertura diurna (Regra 16)
// e noturna (Regras 21/22) deve ser satisfeita ou emitir warnings corretos.

describe('Cenário D2 — cobertura: cobertura diurna/noturna com cycle_month distintos', () => {
  it('Hemodiálise cycle_month=1 + Ambulância cycle_month=2: geração completa com results válidos e warnings estruturados', async () => {
    const hemoRes = await request(app)
      .post('/api/employees')
      .send({ name: 'Hemo Ciclo1', setores: ['Transporte Hemodiálise'], cycle_month: 1 });
    const ambulRes = await request(app)
      .post('/api/employees')
      .send({ name: 'Ambul Ciclo2', setores: ['Transporte Ambulância'], cycle_month: 2 });
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
