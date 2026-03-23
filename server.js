const express  = require('express')
const session  = require('express-session')
const multer   = require('multer')
const cors     = require('cors')
const path     = require('path')
const fs       = require('fs')

const app  = express()
const PORT = process.env.PORT || 3000

// Chiave API per sincronizzazione dall'app desktop
const API_KEY = process.env.API_KEY || 'gestionale-auto-key-2024'

// ── Cartelle ──────────────────────────────────────────────────────────────────
const DATA_DIR    = path.join(__dirname, '.data')
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads')
;[DATA_DIR, UPLOADS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }) })
const DB_FILE = path.join(DATA_DIR, 'db.json')

// ── DB ────────────────────────────────────────────────────────────────────────
function leggiDB() {
  try { if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) } catch(e) {}
  return { clienti: [], pratiche: [], admin: { username: 'admin', password: 'admin123' } }
}
function scrviDB(d) { fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2)) }

// ── Upload ────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (_, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_'))
})
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } })

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, 'public')))
app.use(session({ secret: 'gestionale2024', resave: false, saveUninitialized: false, cookie: { maxAge: 8 * 3600000 } }))

// ── Auth ──────────────────────────────────────────────────────────────────────
const soloAdmin   = (req, res, next) => {
  // Accetta sia sessione web che API key dall'app desktop
  if (req.session.ruolo === 'admin') return next()
  if (req.headers['x-api-key'] === API_KEY) return next()
  res.status(401).json({ errore: 'Non autorizzato' })
}
const soloLoggato = (req, res, next) => {
  if (req.session.userId) return next()
  if (req.headers['x-api-key'] === API_KEY) return next()
  res.status(401).json({ errore: 'Non autorizzato' })
}

// ── Login/Logout ──────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body
  const db = leggiDB()
  if (username === db.admin.username && password === db.admin.password) {
    req.session.ruolo = 'admin'; req.session.userId = 'admin'; req.session.nome = 'Admin'
    return res.json({ ok: true, ruolo: 'admin', nome: 'Admin' })
  }
  const cl = db.clienti.find(c => c.username === username && c.password === password)
  if (cl) {
    req.session.ruolo = 'cliente'; req.session.userId = cl.id; req.session.nome = cl.nome; req.session.codice = cl.codice
    return res.json({ ok: true, ruolo: 'cliente', nome: cl.nome, codice: cl.codice, id: cl.id })
  }
  res.status(401).json({ errore: 'Credenziali non corrette' })
})
app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }) })
app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ loggato: false })
  res.json({ loggato: true, ruolo: req.session.ruolo, userId: req.session.userId, nome: req.session.nome, codice: req.session.codice })
})

// ── Clienti ───────────────────────────────────────────────────────────────────
app.get('/api/clienti', soloAdmin, (_, res) => res.json(leggiDB().clienti))
app.post('/api/clienti', soloAdmin, (req, res) => {
  const db = leggiDB()
  const { nome, email, telefono, username, password } = req.body
  if (!nome || !username || !password) return res.status(400).json({ errore: 'Campi mancanti' })
  const codice = 'C' + String(db.clienti.length + 1).padStart(3, '0')
  const cl = { id: codice, codice, nome, email: email||'', telefono: telefono||'', username, password }
  db.clienti.push(cl); scrviDB(db); res.json(cl)
})
app.put('/api/clienti/:id', soloAdmin, (req, res) => {
  const db = leggiDB()
  const i = db.clienti.findIndex(c => c.id === req.params.id)
  if (i < 0) return res.status(404).json({ errore: 'Non trovato' })
  db.clienti[i] = { ...db.clienti[i], ...req.body }; scrviDB(db); res.json(db.clienti[i])
})
app.delete('/api/clienti/:id', soloAdmin, (req, res) => {
  const db = leggiDB(); db.clienti = db.clienti.filter(c => c.id !== req.params.id); scrviDB(db); res.json({ ok: true })
})

