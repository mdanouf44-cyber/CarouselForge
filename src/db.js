import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_DIR = path.join(__dirname, '../data');
const DB_PATH = path.join(DB_DIR, 'db.json');

// Initialize database file
export function initDb() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ history: [], cache: {} }, null, 2), 'utf8');
  }
}

// Read database
export function readDb() {
  initDb();
  try {
    const content = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error('Failed to read db.json:', err);
    return { history: [], cache: {} };
  }
}

// Write database
export function writeDb(data) {
  initDb();
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write db.json:', err);
  }
}

// Add run to history
export function addHistoryEntry(entry) {
  const db = readDb();
  db.history.push({
    id: entry.id || new Date().toISOString(),
    timestamp: Date.now(),
    timeSlot: entry.timeSlot,
    status: entry.status, // 'pending', 'approved', 'rejected'
    angle: entry.angle,
    slides: entry.slides,
    imagePaths: entry.imagePaths || [],
    linkedin_post: entry.linkedin_post || ''
  });
  writeDb(db);
}

// Get history
export function getHistory() {
  const db = readDb();
  return db.history || [];
}

// Update history entry status
export function updateHistoryStatus(id, status, extraFields = {}) {
  const db = readDb();
  const index = db.history.findIndex(h => h.id === id);
  if (index !== -1) {
    db.history[index].status = status;
    db.history[index] = { ...db.history[index], ...extraFields };
    writeDb(db);
    return true;
  }
  return false;
}
