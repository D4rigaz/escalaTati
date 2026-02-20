# escalaTati

Sistema de gestão de escala de trabalho com geração automática de turnos, respeitando 160h/mês por funcionário e regras de descanso.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Backend | Node.js (ESM) + Express + SQLite (`node:sqlite`) |
| Frontend | React 18 + Vite + Zustand + TailwindCSS + Radix UI |
| Exportação | ExcelJS (xlsx) + jsPDF |

## Funcionalidades

- Cadastro de funcionários com regras de descanso individuais
- Tipos de turno configuráveis (Manhã, Tarde, Noturno + customizáveis)
- Geração automática de escala mensal (meta: 160h/mês por funcionário)
- Edição manual de entradas com bloqueio (lock)
- Visualização em tabela semanal e calendário
- Exportação para Excel e PDF
- Resumo mensal com indicadores de horas (✅ / ⬆️ / ⬇️)

## Pré-requisitos

- Node.js 22+
- npm 10+

## Instalação

```bash
git clone https://github.com/D4rigaz/escalaTati.git
cd escalaTati
npm install
```

## Rodando em desenvolvimento

```bash
# Backend + Frontend em paralelo
npm run dev

# Ou separadamente:
cd backend && npm run dev   # http://localhost:3001
cd frontend && npm run dev  # http://localhost:5173
```

## Testes

```bash
cd backend && npm test
```

## Estrutura do projeto

```
escalaTati/
├── backend/
│   ├── src/
│   │   ├── app.js                    # Express app (sem listen)
│   │   ├── index.js                  # Entry point (listen)
│   │   ├── db/database.js            # SQLite schema + seed
│   │   ├── routes/                   # employees, schedules, shift-types, export
│   │   ├── services/                 # scheduleGenerator, exportService
│   │   ├── middleware/errorHandler.js
│   │   └── tests/                    # Vitest + Supertest
│   └── escala.db                     # Banco de dados (não versionado)
└── frontend/
    └── src/
        ├── api/client.js             # Axios + endpoints
        ├── store/useStore.js         # Zustand — estado global
        ├── pages/                    # Schedule, Employees, Settings
        └── components/               # layout, schedule, employees, shared
```

## Variáveis de ambiente

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PORT` | Porta do backend | `3001` |
| `DB_PATH` | Caminho do banco SQLite | `backend/escala.db` |

> Para testes, `DB_PATH=:memory:` é configurado automaticamente pelo `vitest.config.js`.

## Contribuindo

Este projeto usa um time de agentes Claude Code. Veja [CLAUDE.md](./CLAUDE.md) para entender o fluxo de trabalho com Revisor Senior, Desenvolvedor Pleno, Tester Senior e DevOps Senior.
