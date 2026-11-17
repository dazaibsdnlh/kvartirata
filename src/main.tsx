import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronLeft, ChevronRight, Crown, Gamepad2, LayoutDashboard, LockKeyhole, LogOut, Menu, Pencil, Plus, Search, Settings2, ShieldCheck, Sparkles, Trash2, Trophy, Users, WalletCards, X } from 'lucide-react';
import './styles.css';
import './design.css';
import './royal-theme.css';

type Person = { id: number; name: string; details: string; image: string | null };
type Service = { id: number; name: string; description: string; amount: number };
type Assignment = { person_id: number; service_id: number; custom_amount: number | null };
type Payment = { person_id: number; person_name: string; image: string | null; service_id: number; service_name: string; expected: number; paid: number; payment_id: number | null; paid_on: string | null; assigned: number };
type PaymentMonth = { month: string; rows: Payment[] };
type Player = { id: number; name: string; image: string | null; games_played: number | null; wins: number };
type Victory = { id: number; player_id: number; player_name: string; played_on: string; notes: string };
type Overview = { people: number; services: number; victories: number };
type Section = 'overview' | 'payments' | 'people' | 'services' | 'games' | 'victories';
type Notice = { text: string; error: boolean } | null;

const currency = (cents: number) => new Intl.NumberFormat('bg-BG', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const toCents = (value: string) => {
  const parsed = Number(value.replace(',', '.'));
  if (!value.trim() || !Number.isFinite(parsed) || parsed < 0 || !/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) throw new Error('Въведете валидна сума с до два знака след десетичната запетая.');
  return Math.round(parsed * 100);
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const currentMonth = () => today().slice(0, 7);
const recentMonths = () => Array.from({ length: 12 }, (_, index) => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - index, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
});
const loadPaymentHistory = () => Promise.all(recentMonths().map(async month => ({ month, rows: await api<Payment[]>(`/payments?month=${month}`) })));
const displayMonth = (value: string) => new Intl.DateTimeFormat('bg-BG', { month: 'long', year: 'numeric' }).format(new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, 1));
const shortDate = (value: string) => new Intl.DateTimeFormat('bg-BG', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00`));

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, { ...options, headers });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Възникна грешка.');
  return result as T;
}
const send = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

function Avatar({ name, image, large = false }: { name: string; image: string | null; large?: boolean }) {
  return <span className={`avatar ${large ? 'avatar-large' : ''}`}>{image ? <img src={image} alt="" /> : name.trim().charAt(0).toUpperCase() || '?'}</span>;
}
function Empty({ title, text }: { title: string; text: string }) {
  return <div className="empty"><Sparkles size={20} /><strong>{title}</strong><span>{text}</span></div>;
}
function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={close}><div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={e => e.stopPropagation()}><div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={close} aria-label="Затвори"><X size={19} /></button></div>{children}</div></div>;
}
function ImageInput({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true); setError('');
    try { const data = new FormData(); data.append('image', file); const result = await api<{ image: string }>('/upload', { method: 'POST', body: data }); onChange(result.image); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="image-input"><Avatar name="?" image={value} /><div><label className="upload-link">{busy ? 'Качване...' : 'Избери снимка'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => void upload(e.target.files?.[0])} /></label>{value && <button type="button" className="text-button muted" onClick={() => onChange(null)}>Премахни</button>}<small>JPG, PNG или WebP · до 3 MB</small>{error && <small className="error-text">{error}</small>}</div></div>;
}
function App() {
  const [path, setPath] = useState(location.pathname);
  const [admin, setAdmin] = useState(false);
  const [section, setSection] = useState<Section>('overview');
  const [modal, setModal] = useState<string | null>(null);
  const [edit, setEdit] = useState<Person | Service | Player | Victory | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<Overview>({ people: 0, services: 0, victories: 0 });
  const [people, setPeople] = useState<Person[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [victories, setVictories] = useState<Victory[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<PaymentMonth[]>([]);
  const [paymentEdit, setPaymentEdit] = useState<{ payment: Payment; month: string } | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [personFilter, setPersonFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);

  function navigate(url: string) { history.pushState({}, '', url); setPath(url); setMobileMenu(false); window.scrollTo(0, 0); }
  useEffect(() => { const onPop = () => setPath(location.pathname); window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop); }, []);
  useEffect(() => { api<{ admin: boolean }>('/session').then(v => setAdmin(v.admin)).catch(e => setNotice({ text: e.message, error: true })); }, []);
  async function refresh() {
    const [o, p, s, a, pl, v, pay, history] = await Promise.all([
      api<Overview>('/overview'), api<Person[]>('/people'), api<Service[]>('/services'), api<Assignment[]>('/assignments'),
      api<Player[]>('/games/catan/players'), api<Victory[]>('/games/catan/victories'), api<Payment[]>(`/payments?month=${selectedMonth}`), loadPaymentHistory()
    ]);
    setOverview(o); setPeople(p); setServices(s); setAssignments(a); setPlayers(pl); setVictories(v); setPayments(pay); setPaymentHistory(history);
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([api<Overview>('/overview'), api<Person[]>('/people'), api<Service[]>('/services'), api<Assignment[]>('/assignments'), api<Player[]>('/games/catan/players'), api<Victory[]>('/games/catan/victories'), api<Payment[]>(`/payments?month=${selectedMonth}`), loadPaymentHistory()])
      .then(([o, p, s, a, pl, v, pay, history]) => { if (active) { setOverview(o); setPeople(p); setServices(s); setAssignments(a); setPlayers(pl); setVictories(v); setPayments(pay); setPaymentHistory(history); } })
      .catch(e => { if (active) setNotice({ text: e.message, error: true }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedMonth]);
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(null), 5000); return () => clearTimeout(timer); } }, [notice]);
  async function action(operation: () => Promise<unknown>, message = 'Промените са запазени.') {
    try { await operation(); await refresh(); setModal(null); setEdit(null); setNotice({ text: message, error: false }); }
    catch (e) { setNotice({ text: (e as Error).message, error: true }); }
  }
  function open(type: string, item: Person | Service | Player | Victory | null = null) { setEdit(item); setModal(type); }
  function remove(path: string, label: string) {
    if (window.confirm(`Сигурни ли сте, че искате да изтриете ${label}? Действието не може да бъде отменено.`)) void action(() => api(path, send('DELETE')), 'Записът е изтрит.');
  }
  const status = (p: Payment) => p.paid >= p.expected ? 'paid' : p.paid > 0 ? 'partial' : 'unpaid';
  const matchesFilters = (p: Payment) => (!personFilter || String(p.person_id) === personFilter) && (!serviceFilter || String(p.service_id) === serviceFilter) && (!statusFilter || status(p) === statusFilter);
  const filtered = useMemo(() => payments.filter(p => (!personFilter || String(p.person_id) === personFilter) && (!serviceFilter || String(p.service_id) === serviceFilter) && (!statusFilter || status(p) === statusFilter)), [payments, personFilter, serviceFilter, statusFilter]);
  const totals = filtered.reduce((acc, p) => ({ expected: acc.expected + p.expected, paid: acc.paid + p.paid }), { expected: 0, paid: 0 });
  function changeMonth(delta: number) {
    const d = new Date(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7)) - 1 + delta, 1);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  function openPayment(payment: Payment | null, month = selectedMonth) {
    setPaymentEdit(payment ? { payment, month } : null);
    setModal('payment');
  }

  const adminPaymentView = <div className="content-page">
    <div className="page-heading"><div><div className="eyebrow"><span className="dot" /> ФИНАНСИ</div><h1>Плащания<span className="accent">.</span></h1><p>Всичко за месечните разходи, на едно място.</p></div><div className="payment-heading-actions">{admin ? <button className="button primary" onClick={() => openPayment(null)}><Plus size={16} /> Отбележи плащане</button> : <button className="button secondary" onClick={() => open('login')}><LockKeyhole size={16} /> Влез, за да отбелязваш</button>}<div className="month-picker"><button className="icon-btn" onClick={() => changeMonth(-1)} aria-label="Предишен месец"><ChevronLeft size={18} /></button><label><input aria-label="Избери месец" type="month" value={selectedMonth} onChange={e => { if (e.target.value) setSelectedMonth(e.target.value); }} /><span>{displayMonth(selectedMonth)}</span></label><button className="icon-btn" onClick={() => changeMonth(1)} aria-label="Следващ месец"><ChevronRight size={18} /></button></div></div></div>
    <div className="summary-grid"><div className="summary-card"><span>ОЧАКВАНИ ПЛАЩАНИЯ</span><strong>{currency(totals.expected)}</strong><small><WalletCards size={14} /> Общо за избрания период</small></div><div className="summary-card"><span>ПОЛУЧЕНИ</span><strong>{currency(totals.paid)}</strong><small className="positive"><ArrowDownLeft size={14} /> Постъпили средства</small></div><div className="summary-card"><span>ОСТАВАТ</span><strong>{currency(totals.expected - totals.paid)}</strong><small className="warning"><ArrowUpRight size={14} /> Неплатен остатък</small></div></div>
    <div className="panel table-panel"><div className="panel-title"><div><h2>Месечен преглед</h2><p>Проследявай всяко плащане и неговия статус.</p></div><span className="count-pill">{filtered.length} записа</span></div>
      <div className="filters"><div className="filter-label"><Search size={16} /> Филтри</div><select aria-label="Филтър по човек" value={personFilter} onChange={e => setPersonFilter(e.target.value)}><option value="">Всички хора</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><select aria-label="Филтър по услуга" value={serviceFilter} onChange={e => setServiceFilter(e.target.value)}><option value="">Всички услуги</option>{services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><select aria-label="Филтър по статус" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">Всички статуси</option><option value="paid">Платено</option><option value="partial">Частично</option><option value="unpaid">Неплатено</option></select></div>
      {filtered.length ? <div className="table-scroll"><table><thead><tr><th>ЧОВЕК</th><th>УСЛУГА</th><th>ДЪЛЖИМО</th><th>ПЛАТЕНО</th><th>ДАТА</th><th>СТАТУС</th>{admin && <th>ДЕЙСТВИЯ</th>}</tr></thead><tbody>{filtered.map(p => <tr key={`${p.person_id}-${p.service_id}`}><td><div className="person-cell"><Avatar name={p.person_name} image={p.image} /><strong>{p.person_name}</strong></div></td><td>{p.service_name}{!p.assigned && <small className="inline-note"> · архив</small>}</td><td>{currency(p.expected)}</td><td>{currency(p.paid)}</td><td>{p.paid_on ? shortDate(p.paid_on) : p.paid > 0 ? 'Не е посочена' : '—'}</td><td><span className={`status ${status(p)}`}>{status(p) === 'paid' ? 'Платено' : status(p) === 'partial' ? 'Частично' : 'Неплатено'}</span></td>{admin && <td><button className="small-btn" onClick={() => openPayment(p)}>Отбележи / промени</button></td>}</tr>)}</tbody></table></div> : <Empty title="Все още няма плащания" text="Добавете човек и услуга и ги свържете в управление → Хора → Услуги." />}
    </div><p className="footnote">Сумите в статистиката отразяват избраните филтри. Записаните плащания запазват дължимата сума за съответния месец.</p>
    <div className="section-heading payment-history-heading"><div><div className="eyebrow"><span className="dot" /> ИСТОРИЯ</div><h2>Последните 12 месеца</h2><p>Кой, за какво и кога е платил. Показани са записаните суми по месец.</p></div></div>
    <div className="payment-history-grid">{paymentHistory.map(group => {
      const rows = group.rows.filter(matchesFilters);
      return <section className="payment-history-card panel" key={group.month}><div className="payment-history-title"><strong>{displayMonth(group.month)}</strong><span>{rows.length} записа</span></div>{rows.length ? rows.map(p => <div className="payment-history-item" key={`${p.person_id}-${p.service_id}`}><Avatar name={p.person_name} image={p.image} /><div className="payment-history-info"><strong>{p.person_name}</strong><small>{p.service_name} · {p.paid_on ? shortDate(p.paid_on) : p.paid > 0 ? 'Без дата' : 'Неплатено'}</small></div><div className="payment-history-amount"><strong>{currency(p.paid)}</strong><small>{status(p) === 'paid' ? 'Платено' : status(p) === 'partial' ? 'Частично' : 'Неплатено'}</small></div>{admin && <button className="icon-btn" aria-label={`Промени плащане: ${p.person_name}, ${p.service_name}, ${displayMonth(group.month)}`} onClick={() => openPayment(p, group.month)}><Pencil size={15} /></button>}</div>) : <p className="payment-history-empty">Няма данни за този месец.</p>}</section>;
    })}</div>
  </div>;

  const publicPayments = <div className="content-page public-payments">
    <div className="public-payment-hero">
      <div><div className="eyebrow"><span className="dot" /> МЕСЕЧНИ РАЗХОДИ</div><h1>Плащания<span className="accent">.</span></h1><p>Всички месеци и хора на едно място. Виж с един поглед кой е платил.</p></div>
      <div className="public-payment-hero-icon"><WalletCards size={38} /></div>
    </div>
    <div className="section-heading payment-history-heading"><div><div className="eyebrow"><span className="dot" /> МЕСЕЧЕН ПРЕГЛЕД</div><h2>Последните 12 месеца</h2><p>Месеците по редове, хората по колони. Виж статуса на всяка услуга.</p></div></div>
    {people.length ? <div className="panel payment-matrix-panel"><div className="table-scroll" tabIndex={0} role="region" aria-label="Таблица с месечните плащания"><table className="payment-matrix"><thead><tr><th scope="col">МЕСЕЦ</th>{people.map(person => <th scope="col" key={person.id}><span className="matrix-person"><Avatar name={person.name} image={person.image} /><span>{person.name}</span></span></th>)}</tr></thead><tbody>{paymentHistory.map(group => <tr key={group.month}><th scope="row">{displayMonth(group.month)}</th>{people.map(person => {
      const entries = group.rows.filter(p => p.person_id === person.id);
      return <td key={person.id}>{entries.length ? <div className="matrix-services">{entries.map(p => <div className="matrix-service" key={p.service_id}><span className="matrix-service-name">{p.service_name}</span><span className={`status ${status(p)}`}>{status(p) === 'paid' ? 'Платено' : status(p) === 'partial' ? 'Частично' : 'Неплатено'}</span></div>)}</div> : <span className="matrix-empty">Няма данни</span>}</td>;
    })}</tr>)}</tbody></table></div></div> : <div className="panel"><Empty title="Все още няма добавени хора" text="След добавянето им тук ще се показва месечният преглед." /></div>}
    <p className="footnote">Статусът се показва отделно за всяка услуга. „Частично“ означава, че е платена само част от дължимата сума. „Няма данни“ означава, че няма зададена услуга или запис за този месец.</p>
  </div>;

  const paymentView = path === '/admin' ? adminPaymentView : publicPayments;

  const catanView = <div className="content-page catan-page">
    <div className="catan-hero"><div className="catan-hero-copy"><div className="eyebrow gold-text"><span className="dot gold-dot" /> ВЕЧЕР ЗА ИГРИ</div><h1>Легендите на<br /><em>Catan.</em></h1><p>Островът помни всяка победа. Събери компанията, хвърли заровете и остави следа в историята.</p><div className="hero-meta"><span><Trophy size={16} /> {overview.victories} победи</span><span><Users size={16} /> {players.length} играчи</span></div></div><div className="island-art" aria-hidden="true"><div className="island-orbit orbit-one" /><div className="island-orbit orbit-two" /><div className="hex hex-one">✦</div><div className="hex hex-two">♠</div><div className="hex hex-three">♟</div><div className="hex hex-four">✳</div><div className="hex hex-five">◆</div><div className="island-label">ОСТРОВЪТ<br /><b>CATAN</b></div></div></div>
    <div className="section-heading"><div><div className="eyebrow"><span className="dot" /> ЗАЛАТА НА СЛАВАТА</div><h2>Класация на играчите</h2><p>Подредени по брой заслужени победи.</p></div>{admin && <button className="button secondary" onClick={() => open('victory')}><Plus size={16} /> Добави победа</button>}</div>
    {players.length ? <>
      <div className={`podium ${players.length >= 4 ? 'podium-four' : ''}`} aria-label="Почетен подиум">
        {players.slice(0, 4).map((player, index) => <div className={`podium-player podium-place-${index + 1}`} key={player.id}>
          <div className="podium-profile">
            {index === 0 && <Crown className="podium-crown" size={31} aria-label="Първо място" />}
            <div className="podium-avatar"><Avatar name={player.name} image={player.image} large /><span className="podium-medal">{index + 1}</span></div>
            <strong className="podium-name" title={player.name}>{player.name}</strong>
            <span className="podium-wins"><Trophy size={14} /> {player.wins} {player.wins === 1 ? 'победа' : 'победи'}</span>
            <span className="podium-rate">{player.games_played !== null ? (player.games_played ? `${player.games_played} игри · ${Math.round(player.wins / player.games_played * 100)}% успеваемост` : '0 изиграни игри') : '\u00a0'}</span>
          </div>
          <div className="podium-step" aria-hidden="true"><span>0{index + 1}</span><small>{index === 0 ? 'ШАМПИОН' : index === 1 ? 'ВТОРО МЯСТО' : index === 2 ? 'ТРЕТО МЯСТО' : 'ЧЕТВЪРТО МЯСТО'}</small></div>
        </div>)}
      </div>
      {players.length > 4 && <div className="leaderboard remaining-players"><h3>Още играчи</h3>{players.slice(4).map((p, index) => <div className="leader-row" key={p.id}><div className="rank-number">{String(index + 5).padStart(2, '0')}</div><Avatar name={p.name} image={p.image} large /><div className="leader-name"><strong>{p.name}</strong><small>{p.games_played === null ? 'Играч на Catan' : `${p.games_played} изиграни игри`}</small></div><div className="leader-stat"><strong>{p.wins}</strong><small>ПОБЕДИ</small></div><div className="leader-stat rate"><strong>{p.games_played ? `${Math.round(p.wins / p.games_played * 100)}%` : '—'}</strong><small>УСПЕВАЕМОСТ</small></div><ArrowUpRight className="leader-arrow" size={18} /></div>)}</div>}
    </> : <Empty title="Островът очаква своите играчи" text="Администраторът може да добави първите играчи." />}
    <div className="section-heading history-heading"><div><div className="eyebrow"><span className="dot" /> ХРОНИКИ</div><h2>Последни победи</h2><p>Историите зад всяко първо място.</p></div></div>
    <div className="panel history-list">{victories.length ? victories.slice(0, 8).map(v => <div className="history-row" key={v.id}><div className="history-icon"><Trophy size={17} /></div><div><strong>{v.player_name}</strong><p>{v.notes || 'Победа в Catan'}</p></div><time>{shortDate(v.played_on)}</time></div>) : <Empty title="Все още няма записани победи" text="Първата игра тепърва предстои." />}</div>
  </div>;

  const adminNav: { key: Section; label: string; icon: typeof Users }[] = [{ key: 'overview', label: 'Преглед', icon: LayoutDashboard }, { key: 'payments', label: 'Плащания', icon: WalletCards }, { key: 'people', label: 'Хора', icon: Users }, { key: 'services', label: 'Услуги', icon: Settings2 }, { key: 'games', label: 'Игри и играчи', icon: Gamepad2 }, { key: 'victories', label: 'Победи', icon: Trophy }];
  const adminView = !admin ? <div className="auth-required"><LockKeyhole size={32} /><h1>Администраторска зона</h1><p>Влезте в профила си, за да управлявате съдържанието.</p><button className="button primary" onClick={() => open('login')}>Вход за администратор <ArrowRight size={16} /></button></div> :
    <div className="admin-layout"><aside className="admin-sidebar"><div className="sidebar-heading">УПРАВЛЕНИЕ</div>{adminNav.map(n => <button key={n.key} className={section === n.key ? 'active' : ''} onClick={() => setSection(n.key)}><n.icon size={17} />{n.label}</button>)}<div className="sidebar-bottom"><ShieldCheck size={16} /> Защитена сесия</div></aside><div className="admin-main">
      {section === 'payments' ? paymentView : section === 'overview' ? <><div className="page-heading"><div><div className="eyebrow"><span className="dot" /> АДМИНИСТРАТОР</div><h1>Добре дошли<span className="accent">.</span></h1><p>Ето какво се случва в квартирата.</p></div></div><div className="summary-grid"><div className="summary-card"><span>ХОРА</span><strong>{overview.people}</strong><small>Регистрирани хора</small></div><div className="summary-card"><span>УСЛУГИ</span><strong>{overview.services}</strong><small>Проследявани услуги</small></div><div className="summary-card"><span>ПОБЕДИ</span><strong>{overview.victories}</strong><small>Записани победи</small></div></div><div className="panel quick-panel"><h2>Бързи действия</h2><p>Изберете откъде да започнете.</p><div className="quick-actions"><button onClick={() => open('person')}><Users size={19} /> Добави човек <ArrowRight size={16} /></button><button onClick={() => open('service')}><Settings2 size={19} /> Добави услуга <ArrowRight size={16} /></button><button onClick={() => open('victory')}><Trophy size={19} /> Запиши победа <ArrowRight size={16} /></button></div></div></> :
      <><div className="page-heading"><div><div className="eyebrow"><span className="dot" /> УПРАВЛЕНИЕ</div><h1>{section === 'people' ? 'Хора' : section === 'services' ? 'Услуги' : section === 'games' ? 'Игри и играчи' : 'Победи'}<span className="accent">.</span></h1><p>{section === 'people' ? 'Хората и услугите, които ползват.' : section === 'services' ? 'Управлявайте месечните услуги и цени.' : section === 'games' ? 'Управлявайте играчите на Catan.' : 'Записвайте и редактирайте историята на игрите.'}</p></div><button className="button primary" onClick={() => open(section === 'people' ? 'person' : section === 'services' ? 'service' : section === 'games' ? 'player' : 'victory')}><Plus size={17} /> {section === 'people' ? 'Добави човек' : section === 'services' ? 'Добави услуга' : section === 'games' ? 'Добави играч' : 'Добави победа'}</button></div>
        <div className="panel management-list">
          {section === 'people' && (people.length ? people.map(p => <div className="management-row" key={p.id}><Avatar name={p.name} image={p.image} /><div className="item-info"><strong>{p.name}</strong><small>{p.details || 'Без допълнителни детайли'} · {assignments.filter(a => a.person_id === p.id).length} услуги</small></div><button className="small-btn" onClick={() => open('assignment', p)}>Услуги</button><button className="icon-btn" aria-label={`Редактирай ${p.name}`} onClick={() => open('person', p)}><Pencil size={16} /></button><button className="icon-btn danger" aria-label={`Изтрий ${p.name}`} onClick={() => remove(`/people/${p.id}`, 'този човек и всички негови плащания')}><Trash2 size={16} /></button></div>) : <Empty title="Няма добавени хора" text="Добавете човек, за да започнете." />)}
          {section === 'services' && (services.length ? services.map(s => <div className="management-row" key={s.id}><div className="item-icon"><Settings2 size={18} /></div><div className="item-info"><strong>{s.name}</strong><small>{s.description || 'Без описание'}</small></div><strong>{currency(s.amount)}</strong><button className="icon-btn" aria-label={`Редактирай ${s.name}`} onClick={() => open('service', s)}><Pencil size={16} /></button><button className="icon-btn danger" aria-label={`Изтрий ${s.name}`} onClick={() => remove(`/services/${s.id}`, 'тази услуга и всички нейни плащания')}><Trash2 size={16} /></button></div>) : <Empty title="Няма добавени услуги" text="Добавете първата месечна услуга." />)}
          {section === 'games' && (players.length ? players.map(p => <div className="management-row" key={p.id}><Avatar name={p.name} image={p.image} /><div className="item-info"><strong>{p.name}</strong><small>Catan · {p.wins} победи{p.games_played !== null ? ` · ${p.games_played} игри` : ''}</small></div><button className="icon-btn" aria-label={`Редактирай ${p.name}`} onClick={() => open('player', p)}><Pencil size={16} /></button><button className="icon-btn danger" aria-label={`Изтрий ${p.name}`} onClick={() => remove(`/games/catan/players/${p.id}`, 'този играч и неговите победи')}><Trash2 size={16} /></button></div>) : <Empty title="Няма добавени играчи" text="Добавете първия играч на Catan." />)}
          {section === 'victories' && (victories.length ? victories.map(v => <div className="management-row" key={v.id}><div className="item-icon gold-text"><Trophy size={18} /></div><div className="item-info"><strong>{v.player_name}</strong><small>{shortDate(v.played_on)}{v.notes ? ` · ${v.notes}` : ''}</small></div><button className="icon-btn" aria-label={`Редактирай победата на ${v.player_name}`} onClick={() => open('victory', v)}><Pencil size={16} /></button><button className="icon-btn danger" aria-label={`Изтрий победата на ${v.player_name}`} onClick={() => remove(`/games/catan/victories/${v.id}`, 'тази победа')}><Trash2 size={16} /></button></div>) : <Empty title="Няма записани победи" text="Добавете първата победа." />)}
        </div></>}
    </div></div>;

  return <><header className="site-header"><div className="header-inner"><a href="/" className="brand" onClick={e => { e.preventDefault(); navigate('/'); }}><span className="brand-mark">К<span>.</span></span><span>квартирата<small>НАШЕТО МЯСТО</small></span></a><nav className={mobileMenu ? 'nav-open' : ''}><a href="/" className={path === '/' ? 'active' : ''} onClick={e => { e.preventDefault(); navigate('/'); }}>Начало</a><a href="/payments" className={path === '/payments' ? 'active' : ''} onClick={e => { e.preventDefault(); navigate('/payments'); }}>Плащания</a><a href="/catan" className={path === '/catan' ? 'active' : ''} onClick={e => { e.preventDefault(); navigate('/catan'); }}>Catan</a></nav><div className="header-actions">{admin ? <><button className="header-admin" aria-label="Управление" onClick={() => navigate('/admin')}><ShieldCheck size={16} /> <span>Управление</span></button><button className="icon-btn" title="Изход" aria-label="Изход" onClick={() => void action(async () => { await api('/logout', send('POST')); setAdmin(false); if (path === '/admin') navigate('/'); }, 'Излязохте от профила си.')}><LogOut size={17} /></button></> : <button className="header-admin" aria-label="Админ вход" onClick={() => open('login')}><LockKeyhole size={15} /> <span>Админ вход</span></button>}<button className="menu-toggle icon-btn" aria-label="Меню" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={21} /></button></div></div></header>
    <main>{path === '/' ? <div className="home content-page"><div className="home-intro"><div className="eyebrow"><span className="dot" /> НАШЕТО МЯСТО, НАШИТЕ ПРАВИЛА</div><h1>Всичко е по-добре<br /><span>заедно.</span></h1><p>Малките неща, които правят общия живот по-лесен. И големите победи, които си струва да помним.</p><div className="intro-line"><span /> ДОБРЕ ДОШЛИ В КВАРТИРАТА</div></div><div className="home-cards"><a className="feature-card payment-feature" href="/payments" onClick={e => { e.preventDefault(); navigate('/payments'); }}><div className="feature-top"><span className="feature-icon"><WalletCards size={25} /></span><span className="feature-number">01 / ФИНАНСИ</span></div><div className="feature-body"><span className="feature-tag">ПОДРЕДЕНО И ЯСНО</span><h2>Плащания<span>.</span></h2><p>Управлявай хора, услуги и месечни плащания без излишно главоболие.</p><span className="feature-link">Отвори плащанията <ArrowRight size={17} /></span></div><div className="card-decoration circle-decoration" /></a><a className="feature-card game-feature" href="/catan" onClick={e => { e.preventDefault(); navigate('/catan'); }}><div className="feature-top"><span className="feature-icon"><Trophy size={25} /></span><span className="feature-number">02 / ИГРИ</span></div><div className="feature-body"><span className="feature-tag">НЕКА ПО-ДОБРИЯТ ПОБЕДИ</span><h2>Catan класация<span>.</span></h2><p>Следи играчите, победите и историите зад всяка голяма игра.</p><span className="feature-link">Отвори класацията <ArrowRight size={17} /></span></div><div className="card-decoration hex-decoration" /></a></div><div className="home-stats"><div><span className="eyebrow">КВАРТИРАТА В ЦИФРИ</span><p>Малко статистика, много истории.</p></div><div className="home-stat"><strong>{overview.people.toString().padStart(2, '0')}</strong><span>ХОРА</span></div><div className="home-stat"><strong>{overview.services.toString().padStart(2, '0')}</strong><span>УСЛУГИ</span></div><div className="home-stat"><strong>{overview.victories.toString().padStart(2, '0')}</strong><span>ПОБЕДИ</span></div></div></div> : path === '/payments' ? paymentView : path === '/catan' ? catanView : path === '/admin' ? adminView : <div className="auth-required"><h1>Страницата не е намерена.</h1><button className="button secondary" onClick={() => navigate('/')}><ArrowLeft size={16} /> Към началото</button></div>}</main>
    <footer><div><span className="footer-brand">квартирата<span>.</span></span><span>Създадено за хората и моментите между тях.</span></div><span>ВСИЧКО НА ЕДНО МЯСТО ✳</span></footer>
    {loading && <div className="loading-indicator">Зареждане...</div>}{notice && <div className={`toast ${notice.error ? 'toast-error' : ''}`} role="status">{notice.error ? <X size={17} /> : <Check size={17} />}{notice.text}<button className="icon-btn" onClick={() => setNotice(null)} aria-label="Затвори"><X size={15} /></button></div>}
    {modal && <Modal title={modal === 'login' ? 'Администраторски вход' : modal === 'payment' ? 'Отбелязване на плащане' : modal === 'assignment' ? `Услуги за ${(edit as Person).name}` : `${edit ? 'Редактиране' : 'Добавяне'} на ${modal === 'person' ? 'човек' : modal === 'service' ? 'услуга' : modal === 'player' ? 'играч' : 'победа'}`} close={() => { setModal(null); setEdit(null); }}>
      {modal === 'login' ? <LoginForm onLogin={async (username, password) => { try { await api('/login', send('POST', { username, password })); setAdmin(true); setModal(null); if (path === '/payments') setSection('payments'); navigate('/admin'); setNotice({ text: 'Успешен вход.', error: false }); } catch (e) { setNotice({ text: (e as Error).message, error: true }); } }} /> :
       modal === 'payment' ? <PaymentForm entry={paymentEdit} selectedMonth={selectedMonth} people={people} services={services} assignments={assignments} onSave={data => action(() => api('/payments', send('PUT', data)), 'Плащането е записано.')} /> :
       modal === 'assignment' ? <AssignmentForm person={edit as Person} services={services} assignments={assignments} onSave={(serviceId, custom) => action(() => api('/assignments', send('PUT', { person_id: (edit as Person).id, service_id: serviceId, custom_amount: custom })))} onRemove={serviceId => { if (window.confirm('Премахване на услугата? Записаните плащания ще останат в историята.')) void action(() => api(`/assignments/${(edit as Person).id}/${serviceId}`, send('DELETE'))); }} /> :
       <RecordForm type={modal} item={edit} players={players} onSave={(data) => { const base = modal === 'person' ? '/people' : modal === 'service' ? '/services' : modal === 'player' ? '/games/catan/players' : '/games/catan/victories'; return action(() => api(edit ? `${base}/${edit.id}` : base, send(edit ? 'PUT' : 'POST', data))); }} />}
    </Modal>}
  </>;
}

function PaymentForm({ entry, selectedMonth, people, services, assignments, onSave }: {
  entry: { payment: Payment; month: string } | null; selectedMonth: string; people: Person[]; services: Service[]; assignments: Assignment[]; onSave: (data: object) => Promise<void>;
}) {
  const [personId, setPersonId] = useState(entry ? String(entry.payment.person_id) : '');
  const [serviceId, setServiceId] = useState(entry ? String(entry.payment.service_id) : '');
  const [month, setMonth] = useState(entry?.month || selectedMonth);
  const [paid, setPaid] = useState(entry ? (entry.payment.paid / 100).toFixed(2) : '');
  const [paidOn, setPaidOn] = useState(entry ? entry.payment.paid_on || '' : today());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const assignment = assignments.find(a => a.person_id === Number(personId) && a.service_id === Number(serviceId));
  const service = services.find(s => s.id === Number(serviceId));
  const expected = entry?.payment.expected ?? (service ? assignment?.custom_amount ?? service.amount : null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const amount = toCents(paid);
      if (amount > 0 && !paidOn) throw new Error('Посочете датата на плащане.');
      await onSave({ person_id: Number(personId), service_id: Number(serviceId), month, paid: amount, paid_on: amount > 0 ? paidOn : null, historical: !entry, auto_assign: !entry });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <form onSubmit={submit}>
    <p className="form-intro">Въведете общо платеното за избрания месец и датата на последното плащане. Записът заменя предишната обща сума и дата, без да пази отделни вноски.</p>
    <label>Човек<select required disabled={!!entry} value={personId} onChange={e => { setPersonId(e.target.value); setServiceId(''); }}><option value="">Изберете човек</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label>Услуга<select required disabled={!!entry} value={serviceId} onChange={e => setServiceId(e.target.value)}><option value="">Изберете услуга</option>{(entry ? services.filter(s => s.id === entry.payment.service_id) : services).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    {!entry && personId && serviceId && !assignment && <p className="form-intro">Услугата ще бъде зададена на този човек от текущия месец, със стандартната цена.</p>}
    <label>Месец, за който се отнася<input required type="month" disabled={!!entry} value={month} onChange={e => setMonth(e.target.value)} /></label>
    <label>Общо платена сума (€)<input required inputMode="decimal" value={paid} onChange={e => setPaid(e.target.value)} placeholder="0.00" />{expected !== null && <small>{entry ? 'Дължимо' : 'Текуща цена'}: {currency(expected)}. За стар запис може да важи запазена историческа цена.</small>}</label>
    {expected !== null && <button className="small-btn" type="button" onClick={() => setPaid((expected / 100).toFixed(2))}>Отбележи цялата сума</button>}
    <label>Дата на последното плащане<input type="date" value={paidOn} onChange={e => setPaidOn(e.target.value)} /><small>При сума 0 записът е неплатен и датата се премахва.</small></label>
    {!entry && <p className="form-intro">За по-стар месец без зададена тогава услуга се използва текущата цена.</p>}
    {error && <p className="error-text">{error}</p>}
    <button className="button primary full" disabled={busy || (!entry && (!people.length || !services.length))}>{busy ? 'Запазване...' : 'Запази плащането'} <Check size={16} /></button>
  </form>;
}

function LoginForm({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false);
  return <form onSubmit={async e => { e.preventDefault(); setBusy(true); await onLogin(username, password); setBusy(false); }}><p className="form-intro">Въведете данните си за достъп до управлението.</p><label>Потребителско име<input autoFocus required autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} /></label><label>Парола<input required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label><button className="button primary full" disabled={busy}>{busy ? 'Влизане...' : 'Влез в профила'} <ArrowRight size={16} /></button></form>;
}
function RecordForm({ type, item, players, onSave }: { type: string; item: Person | Service | Player | Victory | null; players: Player[]; onSave: (data: object) => Promise<void> }) {
  const person = type === 'person' ? item as Person | null : null, service = type === 'service' ? item as Service | null : null, player = type === 'player' ? item as Player | null : null, victory = type === 'victory' ? item as Victory | null : null;
  const [name, setName] = useState(person?.name || service?.name || player?.name || '');
  const [description, setDescription] = useState(person?.details || service?.description || '');
  const [picture, setPicture] = useState<string | null>(person?.image || player?.image || null);
  const [amount, setAmount] = useState(service ? (service.amount / 100).toFixed(2) : '');
  const [playerId, setPlayerId] = useState(victory ? String(victory.player_id) : '');
  const [playedOn, setPlayedOn] = useState(victory?.played_on || today());
  const [notes, setNotes] = useState(victory?.notes || '');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      let data: object;
      if (type === 'person') data = { name, details: description, image: picture };
      else if (type === 'service') data = { name, description, amount: toCents(amount) };
      else if (type === 'player') data = { name, image: picture };
      else data = { player_id: Number(playerId), played_on: playedOn, notes };
      await onSave(data);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <form onSubmit={submit}>{type !== 'victory' && <label>Име<input autoFocus required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder={type === 'service' ? 'Напр. Интернет' : 'Въведете име'} /></label>}{(type === 'person' || type === 'service') && <label>{type === 'person' ? 'Детайли' : 'Описание'} <span className="optional">незадължително</span><textarea maxLength={500} value={description} onChange={e => setDescription(e.target.value)} rows={3} /></label>}{type === 'service' && <label>Месечна цена (€)<input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></label>}{(type === 'person' || type === 'player') && <ImageInput value={picture} onChange={setPicture} />}{type === 'player' && <p className="form-intro">Игрите и успеваемостта се изчисляват автоматично от всички записани победи.</p>}{type === 'victory' && <><p className="form-intro">{victory ? 'Промяната на победителя не променя броя изиграни игри.' : 'Всяка победа се брои за една игра на всички играчи.'}</p><label>Играч<select required value={playerId} onChange={e => setPlayerId(e.target.value)}><option value="">Изберете играч</option>{players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Дата на играта<input required type="date" value={playedOn} onChange={e => setPlayedOn(e.target.value)} /></label><label>Бележки <span className="optional">незадължително</span><textarea maxLength={1000} rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></label>{!players.length && <small className="error-text">Първо добавете играч в „Игри и играчи“.</small>}</>}{error && <p className="error-text">{error}</p>}<button className="button primary full" disabled={busy || (type === 'victory' && !players.length)}>{busy ? 'Запазване...' : 'Запази'} <Check size={16} /></button></form>;
}
function AssignmentForm({ person, services, assignments, onSave, onRemove }: { person: Person; services: Service[]; assignments: Assignment[]; onSave: (serviceId: number, custom: number | null) => Promise<void>; onRemove: (serviceId: number) => void }) {
  const [serviceId, setServiceId] = useState(''); const [custom, setCustom] = useState(''); const [error, setError] = useState('');
  return <><p className="form-intro">Задайте услуга и при нужда индивидуална месечна цена.</p><div className="assignment-list">{assignments.filter(a => a.person_id === person.id).map(a => { const s = services.find(x => x.id === a.service_id); return s && <div key={s.id}><span><strong>{s.name}</strong><small>{a.custom_amount === null ? `Стандартна цена · ${currency(s.amount)}` : `Индивидуална цена · ${currency(a.custom_amount)}`}</small></span><button className="text-button" onClick={() => { setServiceId(String(s.id)); setCustom(a.custom_amount === null ? '' : (a.custom_amount / 100).toFixed(2)); }}>Промени</button><button className="icon-btn danger" aria-label={`Премахни ${s.name}`} onClick={() => onRemove(s.id)}><Trash2 size={15} /></button></div>; })}</div><form onSubmit={async e => { e.preventDefault(); setError(''); try { await onSave(Number(serviceId), custom.trim() ? toCents(custom) : null); } catch (e) { setError((e as Error).message); } }}><label>Услуга<select required value={serviceId} onChange={e => setServiceId(e.target.value)}><option value="">Изберете услуга</option>{services.map(s => <option value={s.id} key={s.id}>{s.name} · {currency(s.amount)}</option>)}</select></label><label>Индивидуална цена (€) <span className="optional">незадължително</span><input inputMode="decimal" value={custom} onChange={e => setCustom(e.target.value)} placeholder="Стандартна цена" /></label>{error && <p className="error-text">{error}</p>}<button className="button primary full" disabled={!services.length}>Запази услугата <Check size={16} /></button>{!services.length && <small>Първо добавете услуга.</small>}</form></>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
