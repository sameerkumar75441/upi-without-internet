import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './styles.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8080/api';
const SOCKET_URL = API.replace('/api', '');

async function api(path, options) {
  const response = await fetch(`${API}${path}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}

const money = value =>
  `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

function App() {
  // ---------- State ----------
  const [accounts, setAccounts] = useState([]);
  const [mesh, setMesh] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [event, setEvent] = useState({
    kind: 'ready',
    title: 'Ready for a payment',
    detail: 'Demo PIN for every account is 1234.',
  });
  const [receipt, setReceipt] = useState(null);
  const [form, setForm] = useState({
    senderVpa: 'alice@demo',
    receiverVpa: 'bob@demo',
    amount: 500,
    pin: '1234',
  });

  // ---------- Data loading ----------
  const refresh = async () => {
    const [a, m, t] = await Promise.all([
      api('/accounts'),
      api('/mesh/state'),
      api('/transactions'),
    ]);
    setAccounts(a);
    setMesh(m);
    setTransactions(t);
  };

  // ---------- Socket.IO live updates ----------
  useEffect(() => {
    refresh().catch(e =>
      setEvent({ kind: 'error', title: 'Connection error', detail: e.message })
    );

    const socket = io(SOCKET_URL);
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('mesh:update', update => {
      refresh().catch(() => {});

      const labels = {
        packet_injected: 'A new packet was injected',
        gossip_completed: 'Mesh updated by another session',
        bridge_processed: 'Bridge activity completed',
        mesh_reset: 'Mesh reset from another session',
        demo_reset: 'Demo data reset from another session',
      };

      setEvent(current =>
        current.kind === 'ready'
          ? {
              kind: 'live',
              title: labels[update.type] || 'Live update received',
              detail: 'Dashboard refreshed automatically through Socket.IO.',
            }
          : current
      );
    });

    return () => socket.close();
  }, []);

  // ---------- Derived metrics ----------
  const metrics = useMemo(
    () => ({
      settled: transactions.filter(t => t.status === 'SETTLED').length,
      rejected: transactions.filter(t => t.status === 'REJECTED').length,
      packets: mesh?.devices.reduce((sum, d) => sum + d.packetCount, 0) || 0,
      volume: transactions
        .filter(t => t.status === 'SETTLED')
        .reduce((sum, t) => sum + t.amount, 0),
    }),
    [mesh, transactions]
  );

  // ---------- Action helpers ----------
  const run = async work => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setEvent({ kind: 'error', title: 'Action failed', detail: e.message });
    } finally {
      setBusy(false);
    }
  };

  // Step 1: encrypt + inject packet
  const send = () =>
    run(async () => {
      if (form.senderVpa === form.receiverVpa) {
        throw new Error('Sender and receiver must be different.');
      }

      const result = await api('/demo/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount: Number(form.amount) }),
      });

      setEvent({
        kind: 'packet',
        title: 'Packet encrypted & injected',
        detail: `Packet ${result.packetId.slice(0, 8)} is now waiting on phone-alice.`,
      });
      setReceipt(null);
      await refresh();
    });

  // Step 2: gossip round
  const gossip = () =>
    run(async () => {
      const result = await api('/mesh/gossip', { method: 'POST' });

      setEvent({
        kind: 'gossip',
        title: 'Gossip round completed',
        detail: `${result.transfers} encrypted packet copy/copies moved across the mesh.`,
      });
      await refresh();
    });

  // Step 3: bridges upload
  const flush = () =>
    run(async () => {
      const result = await api('/mesh/flush', { method: 'POST' });
      const first = result.results[0];

      if (!first) {
        setEvent({
          kind: 'error',
          title: 'No bridge packet found',
          detail: 'Inject a packet and run a gossip round first.',
        });
        return;
      }

      const messages = {
        SETTLED: 'Payment was decrypted, PIN-checked and recorded in the demo ledger.',
        REJECTED: 'Payment reached the backend but the sender has insufficient demo balance.',
        DUPLICATE_DROPPED: 'This packet was already processed, so it was safely blocked.',
        INVALID:
          first.reason === 'internal_error: invalid_pin'
            ? 'PIN verification failed. Use demo PIN 1234.'
            : 'Packet could not be verified.',
      };

      setEvent({
        kind: first.outcome.toLowerCase(),
        title: first.outcome.replaceAll('_', ' '),
        detail: messages[first.outcome] || 'Bridge processed the packet.',
      });
      setReceipt(first);
      await refresh();
    });

  // Reset everything
  const resetAll = () =>
    run(async () => {
      await api('/demo/reset-all', { method: 'POST' });
      setReceipt(null);
      setEvent({
        kind: 'ready',
        title: 'Demo reset complete',
        detail: 'Balances, ledger and mesh are back to their original state.',
      });
      await refresh();
    });

  // Clear mesh only (balances and ledger stay)
  const clearMesh = () =>
    run(async () => {
      await api('/mesh/reset', { method: 'POST' });
      await refresh();
      setEvent({
        kind: 'ready',
        title: 'Mesh cleared',
        detail: 'Balances and ledger were kept unchanged.',
      });
    });

  // ---------- UI ----------
  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">MERN DEMO · NO REAL MONEY</p>
          <h1>UPI Offline Mesh</h1>
          <p>Secure packet routing across a virtual Bluetooth mesh with deferred settlement.</p>
        </div>
        <div className={`live-pill ${connected ? 'online' : ''}`}>
          <i></i>
          {connected ? 'Live updates connected' : 'Connecting live updates…'}
        </div>
      </header>

      <section className="metrics">
        <div>
          <span>Settled</span>
          <strong>{metrics.settled}</strong>
          <small>demo payments</small>
        </div>
        <div>
          <span>Rejected</span>
          <strong>{metrics.rejected}</strong>
          <small>insufficient funds</small>
        </div>
        <div>
          <span>Mesh packets</span>
          <strong>{metrics.packets}</strong>
          <small>across devices</small>
        </div>
        <div>
          <span>Settled volume</span>
          <strong>{money(metrics.volume)}</strong>
          <small>demo ledger</small>
        </div>
      </section>

      <section className="flow">
        <div><b>1</b><span>Encrypt</span></div>
        <i>→</i>
        <div><b>2</b><span>Gossip</span></div>
        <i>→</i>
        <div><b>3</b><span>Bridge</span></div>
        <i>→</i>
        <div><b>4</b><span>Settle</span></div>
      </section>

      <section className="card compose">
        <div className="section-heading">
          <div>
            <p className="label">PAYMENT COMPOSER</p>
            <h2>Create encrypted packet</h2>
          </div>
          <p className="hint">Demo PIN: <b>1234</b></p>
        </div>

        <div className="form">
          {[
            ['senderVpa', 'From VPA'],
            ['receiverVpa', 'To VPA'],
            ['amount', 'Amount ₹'],
            ['pin', 'PIN'],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                disabled={busy}
                type={key === 'amount' ? 'number' : key === 'pin' ? 'password' : 'text'}
                value={form[key]}
                onChange={e => setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>

        <button disabled={busy} onClick={send}>🔒 1. Inject into mesh</button>
      </section>

      <section className="actions">
        <button disabled={busy} onClick={gossip}>📶 2. Run gossip round</button>
        <button disabled={busy} onClick={flush}>📡 3. Bridges upload</button>
        <button disabled={busy} className="quiet" onClick={clearMesh}>Clear mesh</button>
        <button disabled={busy} className="danger" onClick={resetAll}>Reset full demo</button>
      </section>

      <section className={`event ${event.kind}`}>
        <div className="event-icon">
          {event.kind === 'settled' ? '✓' : event.kind === 'error' || event.kind === 'invalid' ? '!' : '●'}
        </div>
        <div>
          <strong>{event.title}</strong>
          <span>{event.detail}</span>
        </div>
      </section>

      {receipt && (
        <section className={`receipt ${receipt.outcome.toLowerCase()}`}>
          <div>
            <small>TRANSACTION RESULT</small>
            <h2>{receipt.outcome.replaceAll('_', ' ')}</h2>
            <p>
              Packet <code>{receipt.packetId}</code> · via <code>{receipt.bridgeNode}</code>
            </p>
          </div>
          <div>
            <small>TRANSACTION ID</small>
            <code>{receipt.transactionId || '—'}</code>
          </div>
        </section>
      )}

      <section className="grid">
        <article className="card">
          <div className="section-heading">
            <div>
              <p className="label">DEMO WALLETS</p>
              <h2>Account balances</h2>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>VPA</th>
                <th>Name</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(a => (
                <tr key={a._id}>
                  <td>{a.vpa}</td>
                  <td>{a.holderName}</td>
                  <td className="balance">{money(a.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        <article className="card">
          <div className="section-heading">
            <div>
              <p className="label">LIVE TOPOLOGY</p>
              <h2>Mesh devices</h2>
            </div>
          </div>
          <div className="mesh-map">
            {mesh?.devices.map(d => (
              <div className={`node ${d.hasInternet ? 'bridge' : ''}`} key={d.deviceId}>
                <b>{d.hasInternet ? '📡' : '📱'}</b>
                <strong>{d.deviceId.replace('phone-', '')}</strong>
                <span>{d.hasInternet ? 'Internet bridge' : 'Offline device'}</span>
                <em>
                  {d.packetCount} packet{d.packetCount === 1 ? '' : 's'}
                </em>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="label">AUDIT TRAIL</p>
            <h2>Transaction ledger</h2>
          </div>
          <span className="muted">Updates live</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>From → To</th>
              <th>Amount</th>
              <th>Bridge</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map(t => (
              <tr key={t._id}>
                <td><mark className={t.status.toLowerCase()}>{t.status}</mark></td>
                <td>{t.senderVpa} → {t.receiverVpa}</td>
                <td className="balance">{money(t.amount)}</td>
                <td>{t.bridgeNodeId}</td>
              </tr>
            ))}
            {!transactions.length && (
              <tr>
                <td colSpan="4" className="empty">
                  No transactions yet. Complete the three steps above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);