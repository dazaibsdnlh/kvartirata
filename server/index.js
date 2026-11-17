import express from 'express';
import multer from 'multer';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { all, db, get, run, dataDir } from './db.js';

const app = express();
const port = Number(process.env.PORT || 3001);
const uploadDir = resolve(dataDir, 'uploads');
mkdirSync(uploadDir, { recursive: true });
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use('/uploads', express.static(uploadDir, { dotfiles: 'deny', index: false, maxAge: '1d' }));

const fail = (status, message) => Object.assign(new Error(message), { status });
const text = (value, label, max = 120, optional = false) => {
  if (typeof value !== 'string' || value.trim().length > max || (!optional && !value.trim())) throw fail(400, `Невалидно поле: ${label}.`);
  return value.trim();
};
const id = value => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw fail(400, 'Невалиден идентификатор.');
  return result;
};
const money = value => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100000000) throw fail(400, 'Невалидна сума.');
  return value;
};
const date = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw fail(400, 'Невалидна дата.');
  return value;
};
const month = value => {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw fail(400, 'Невалиден месец.');
  return value;
};
const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const image = value => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(value)) throw fail(400, 'Невалидна снимка.');
  return value;
};
const required = (table, recordId) => {
  const row = get(`SELECT * FROM ${table} WHERE id = ?`, id(recordId));
  if (!row) throw fail(404, 'Записът не е намерен.');
  return row;
};
const hash = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => timingSafeEqual(Buffer.from(hash(a), 'hex'), Buffer.from(hash(b), 'hex'));
const cookie = req => {
  const entry = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('session='));
  return entry ? entry.slice(8) : '';
};
const authenticated = req => {
  const token = cookie(req);
  return /^[a-f0-9]{64}$/.test(token) && !!get('SELECT token_hash FROM sessions WHERE token_hash = ? AND expires > ?', hash(token), Date.now());
};
const requireAdmin = (req, res, next) => {
  if (!authenticated(req)) return next(fail(401, 'Необходим е администраторски достъп.'));
  next();
};
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.get('origin');
    const allowed = new Set([`${req.protocol}://${req.get('host')}`, ...(process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)]);
    if (process.env.NODE_ENV !== 'production') allowed.add('http://127.0.0.1:5173');
    if (!origin || !allowed.has(origin)) return next(fail(403, 'Невалиден произход на заявката.'));
  }
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.path !== '/upload' && req.path !== '/logout' &&
      (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) {
    return next(fail(400, 'Необходимо е валидно съдържание на заявката.'));
  }
  next();
});

