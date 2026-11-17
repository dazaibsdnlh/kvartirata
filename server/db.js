import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const dataDir = resolve(process.env.DATA_DIR || 'data');
mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(resolve(dataDir, 'app.sqlite'));
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', image TEXT
  );
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    amount INTEGER NOT NULL CHECK(amount >= 0)
  );
  CREATE TABLE IF NOT EXISTS person_services (
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    custom_amount INTEGER CHECK(custom_amount >= 0),
    PRIMARY KEY(person_id, service_id)
  );
  CREATE TABLE IF NOT EXISTS assignment_periods (
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    start_month TEXT NOT NULL, end_month TEXT,
    custom_amount INTEGER CHECK(custom_amount >= 0)
  );
  CREATE INDEX IF NOT EXISTS assignment_period_lookup ON assignment_periods(person_id, service_id, start_month, end_month);
  CREATE TABLE IF NOT EXISTS service_prices (
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    start_month TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount >= 0),
    PRIMARY KEY(service_id, start_month)
  );
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    month TEXT NOT NULL, expected INTEGER NOT NULL CHECK(expected >= 0),
    paid INTEGER NOT NULL CHECK(paid >= 0 AND paid <= expected),
    UNIQUE(person_id, service_id, month)
  );
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, image TEXT
  );
  CREATE TABLE IF NOT EXISTS game_players (
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    games_played INTEGER CHECK(games_played >= 0),
    PRIMARY KEY(game_id, player_id)
  );
  CREATE TABLE IF NOT EXISTS victories (
    id INTEGER PRIMARY KEY, game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    played_on TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
    FOREIGN KEY(game_id, player_id) REFERENCES game_players(game_id, player_id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL
  );
  INSERT OR IGNORE INTO games(slug, name) VALUES ('catan', 'Catan');
`);

if (!db.prepare('PRAGMA table_info(payments)').all().some(column => column.name === 'paid_on')) {
  db.exec('ALTER TABLE payments ADD COLUMN paid_on TEXT');
}

export const all = (sql, ...args) => db.prepare(sql).all(...args);
export const get = (sql, ...args) => db.prepare(sql).get(...args);
export const run = (sql, ...args) => db.prepare(sql).run(...args);
