// Jednorazowa migracja historii ze starej bazy Oracle (Python) do chat_history.db tego bota.
// Użycie: node migrate-oracle.js "<ścieżka do starego chat_history.db>"
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const src = process.argv[2];
if (!src) { console.error('Podaj ścieżkę do starej bazy.'); process.exit(1); }

const dest = new DatabaseSync(path.join(__dirname, 'chat_history.db'));
dest.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   INTEGER NOT NULL,
    channel_id  TEXT    NOT NULL,
    author_id   TEXT,
    author      TEXT    NOT NULL,
    content     TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_channel_ts ON messages (channel_id, timestamp);
`);
if (dest.prepare('SELECT COUNT(*) c FROM messages').get().c > 0 && !process.argv.includes('--force')) {
  console.error('Docelowa baza ma już wiadomości – migracja przerwana (użyj --force, żeby dopisać mimo to).');
  process.exit(1);
}

const old = new DatabaseSync(src, { readOnly: true });
const select = old.prepare('SELECT timestamp, channel_id, author, content FROM messages ORDER BY id');
select.setReadBigInts(true);
const insert = dest.prepare('INSERT INTO messages (timestamp, channel_id, author_id, author, content) VALUES (?, ?, NULL, ?, ?)');

// "2026-07-23 20:38:26.322000+00:00" -> ms; brak strefy = UTC (tak zapisywał stary bot)
const toMs = (s) => {
  let iso = String(s).replace(' ', 'T').replace(/(\.\d{3})\d*/, '$1');
  if (!/(Z|[+-]\d\d:\d\d)$/.test(iso)) iso += 'Z';
  return Date.parse(iso);
};

let n = 0, bad = 0;
dest.exec('BEGIN');
for (const r of select.all()) {
  const ts = toMs(r.timestamp);
  if (Number.isNaN(ts)) { bad++; continue; }
  insert.run(ts, String(r.channel_id), r.author, r.content);
  n++;
}
dest.exec('COMMIT');
console.log(`Zmigrowano: ${n}, pominięto (zły czas): ${bad}`);
