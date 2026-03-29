import express from 'express';
import cors from 'cors';
import { initDb } from './db/database.js';
import employeesRouter from './routes/employees.js';
import shiftTypesRouter from './routes/shiftTypes.js';
import schedulesRouter from './routes/schedules.js';
import exportRouter from './routes/export.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

const PORT = process.env.PORT || 3001;
const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5175', credentials: true }));
app.use(express.json());

app.use('/api/employees', employeesRouter);
app.use('/api/shift-types', shiftTypesRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/export', exportRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(notFound);
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
