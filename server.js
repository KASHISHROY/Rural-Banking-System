// Professional SIH prototype server (Express + SQLite)
// Run: npm install && npm start
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Simple in-memory OTP/session store (for demo; replace with secure store in production)
const otpStore = {}; // { userId: { otp, expires } }
const sessions = {}; // { token: { userId, role } }

// Initialize SQLite DB
const db = new sqlite3.Database('./data.db');

db.serialize(()=>{
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    userId TEXT,
    amount REAL,
    hour INTEGER,
    category TEXT,
    status TEXT,
    deviceId TEXT,
    village TEXT,
    timestamp TEXT,
    analysis TEXT,
    synced INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS audit (
    id TEXT PRIMARY KEY,
    event TEXT,
    ts TEXT
  )`);
});

function pushAudit(event){
  const id = uuidv4();
  const ts = new Date().toISOString();
  db.run(`INSERT INTO audit(id,event,ts) VALUES(?,?,?)`, [id,event,ts]);
}

// Simple fraud detection: z-score on past amounts + rule checks
function analyzeFraud(amount, userId, callback){
  db.all(`SELECT amount FROM transactions WHERE userId = ?`, [userId], (err, rows)=>{
    if(err) return callback({flag:'safe', explanation:'analysis error'});
    const amounts = rows.map(r=>Number(r.amount)).filter(a=>!isNaN(a));
    // Rule-based checks
    if(Number(amount) > 10000){
      return callback({flag:'fraud', explanation:'amount > 10000 threshold'});
    }
    // frequency check: last 1 minute transactions count
    db.get(`SELECT COUNT(*) as cnt FROM transactions WHERE userId = ? AND timestamp > datetime('now','-1 minute')`, [userId], (err2, row2)=>{
      if(err2) return callback({flag:'safe', explanation:'analysis partial'});
      if(row2 && row2.cnt >= 3){
        return callback({flag:'fraud', explanation:'high frequency transactions in 1 minute'});
      }
      if(amounts.length < 3){
        return callback({flag:'safe', explanation:'insufficient history'});
      }
      const mean = amounts.reduce((a,b)=>a+b,0)/amounts.length;
      const variance = amounts.reduce((s,a)=>s + Math.pow(a-mean,2),0)/amounts.length;
      const std = Math.sqrt(variance) || 0.00001;
      const z = Math.abs((amount - mean)/std);
      if(z > 2.5) return callback({flag:'fraud', explanation:`z-score ${z.toFixed(2)} > 2.5`});
      return callback({flag:'safe', explanation:`z-score ${z.toFixed(2)}`});
    });
  });
}

// Auth endpoints
app.post('/api/auth/request-otp', (req,res)=>{
  const { userId } = req.body;
  if(!userId) return res.status(400).json({error:'userId required'});
  const otp = Math.floor(1000 + Math.random()*9000).toString();
  const expires = Date.now() + (5*60*1000);
  otpStore[userId] = { otp, expires };
  pushAudit(`OTP generated for ${userId}`);
  // In production, send via SMS/Email. For prototype return OTP in response for controlled demo.
  res.json({ otp, expires });
});

app.post('/api/auth/verify', (req,res)=>{
  const { userId, pin, otp } = req.body;
  if(!userId || !pin) return res.status(400).json({error:'userId and pin required'});
  const record = otpStore[userId];
  if(String(pin) !== '1234') return res.status(401).json({ error:'Invalid PIN' });
  if(!record || record.expires < Date.now() || String(record.otp) !== String(otp)){
    return res.status(401).json({ error:'Invalid or expired OTP' });
  }
  const token = uuidv4();
  sessions[token] = { userId, role:'user', created:Date.now() };
  pushAudit(`User ${userId} logged in`);
  res.json({ token, userId });
});

// Admin login
app.post('/api/admin/login', (req,res)=>{
  const { pin, role } = req.body;
  if(String(pin) !== 'admin123') return res.status(401).json({ error:'Invalid admin PIN' });
  const token = uuidv4();
  sessions[token] = { userId:'admin', role: role === 'manager' ? 'manager' : 'auditor', created:Date.now() };
  pushAudit(`Admin logged in as ${sessions[token].role}`);
  res.json({ token, role: sessions[token].role });
});

// Middleware: simple token check
function requireToken(req,res,next){
  const token = req.headers['x-auth-token'];
  if(!token || !sessions[token]) return res.status(401).json({ error:'Unauthorized' });
  req.session = sessions[token];
  next();
}

// Transaction endpoints
app.post('/api/transaction', requireToken, (req,res)=>{
  const s = req.session;
  const { userId, amount, hour, category, deviceId, village, offline } = req.body;
  if(!userId || amount == null) return res.status(400).json({ error:'userId and amount required' });
  const id = uuidv4();
  const ts = new Date().toISOString();
  const txn = { id, userId, amount, hour: hour||new Date().getHours(), category: category||'others', status:'pending', deviceId: deviceId||'', village: village||'', timestamp: ts, analysis:'pending', synced: offline ? 0 : 1 };
  if(offline){
    // store as offline in transactions with offline flag (synced=0)
    db.run(`INSERT INTO transactions(id,userId,amount,hour,category,status,deviceId,village,timestamp,analysis,synced) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [txn.id, txn.userId, txn.amount, txn.hour, txn.category, 'offline', txn.deviceId, txn.village, txn.timestamp, 'queued offline', 0],
      function(err){
        if(err) return res.status(500).json({ error:'db error' });
        pushAudit(`Transaction queued offline: ${txn.id}`);
        res.json({ id: txn.id, status:'offline' });
      });
    return;
  }
  // analyze
  analyzeFraud(Number(amount), userId, (analysis)=>{
    const status = analysis.flag === 'fraud' ? 'fraudulent' : 'safe';
    db.run(`INSERT INTO transactions(id,userId,amount,hour,category,status,deviceId,village,timestamp,analysis,synced) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [txn.id, txn.userId, txn.amount, txn.hour, txn.category, status, txn.deviceId, txn.village, txn.timestamp, analysis.explanation, 1],
      function(err){
        if(err) return res.status(500).json({ error:'db error' });
        pushAudit(`Transaction processed: ${txn.id} status:${status}`);
        res.json({ id: txn.id, status, analysis: analysis.explanation });
      });
  });
});

// Sync offline: accept array of queued txns (or sync all server-side)
app.post('/api/offline/sync', requireToken, (req,res)=>{
  const role = req.session.role;
  if(role !== 'manager') return res.status(403).json({ error:'Only manager can sync' });
  // Option A: server-side finds transactions with synced=0 and processes them
  db.all(`SELECT * FROM transactions WHERE synced = 0`, [], (err, rows)=>{
    if(err) return res.status(500).json({ error:'db error' });
    const processed = [];
    const processNext = (i)=>{
      if(i >= rows.length) return res.json({ processed });
      const item = rows[i];
      analyzeFraud(Number(item.amount), item.userId, (analysis)=>{
        const status = analysis.flag === 'fraud' ? 'fraudulent' : 'synced';
        db.run(`UPDATE transactions SET status = ?, analysis = ?, synced = 1 WHERE id = ?`, [status, analysis.explanation, item.id], function(err2){
          processed.push({ id: item.id, status });
          pushAudit(`Offline transaction synced: ${item.id} => ${status}`);
          processNext(i+1);
        });
      });
    };
    processNext(0);
  });
});

// Fetch transactions with optional filters
app.get('/api/transactions', requireToken, (req,res)=>{
  const q = `SELECT * FROM transactions ORDER BY timestamp DESC LIMIT 1000`;
  db.all(q, [], (err, rows)=>{
    if(err) return res.status(500).json({ error:'db error' });
    res.json({ rows });
  });
});

// Analytics
app.get('/api/analytics', requireToken, (req,res)=>{
  db.all(`SELECT category, COUNT(*) as cnt, SUM(CASE WHEN status='fraudulent' THEN 1 ELSE 0 END) as frauds FROM transactions GROUP BY category`, [], (err, rows)=>{
    if(err) return res.status(500).json({ error:'db error' });
    res.json({ rows });
  });
});

// Audit log (read only)
app.get('/api/audit', requireToken, (req,res)=>{
  db.all(`SELECT * FROM audit ORDER BY ts DESC LIMIT 500`, [], (err, rows)=>{
    if(err) return res.status(500).json({ error:'db error' });
    res.json({ rows });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>{ console.log('Server running on', PORT); pushAudit('Server started'); });
