import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';

test('authentication, payments, history and leaderboard', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kvartirata-test-'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let log = '';
  function start() {
    const process = spawn(globalThis.process.execPath, ['server/index.js'], {
      env: { ...globalThis.process.env, PORT: String(port), DATA_DIR: dir, ADMIN_USERNAME: 'tester', ADMIN_PASSWORD: 'a-strong-test-password', NODE_ENV: 'test' },
      stdio: 'pipe'
    });
    process.stderr.on('data', data => { log += data; });
    return process;
  }
  let child = start();
  async function waitForServer() {
    for (let i = 0; i < 80; i++) {
      try { await fetch(`${base}/api/overview`); return; } catch { await delay(100); }
    }
    assert.fail(`Server failed to start: ${log}`);
  }
  let cookie = '';
  async function request(path, method = 'GET', body, options = {}) {
    const headers = { origin: base, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...options.headers };
    const response = await fetch(`${base}/api${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: response.status, data: await response.json() };
  }
  try {
    await waitForServer();
    assert.equal((await request('/people', 'POST', { name: 'Test' })).status, 401);
    assert.equal((await request('/login', 'POST', { username: 'tester', password: 'bad' })).status, 401);
    assert.equal((await request('/login', 'POST', { username: 'tester', password: 'a-strong-test-password' }, { headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await request('/login', 'POST', { username: 'tester', password: 'a-strong-test-password' })).status, 200);
    assert.equal((await request('/people', 'POST')).status, 400);
    const person = (await request('/people', 'POST', { name: 'Ива', details: '', image: null })).data.id;
    const service = (await request('/services', 'POST', { name: 'Интернет', description: '', amount: 2000 })).data.id;
    const newPerson = (await request('/people', 'POST', { name: 'Петър', details: '', image: null })).data.id;
    const invalid = await request('/payments', 'PUT', { person_id: newPerson, service_id: service, month: '2026-01', paid: 2001, paid_on: '2026-01-03', auto_assign: true, historical: true });
    assert.equal(invalid.status, 400);
    assert.equal((await request('/assignments')).data.length, 0);
    assert.equal((await request('/payments', 'PUT', { person_id: newPerson, service_id: service, month: '2026-01', paid: 1000, paid_on: '2026-01-03', auto_assign: true, historical: true })).status, 200);
    assert.equal((await request('/assignments')).data.length, 1);
    assert.equal((await request('/payments?month=2026-01')).data.find(p => p.person_id === newPerson).paid, 1000);
    assert.equal((await request('/assignments', 'PUT', { person_id: person, service_id: service, custom_amount: 1500 })).status, 200);
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonth = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
    assert.equal((await request(`/payments?month=${lastMonth}`)).data.filter(p => p.person_id === person).length, 0);
    assert.equal((await request('/payments', 'PUT', { person_id: person, service_id: service, month: lastMonth, paid: 500, paid_on: '2026-02-30', historical: true })).status, 400);
    assert.equal((await request('/payments', 'PUT', { person_id: person, service_id: service, month: lastMonth, paid: 500, paid_on: '2026-01-03', historical: true })).status, 200);
    assert.equal((await request(`/payments?month=${lastMonth}`)).data.find(p => p.person_id === person).paid_on, '2026-01-03');
    let rows = (await request(`/payments?month=${month}`)).data;
    assert.equal(rows.find(p => p.person_id === person).expected, 1500);
    assert.equal((await request('/payments', 'PUT', { person_id: person, service_id: service, month, paid: 500 })).status, 200);
    assert.equal((await request('/payments', 'PUT', { person_id: person, service_id: service, month, paid: 1600 })).status, 400);
    assert.equal((await request('/payments', 'PUT', { person_id: person, service_id: service, month, paid: 1500, paid_on: '2026-02-01' })).status, 200);
    await request('/assignments', 'PUT', { person_id: person, service_id: service, custom_amount: 1800 });
    rows = (await request(`/payments?month=${month}`)).data;
    assert.equal(rows.filter(p => p.person_id === person).length, 1);
    assert.equal(rows.find(p => p.person_id === person).expected, 1500);
    assert.equal(rows.find(p => p.person_id === person).paid, 1500);
    assert.equal(rows.find(p => p.person_id === person).paid_on, '2026-02-01');
    await request(`/assignments/${person}/${service}`, 'DELETE');
    rows = (await request(`/payments?month=${month}`)).data;
    assert.equal(rows.filter(p => p.person_id === person).length, 1);
    assert.equal(rows.find(p => p.person_id === person).assigned, 0);
    const first = (await request('/games/catan/players', 'POST', { name: 'Ана', image: null })).data.id;
    const second = (await request('/games/catan/players', 'POST', { name: 'Боби', image: null })).data.id;
    assert.deepEqual((await request('/games/catan/players')).data.map(p => p.games_played), [0, 0]);
    const victory = (await request('/games/catan/victories', 'POST', { player_id: second, played_on: '2026-01-01', notes: '' })).data.id;
    let ranking = (await request('/games/catan/players')).data;
    assert.deepEqual(ranking.map(p => [p.id, p.wins, p.games_played]), [[second, 1, 1], [first, 0, 1]]);
    const another = (await request('/games/catan/victories', 'POST', { player_id: second, played_on: '2026-01-02', notes: '' })).data.id;
    const third = (await request('/games/catan/players', 'POST', { name: 'Вики', image: null })).data.id;
    ranking = (await request('/games/catan/players')).data;
    assert.equal(ranking.find(p => p.id === third).games_played, 2);
    assert.equal(ranking.find(p => p.id === second).wins / ranking.find(p => p.id === second).games_played, 1);
    assert.equal((await request(`/games/catan/players/${first}`, 'PUT', { name: 'Ана', image: null })).status, 200);
    assert.equal((await request(`/games/catan/victories/${victory}`, 'PUT', { player_id: first, played_on: '2026-02-01', notes: 'Победа' })).status, 200);
    ranking = (await request('/games/catan/players')).data;
    assert.equal(ranking.find(p => p.id === first).wins / ranking.find(p => p.id === first).games_played, 0.5);
    assert.ok(ranking.every(p => p.games_played === 2));
    assert.equal((await request(`/games/catan/victories/${another}`, 'DELETE')).status, 200);
    ranking = (await request('/games/catan/players')).data;
    assert.equal(ranking[0].id, first);
    assert.ok(ranking.every(p => p.games_played === 1));
    assert.equal((await request(`/games/catan/victories/${victory}`, 'DELETE')).status, 200);
    assert.ok((await request('/games/catan/players')).data.every(p => p.games_played === 0 && p.wins === 0));
    assert.equal((await request('/overview')).data.victories, 0);
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    child = start();
    await waitForServer();
    assert.ok((await request('/people')).data.some(p => p.name === 'Ива'));
    assert.equal((await request(`/payments?month=${month}`)).data.find(p => p.person_id === person).paid, 1500);
    assert.equal((await request(`/payments?month=${lastMonth}`)).data.find(p => p.person_id === person).paid_on, '2026-01-03');
    assert.equal((await request('/session')).data.admin, true);
    assert.equal((await request('/logout', 'POST')).status, 200);
    assert.equal((await request(`/people/${person}`, 'DELETE')).status, 401);
  } finally {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
