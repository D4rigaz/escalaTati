import express from 'express';
import cors from 'cors';
import employeesRouter from './routes/employees.js';
import shiftTypesRouter from './routes/shiftTypes.js';
import schedulesRouter from './routes/schedules.js';
import exportRouter from './routes/export.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

const app = express();

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
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

export default app;
