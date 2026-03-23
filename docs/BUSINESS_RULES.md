# Regras de Negócio — escalaTati

> Documento de referência para o time. Atualizado pelo Product Owner.

---

## Regra 1 — Início da escala mensal: primeiro domingo do mês

A escala de cada mês **sempre começa no primeiro domingo do mês**, independentemente do dia da semana em que o mês inicia.

### Semana parcial

Os dias entre o dia 01 do mês e o primeiro domingo (exclusive) formam uma **semana parcial** e recebem tratamento especial pelo gerador (`isDiurnoPartialWeek`). Esses dias **não contam** como semana CLT para fins de `cltWeekOffset`.

### Calendário de referência — primeiros domingos de 2026

| Mês | Dia 01 | Primeiro domingo | Dias de semana parcial |
|-----|--------|-----------------|------------------------|
| Jan/2026 | Qui | 04/01 | 3 dias (Qui–Sáb) |
| Fev/2026 | Dom | 01/02 | 0 dias |
| Mar/2026 | Dom | 01/03 | 0 dias |
| **Abr/2026** | **Qua** | **05/04** | **4 dias (Qua–Sáb)** |
| Mai/2026 | Sex | 03/05 | 2 dias (Sex–Sáb) |
| Jun/2026 | Seg | 07/06 | 6 dias (Seg–Sáb) |
| Jul/2026 | Qua | 05/07 | 4 dias (Qua–Sáb) |
| Ago/2026 | Sáb | 02/08 | 1 dia (Sáb) |
| Set/2026 | Ter | 06/09 | 5 dias (Ter–Sáb) |
| Out/2026 | Qui | 04/10 | 3 dias (Qui–Sáb) |
| Nov/2026 | Dom | 01/11 | 0 dias |
| Dez/2026 | Ter | 06/12 | 5 dias (Ter–Sáb) |

Meses de **alto risco** (semana parcial ≥ 4 dias) em 2026: **Abr, Jun, Jul, Set, Dez**.

### Impacto no código

- `getSchedulePeriod(month, year)` em `scheduleGenerator.js` retorna `startDate` = primeiro domingo do mês
- `cltWeekOffset = firstWeekIsPartial ? 1 : 0` — a semana parcial não entra no índice CLT
- O tipo de semana CLT (36h/42h) é calculado por `getWeekTypeGlobal` a partir do primeiro domingo do mês de `cycle_start` do funcionário (fix #127)

### Impacto para o time

| Persona | Responsabilidade |
|---------|-----------------|
| Desenvolvedor Pleno | `cltWeekOffset` nunca conta a semana parcial inicial no offset |
| Tester Senior | Incluir nos cenários meses com semana parcial ≥ 4 dias (Abr, Jun, Jul, Set, Dez/2026) |
| Revisor Senior | Validar que PRs de geração incluem pelo menos 1 cenário com semana parcial |

> Definição aprovada pelo PO. Relacionado: bug #127 (Abril/2026), issue #129.

---

## Regra 2 — Ciclo CLT: padrão de semanas 36h/42h

Cada funcionário CLT tem um `cycle_start` (mês + ano) que define a fase do ciclo de 3 meses.

### Padrão global de 12 semanas (`GLOBAL_PATTERN_12`)

```
Semanas  0– 3 (fase 1): 36h, 42h, 42h, 36h
Semanas  4– 7 (fase 2): 42h, 42h, 36h, 42h
Semanas  8–11 (fase 3): 42h, 36h, 42h, 42h
```

O padrão repete a cada 12 semanas a partir do primeiro domingo do mês de `cycle_start`.

### Fases por mês de cycle_start

| Fase | Meses de cycle_start |
|------|---------------------|
| Fase 1 | Jan, Fev, Mar, Abr |
| Fase 2 | Mai, Jun, Jul, Ago |
| Fase 3 | Set, Out, Nov, Dez |

### Por que índice global (não local por mês)

Meses com 5 semanas CLT (Mar, Mai, Ago, Nov em 2026) consomem 5 posições do padrão. Um índice reiniciado a cada mês acumularia drift. O índice global, calculado desde o primeiro domingo do `cycle_start`, elimina esse problema (fix #127).

> Relacionado: bug #127, PR #131, PR #132.

---

## Regra 3 — Meta de horas mensais

Cada funcionário CLT deve ter **160 horas mensais** como alvo. O gerador aplica `correctHours` para aproximar o total gerado de 160h, respeitando o limite semanal CLT (36h ou 42h) e as regras de descanso.

Tolerância: ±12h (desvios menores não são corrigidos).