const attempts = new Map();
app.post('/api/login', (req, res, next) => {
  try {
    const username = process.env.ADMIN_USERNAME;
    const password = process.env.ADMIN_PASSWORD;
    if (!username || !password || password.length < 12) throw fail(503, 'Администраторският достъп не е настроен. Задайте потребител и парола с поне 12 символа.');
    const key = req.ip;
    const now = Date.now();
    const recent = (attempts.get(key) || []).filter(t => t > now - 15 * 60 * 1000);
    if (recent.length >= 10) throw fail(429, 'Твърде много опити. Опитайте отново след 15 минути.');
    if (typeof req.body.username !== 'string' || typeof req.body.password !== 'string' || !same(req.body.username, username) || !same(req.body.password, password)) {
      recent.push(now); attempts.set(key, recent);
      throw fail(401, 'Невалидно потребителско име или парола.');
    }
    attempts.delete(key);
    const token = randomBytes(32).toString('hex');
    run('DELETE FROM sessions WHERE expires <= ?', now);
    run('INSERT INTO sessions(token_hash, expires) VALUES (?, ?)', hash(token), now + 8 * 60 * 60 * 1000);
    res.cookie('session', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000, path: '/' });
    res.json({ admin: true });
  } catch (error) { next(error); }
});
app.get('/api/session', (req, res) => res.json({ admin: authenticated(req) }));
app.post('/api/logout', requireAdmin, (req, res) => {
  run('DELETE FROM sessions WHERE token_hash = ?', hash(cookie(req)));
  res.clearCookie('session', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/' });
  res.json({ ok: true });
});

app.get('/api/overview', (req, res) => res.json({
  people: get('SELECT COUNT(*) AS count FROM people').count,
  services: get('SELECT COUNT(*) AS count FROM services').count,
  victories: get('SELECT COUNT(*) AS count FROM victories').count
}));
app.get('/api/people', (req, res) => res.json(all('SELECT * FROM people ORDER BY name COLLATE NOCASE, id')));
app.get('/api/services', (req, res) => res.json(all('SELECT * FROM services ORDER BY name COLLATE NOCASE, id')));
app.get('/api/assignments', (req, res) => res.json(all('SELECT * FROM person_services')));
app.get('/api/games', (req, res) => res.json(all('SELECT * FROM games ORDER BY name')));
app.get('/api/games/:slug/players', (req, res, next) => {
  const game = get('SELECT id FROM games WHERE slug = ?', req.params.slug);
  if (!game) return next(fail(404, 'Играта не е намерена.'));
  res.json(all(`SELECT p.*, CASE WHEN ? = 'catan'
    THEN (SELECT COUNT(*) FROM victories WHERE game_id = gp.game_id)
    ELSE gp.games_played END AS games_played, COUNT(v.id) AS wins
    FROM players p JOIN game_players gp ON gp.player_id = p.id
    LEFT JOIN victories v ON v.player_id = p.id AND v.game_id = gp.game_id
    WHERE gp.game_id = ? GROUP BY p.id, gp.game_id, gp.games_played ORDER BY wins DESC, p.name COLLATE NOCASE, p.id`, req.params.slug, game.id));
});
app.get('/api/games/:slug/victories', (req, res, next) => {
  const game = get('SELECT id FROM games WHERE slug = ?', req.params.slug);
  if (!game) return next(fail(404, 'Играта не е намерена.'));
  res.json(all(`SELECT v.*, p.name AS player_name FROM victories v JOIN players p ON p.id = v.player_id
    WHERE v.game_id = ? ORDER BY v.played_on DESC, v.id DESC`, game.id));
});
app.get('/api/payments', (req, res, next) => {
  try {
    const selected = month(req.query.month);
    res.json(all(`WITH pairs AS (
      SELECT person_id, service_id FROM assignment_periods WHERE start_month <= ? AND (end_month IS NULL OR end_month > ?)
      UNION SELECT person_id, service_id FROM payments WHERE month = ?
    )
    SELECT p.id AS person_id, p.name AS person_name, p.image, s.id AS service_id, s.name AS service_name,
      COALESCE(pay.expected, ap.custom_amount, sp.amount) AS expected,
      COALESCE(pay.paid, 0) AS paid, pay.id AS payment_id, pay.paid_on, (ap.id IS NOT NULL) AS assigned
    FROM pairs x JOIN people p ON p.id = x.person_id JOIN services s ON s.id = x.service_id
    LEFT JOIN assignment_periods ap ON ap.id = (SELECT id FROM assignment_periods
      WHERE person_id=x.person_id AND service_id=x.service_id AND start_month <= ? AND (end_month IS NULL OR end_month > ?)
      ORDER BY start_month DESC, id DESC LIMIT 1)
    LEFT JOIN service_prices sp ON sp.service_id=x.service_id AND sp.start_month = (SELECT MAX(start_month) FROM service_prices WHERE service_id=x.service_id AND start_month <= ?)
    LEFT JOIN payments pay ON pay.person_id = x.person_id AND pay.service_id = x.service_id AND pay.month = ?
    ORDER BY p.name COLLATE NOCASE, s.name COLLATE NOCASE`, selected, selected, selected, selected, selected, selected, selected));
  } catch (error) { next(error); }
});

app.use('/api', requireAdmin);
app.post('/api/upload', multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 } }).single('image'), (req, res, next) => {
  try {
    const b = req.file?.buffer;
    if (!b) throw fail(400, 'Изберете снимка.');
    let extension;
    if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) extension = 'jpg';
    else if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) extension = 'png';
    else if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') extension = 'webp';
    else throw fail(400, 'Позволени са само JPG, PNG и WebP снимки.');
    const filename = `${randomBytes(16).toString('hex')}.${extension}`;
    writeFileSync(resolve(uploadDir, filename), b, { flag: 'wx' });
    res.status(201).json({ image: `/uploads/${filename}` });
  } catch (error) { next(error); }
});
app.post('/api/people', (req, res) => {
  const result = run('INSERT INTO people(name, details, image) VALUES (?, ?, ?)', text(req.body.name, 'име'), text(req.body.details || '', 'детайли', 500, true), image(req.body.image));
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});
app.put('/api/people/:id', (req, res) => {
  required('people', req.params.id);
  run('UPDATE people SET name=?, details=?, image=? WHERE id=?', text(req.body.name, 'име'), text(req.body.details || '', 'детайли', 500, true), image(req.body.image), id(req.params.id));
  res.json({ ok: true });
});
app.delete('/api/people/:id', (req, res) => {
  required('people', req.params.id); run('DELETE FROM people WHERE id=?', id(req.params.id)); res.json({ ok: true });
});
app.post('/api/services', (req, res) => {
  const name = text(req.body.name, 'име'), description = text(req.body.description || '', 'описание', 500, true), amount = money(req.body.amount);
  db.exec('BEGIN');
  try {
    const result = run('INSERT INTO services(name, description, amount) VALUES (?, ?, ?)', name, description, amount);
    run('INSERT INTO service_prices(service_id, start_month, amount) VALUES (?, ?, ?)', result.lastInsertRowid, currentMonth(), amount);
    db.exec('COMMIT');
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  } catch (error) { db.exec('ROLLBACK'); throw error; }
});
app.put('/api/services/:id', (req, res) => {
  required('services', req.params.id);
  const name = text(req.body.name, 'име'), description = text(req.body.description || '', 'описание', 500, true), amount = money(req.body.amount), serviceId = id(req.params.id);
  db.exec('BEGIN');
  try {
    run('UPDATE services SET name=?, description=?, amount=? WHERE id=?', name, description, amount, serviceId);
    run('INSERT INTO service_prices(service_id, start_month, amount) VALUES (?, ?, ?) ON CONFLICT(service_id, start_month) DO UPDATE SET amount=excluded.amount', serviceId, currentMonth(), amount);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  res.json({ ok: true });
});
app.delete('/api/services/:id', (req, res) => {
  required('services', req.params.id); run('DELETE FROM services WHERE id=?', id(req.params.id)); res.json({ ok: true });
});
app.put('/api/assignments', (req, res) => {
  const personId = id(req.body.person_id), serviceId = id(req.body.service_id);
  required('people', personId); required('services', serviceId);
  const custom = req.body.custom_amount === null ? null : money(req.body.custom_amount);
  db.exec('BEGIN');
  try {
    run('UPDATE assignment_periods SET end_month=? WHERE person_id=? AND service_id=? AND end_month IS NULL', currentMonth(), personId, serviceId);
    run('INSERT INTO assignment_periods(person_id, service_id, start_month, custom_amount) VALUES (?, ?, ?, ?)', personId, serviceId, currentMonth(), custom);
    run(`INSERT INTO person_services(person_id, service_id, custom_amount) VALUES (?, ?, ?)
      ON CONFLICT(person_id, service_id) DO UPDATE SET custom_amount=excluded.custom_amount`, personId, serviceId, custom);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  res.json({ ok: true });
});
app.delete('/api/assignments/:person/:service', (req, res) => {
  const personId = id(req.params.person), serviceId = id(req.params.service);
  if (!get('SELECT 1 FROM person_services WHERE person_id=? AND service_id=?', personId, serviceId)) throw fail(404, 'Връзката не е намерена.');
  db.exec('BEGIN');
  try {
    run('UPDATE assignment_periods SET end_month=? WHERE person_id=? AND service_id=? AND end_month IS NULL', currentMonth(), personId, serviceId);
    run('DELETE FROM person_services WHERE person_id=? AND service_id=?', personId, serviceId);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  res.json({ ok: true });
});
app.put('/api/payments', (req, res) => {
  const personId = id(req.body.person_id), serviceId = id(req.body.service_id), selected = month(req.body.month);
  const active = get('SELECT 1 FROM person_services WHERE person_id=? AND service_id=?', personId, serviceId);
  const createAssignment = req.body.auto_assign === true && !active;
  const service = createAssignment ? required('services', serviceId) : null;
  if (createAssignment) required('people', personId);
  const existing = get('SELECT * FROM payments WHERE person_id=? AND service_id=? AND month=?', personId, serviceId, selected);
  let assignment = get(`SELECT COALESCE(ap.custom_amount, sp.amount) AS amount FROM assignment_periods ap
    JOIN service_prices sp ON sp.service_id=ap.service_id AND sp.start_month=(SELECT MAX(start_month) FROM service_prices WHERE service_id=ap.service_id AND start_month<=?)
    WHERE ap.person_id=? AND ap.service_id=? AND ap.start_month<=? AND (ap.end_month IS NULL OR ap.end_month>?)
    ORDER BY ap.start_month DESC, ap.id DESC LIMIT 1`, selected, personId, serviceId, selected, selected);
  if (!existing && !assignment && req.body.historical === true && selected < currentMonth()) {
    assignment = get(`SELECT COALESCE(ps.custom_amount, s.amount) AS amount FROM person_services ps
      JOIN services s ON s.id=ps.service_id WHERE ps.person_id=? AND ps.service_id=?`, personId, serviceId);
  }
  if (!existing && !assignment && createAssignment) assignment = { amount: service.amount };
  if (!existing && !assignment) throw fail(400, 'Услугата не е зададена на този човек за избрания месец.');
  const expected = existing ? existing.expected : assignment.amount;
  const paid = money(req.body.paid);
  if (paid > expected) throw fail(400, 'Платената сума не може да надвишава дължимата.');
  const paidOn = paid === 0 ? null : req.body.paid_on === undefined ? existing?.paid_on || null : date(req.body.paid_on);
  db.exec('BEGIN');
  try {
    if (createAssignment) {
      run('INSERT INTO person_services(person_id, service_id, custom_amount) VALUES (?, ?, NULL)', personId, serviceId);
      run('INSERT INTO assignment_periods(person_id, service_id, start_month, custom_amount) VALUES (?, ?, ?, NULL)', personId, serviceId, currentMonth());
    }
    run(`INSERT INTO payments(person_id, service_id, month, expected, paid, paid_on) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(person_id, service_id, month) DO UPDATE SET paid=excluded.paid, paid_on=excluded.paid_on`, personId, serviceId, selected, expected, paid, paidOn);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  res.json({ ok: true });
});
app.post('/api/games/:slug/players', (req, res) => {
  const game = get('SELECT id FROM games WHERE slug=?', req.params.slug);
  if (!game) throw fail(404, 'Играта не е намерена.');
  const name = text(req.body.name, 'име'), picture = image(req.body.image);
  const played = req.params.slug === 'catan' || req.body.games_played === null ? null : money(req.body.games_played);
  db.exec('BEGIN');
  try {
    const result = run('INSERT INTO players(name, image) VALUES (?, ?)', name, picture);
    run('INSERT INTO game_players(game_id, player_id, games_played) VALUES (?, ?, ?)', game.id, result.lastInsertRowid, played);
    db.exec('COMMIT');
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  } catch (error) { db.exec('ROLLBACK'); throw error; }
});
app.put('/api/games/:slug/players/:id', (req, res) => {
  const game = get('SELECT id FROM games WHERE slug=?', req.params.slug);
  if (!game || !get('SELECT 1 FROM game_players WHERE game_id=? AND player_id=?', game.id, id(req.params.id))) throw fail(404, 'Играчът не е намерен.');
  const played = req.params.slug === 'catan' ? null : req.body.games_played === null ? null : money(req.body.games_played);
  const wins = get('SELECT COUNT(*) AS count FROM victories WHERE game_id=? AND player_id=?', game.id, id(req.params.id)).count;
  if (req.params.slug !== 'catan' && played !== null && played < wins) throw fail(400, 'Броят игри не може да е по-малък от победите.');
  const name = text(req.body.name, 'име'), picture = image(req.body.image);
  db.exec('BEGIN');
  try {
    run('UPDATE players SET name=?, image=? WHERE id=?', name, picture, id(req.params.id));
    if (req.params.slug !== 'catan') run('UPDATE game_players SET games_played=? WHERE game_id=? AND player_id=?', played, game.id, id(req.params.id));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  res.json({ ok: true });
});
app.delete('/api/games/:slug/players/:id', (req, res) => {
  const game = get('SELECT id FROM games WHERE slug=?', req.params.slug);
  if (!game) throw fail(404, 'Играта не е намерена.');
  const result = run('DELETE FROM game_players WHERE game_id=? AND player_id=?', game.id, id(req.params.id));
  if (!result.changes) throw fail(404, 'Играчът не е намерен.');
  run('DELETE FROM players WHERE id=? AND NOT EXISTS (SELECT 1 FROM game_players WHERE player_id=?)', id(req.params.id), id(req.params.id));
  res.json({ ok: true });
});
const victoryData = (req, existingId = null) => {
  const game = get('SELECT id FROM games WHERE slug=?', req.params.slug);
  if (!game) throw fail(404, 'Играта не е намерена.');
  const playerId = id(req.body.player_id);
  const player = get('SELECT * FROM game_players WHERE game_id=? AND player_id=?', game.id, playerId);
  if (!player) throw fail(400, 'Изберете валиден играч.');
  const count = get('SELECT COUNT(*) AS count FROM victories WHERE game_id=? AND player_id=? AND id != ?', game.id, playerId, existingId || 0).count;
  if (req.params.slug !== 'catan' && player.games_played !== null && count + 1 > player.games_played) throw fail(400, 'Увеличете броя изиграни игри на играча преди да добавите победа.');
  return [game.id, playerId, date(req.body.played_on), text(req.body.notes || '', 'бележки', 1000, true)];
};
app.post('/api/games/:slug/victories', (req, res) => {
  const result = run('INSERT INTO victories(game_id, player_id, played_on, notes) VALUES (?, ?, ?, ?)', ...victoryData(req));
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});
app.put('/api/games/:slug/victories/:id', (req, res) => {
  const record = required('victories', req.params.id);
  const values = victoryData(req, record.id);
  if (record.game_id !== values[0]) throw fail(404, 'Победата не е намерена.');
  run('UPDATE victories SET game_id=?, player_id=?, played_on=?, notes=? WHERE id=?', ...values, record.id);
  res.json({ ok: true });
});
app.delete('/api/games/:slug/victories/:id', (req, res) => {
  const game = get('SELECT id FROM games WHERE slug=?', req.params.slug);
  if (!game) throw fail(404, 'Играта не е намерена.');
  const result = run('DELETE FROM victories WHERE id=? AND game_id=?', id(req.params.id), game.id);
  if (!result.changes) throw fail(404, 'Победата не е намерена.');
  res.json({ ok: true });
});
app.use('/api', (req, res, next) => next(fail(404, 'Адресът не е намерен.')));
app.use(express.static(resolve('dist')));
app.get('/{*path}', (req, res, next) => {
  if (extname(req.path)) return next();
  res.sendFile(resolve('dist', 'index.html'), error => { if (error) next(error); });
});
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.code === 'LIMIT_FILE_SIZE' ? 400 : error.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Снимката трябва да е до 3 MB.' : status >= 500 ? 'Възникна грешка в сървъра.' : error.message });
});
app.listen(port, '127.0.0.1', () => console.log(`Квартирата: http://127.0.0.1:${port}`));
