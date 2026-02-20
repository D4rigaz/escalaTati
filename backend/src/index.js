import express from 'express';
import cors from 'cors';
import { getDb } from './db/database.js';
import employeesRouter from './routes/employees.js';
import shiftTypesRouter from './routes/shiftTypes.js';
import schedulesRouter from './routes/schedules.js';
import exportRouter from './routes/export.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

const PORT = process.env.PORT || 3001;
const app = express();

// Middlewares
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());

// Initialize DB on startup
getDb();

// Routes
app.use('/api/employees', employeesRouter);
app.use('/api/shift-types', shiftTypesRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/export', exportRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 + Error handling
app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`✅ Escala Trabalho API running at http://localhost:${PORT}`);
});
