import { getDb } from './db/database.js';
import app from './app.js';

const PORT = process.env.PORT || 3001;

getDb(); // Initialize DB on startup

app.listen(PORT, () => {
  console.log(`✅ Escala Trabalho API running at http://localhost:${PORT}`);
});