// ── Pratiche ──────────────────────────────────────────────────────────────────
app.get('/api/pratiche', soloLoggato, (req, res) => {
  const db = leggiDB()
  if (req.session.ruolo === 'admin' || req.headers['x-api-key'] === API_KEY) return res.json(db.pratiche)
  res.json(db.pratiche.filter(p => p.clienteId === req.session.userId).map(p => ({ ...p, files: (p.files||[]).filter(f => f.visibile) })))
})
app.get('/api/pratiche/:id', soloLoggato, (req, res) => {
  const db = leggiDB(); const p = db.pratiche.find(x => x.id === req.params.id)
  if (!p) return res.status(404).json({ errore: 'Non trovata' })
  if (req.session.ruolo !== 'admin' && req.headers['x-api-key'] !== API_KEY && p.clienteId !== req.session.userId)
    return res.status(403).json({ errore: 'Non autorizzato' })
  if (req.session.ruolo === 'cliente') return res.json({ ...p, files: (p.files||[]).filter(f => f.visibile) })
  res.json(p)
})
app.post('/api/pratiche', soloAdmin, (req, res) => {
  const db = leggiDB()
  const { titolo, clienteId, tipo, targa, stato, scadenza, note, numero } = req.body
  if (!titolo || !clienteId) return res.status(400).json({ errore: 'Titolo e cliente obbligatori' })
  const id = 'P' + String(db.pratiche.length + 1).padStart(3, '0')
  const p = { id, titolo, clienteId, numero: numero||id, tipo: tipo||'Altro', targa: targa||'', stato: stato||'attesa', scadenza: scadenza||'', note: note||'', files: [], messaggi: [] }
  db.pratiche.unshift(p); scrviDB(db); res.json(p)
})
app.put('/api/pratiche/:id', soloAdmin, (req, res) => {
  const db = leggiDB(); const i = db.pratiche.findIndex(x => x.id === req.params.id)
  if (i < 0) return res.status(404).json({ errore: 'Non trovata' })
  db.pratiche[i] = { ...db.pratiche[i], ...req.body }; scrviDB(db); res.json(db.pratiche[i])
})
app.delete('/api/pratiche/:id', soloAdmin, (req, res) => {
  const db = leggiDB(); db.pratiche = db.pratiche.filter(x => x.id !== req.params.id); scrviDB(db); res.json({ ok: true })
})

// ── File Upload ───────────────────────────────────────────────────────────────
app.post('/api/pratiche/:id/files', soloAdmin, upload.array('files', 50), (req, res) => {
  const db = leggiDB(); const p = db.pratiche.find(x => x.id === req.params.id)
  if (!p) return res.status(404).json({ errore: 'Pratica non trovata' })
  const nuovi = req.files.map(f => ({
    id: Date.now() + '-' + Math.random().toString(36).slice(2),
    nome: f.originalname, url: '/uploads/' + f.filename, dim: f.size, visibile: false
  }))
  p.files = [...(p.files||[]), ...nuovi]; scrviDB(db); res.json(nuovi)
})
app.put('/api/pratiche/:id/files/:fid', soloAdmin, (req, res) => {
  const db = leggiDB(); const p = db.pratiche.find(x => x.id === req.params.id)
  if (!p) return res.status(404).json({ errore: 'Non trovata' })
  const f = (p.files||[]).find(x => x.id === req.params.fid)
  if (!f) return res.status(404).json({ errore: 'File non trovato' })
  if (req.body.visibile !== undefined) f.visibile = req.body.visibile
  scrviDB(db); res.json(f)
})
app.delete('/api/pratiche/:id/files/:fid', soloAdmin, (req, res) => {
  const db = leggiDB(); const p = db.pratiche.find(x => x.id === req.params.id)
  if (!p) return res.status(404).json({ errore: 'Non trovata' })
  const f = (p.files||[]).find(x => x.id === req.params.fid)
  if (f) { try { const fp = path.join(__dirname, 'public', f.url); if (fs.existsSync(fp)) fs.unlinkSync(fp) } catch(e) {} }
  p.files = (p.files||[]).filter(x => x.id !== req.params.fid); scrviDB(db); res.json({ ok: true })
})

// ── Messaggi ──────────────────────────────────────────────────────────────────
app.post('/api/pratiche/:id/messaggi', soloLoggato, (req, res) => {
  const db = leggiDB(); const p = db.pratiche.find(x => x.id === req.params.id)
  if (!p) return res.status(404).json({ errore: 'Non trovata' })
  if (req.session.ruolo !== 'admin' && req.headers['x-api-key'] !== API_KEY && p.clienteId !== req.session.userId)
    return res.status(403).json({ errore: 'Non autorizzato' })
  const now = new Date()
  const ts = now.toLocaleDateString('it-IT') + ' ' + now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  const msg = { id: Date.now(), da: req.session.ruolo || 'admin', testo: req.body.testo, ts }
  ;(p.messaggi || (p.messaggi = [])).push(msg); scrviDB(db); res.json(msg)
})

app.listen(PORT, () => console.log('Gestionale online su porta ' + PORT))
