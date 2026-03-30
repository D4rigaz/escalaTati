import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { initDb } from './db/database.js';
import employeesRouter from './routes/employees.js';
import shiftTypesRouter from './routes/shiftTypes.js';
import schedulesRouter from './routes/schedules.js';
import exportRouter from './routes/export.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json());

app.use('/api/employees', employeesRouter);
app.use('/api/shift-types', shiftTypesRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/export', exportRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 para rotas /api/* não encontradas
app.use('/api', notFound);

// Em produção: serve o frontend buildado (SPA)
if (process.env.NODE_ENV === 'production') {
  const frontendDist = join(__dirname, '..', '..', 'frontend', 'dist');
  if (existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*', (_req, res) => res.sendFile(join(frontendDist, 'index.html')));
  }
}

app.use(errorHandler);

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Escala Trabalho API running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Failed to initialize DB:', err);
    process.exit(1);
  });
