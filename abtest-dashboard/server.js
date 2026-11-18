'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data', 'experiments');

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use('/css', express.static(path.join(ROOT, 'src', 'css'), { maxAge: '1h' }));
app.use('/js', express.static(path.join(ROOT, 'src', 'js'), { maxAge: '1h' }));
app.use('/components', express.static(path.join(ROOT, 'src', 'components'), { maxAge: '1h' }));
app.use('/assets', express.static(path.join(ROOT, 'public', 'assets'), { maxAge: '1d' }));

function fileForId(id) {
  return path.join(DATA_DIR, crypto.createHash('sha256').update(id).digest('hex') + '.json');
}
function validateId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 180 && !/[\u0000-\u001f]/.test(id);
}
function validateExperiment(data, expectedId) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ['Request body must be a JSON object'];
  if (!validateId(data.id)) errors.push('A valid experiment ID is required');
  if (expectedId && data.id !== expectedId) errors.push('Experiment ID cannot be changed');
  if (!data.name || typeof data.name !== 'string') errors.push('Experiment name is required');
  if (!data.target || typeof data.target !== 'object' || Array.isArray(data.target)) errors.push('Experiment target must be an object');
  if (!Array.isArray(data.models)) errors.push('Experiment models must be an array');
  if (!data.events || typeof data.events !== 'object' || Array.isArray(data.events)) errors.push('Experiment events must be an object');
  if (!['draft', 'active', 'paused', 'completed', 'archived'].includes(data.status)) errors.push('Invalid experiment status');
  return errors;
}
function validateBusinessRules(data, existing, ignoreId) {
  const errors = [];
  const others = existing.filter(item => item.id !== ignoreId);
  if (others.some(item => String(item.name || '').trim().toLowerCase() === String(data.name || '').trim().toLowerCase())) {
    errors.push('Experiment name must be unique');
  }
  for (const key of ['project', 'environment', 'platform', 'feature']) {
    if (!String((data.target || {})[key] || '').trim()) errors.push(`${key} is required`);
  }
  const models = Array.isArray(data.models) ? data.models : [];
  if (models.length < 2) errors.push('At least 2 models required');
  const modelNames = models.map(item => String(item.name || ''));
  if (modelNames.some(name => !name)) errors.push('Model names are required');
  if (new Set(modelNames).size !== modelNames.length) errors.push('Model names must be unique');
  const percentages = models.map(item => Number(item.percentage));
  if (percentages.some(value => !Number.isFinite(value) || value <= 0)) errors.push('Each variant percentage must be greater than 0%');
  if (percentages.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0) > 100) errors.push('Model percentages must not exceed 100%');
  const events = data.events || {};
  if (!Object.keys(events).length) errors.push('At least 1 event required');
  if (data.status === 'active') {
    const keys = Object.keys(events);
    for (const other of others.filter(item => item.status === 'active')) {
      for (const key of keys) if (Object.prototype.hasOwnProperty.call(other.events || {}, key)) errors.push(`Event key "${key}" is already used by active experiment "${other.name}" (${other.id})`);
    }
  }
  for (const [key, event] of Object.entries(events)) {
    if (!key) { errors.push('Event key is required'); continue; }
    if (event && event.type === 'static') {
      if (!String(event.url || '').trim()) errors.push(`${key}: URL required`);
      if (!String(event.tracking_rec || '').trim()) errors.push(`${key}: Tracking Rec required`);
    } else if (event && event.type === 'experiment') {
      if (!event.models || typeof event.models !== 'object') { errors.push(`${key}: model configuration required`); continue; }
      for (const model of models) {
        const config = event.models[model.name];
        if (!config || !String(config.url || '').trim()) errors.push(`${key}: URL required for ${model.name}`);
      }
    } else errors.push(`${key}: Invalid event type`);
  }
  return errors;
}
async function readAll() {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  const files = await fs.promises.readdir(DATA_DIR);
  const result = [];
  for (const file of files.filter(name => name.endsWith('.json'))) {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(path.join(DATA_DIR, file), 'utf8'));
      if (parsed && typeof parsed.id === 'string') result.push(parsed);
    } catch (error) {
      // A malformed record is skipped, not allowed to crash the whole listing.
      console.error('Skipping invalid experiment JSON:', file, error.message);
    }
  }
  return result;
}
let writeQueue = Promise.resolve();
function serializeWrite(operation) {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.catch(() => {});
  return next;
}
async function atomicWrite(id, data) {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  const destination = fileForId(id);
  const temporary = destination + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  await fs.promises.writeFile(temporary, JSON.stringify(data, null, 2), { flag: 'wx' });
  await fs.promises.rename(temporary, destination);
}
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

// Page routes: exactly three application pages.
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'src', 'pages', 'index.html')));
app.get('/configuration/:id', (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).send('Invalid experiment ID');
  res.sendFile(path.join(ROOT, 'src', 'pages', 'configuration.html'));
});
app.get('/simulation/:id', (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).send('Invalid experiment ID');
  res.sendFile(path.join(ROOT, 'src', 'pages', 'simulation.html'));
});

// API routes.
app.get('/api/experiments', asyncRoute(async (req, res) => {
  res.json({ experiments: await readAll() });
}));
app.get('/api/experiments/:id', asyncRoute(async (req, res) => {
  const id = req.params.id;
  if (!validateId(id)) return res.status(400).json({ error: 'Invalid experiment ID' });
  const file = fileForId(id);
  let data;
  try { data = JSON.parse(await fs.promises.readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Experiment not found' });
    return res.status(500).json({ error: 'Stored experiment data is invalid JSON' });
  }
  res.json({ experiment: data });
}));
app.post('/api/experiments', asyncRoute(async (req, res) => {
  const errors = validateExperiment(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join('; '), errors });
  await serializeWrite(async () => {
    const existing = await readAll();
    const businessErrors = validateBusinessRules(req.body, existing, null);
    if (businessErrors.length) return res.status(400).json({ error: businessErrors.join('; '), errors: businessErrors });
    const file = fileForId(req.body.id);
    try { await fs.promises.access(file); return res.status(409).json({ error: 'Experiment ID already exists' }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const data = Object.assign({}, req.body, { created_at: req.body.created_at || new Date().toISOString() });
    await atomicWrite(data.id, data);
    return res.status(201).json({ experiment: data });
  });
}));
app.put('/api/experiments/:id', asyncRoute(async (req, res) => {
  const id = req.params.id;
  if (!validateId(id)) return res.status(400).json({ error: 'Invalid experiment ID' });
  const errors = validateExperiment(req.body, id);
  if (errors.length) return res.status(400).json({ error: errors.join('; '), errors });
  await serializeWrite(async () => {
    const existing = await readAll();
    const businessErrors = validateBusinessRules(req.body, existing, id);
    if (businessErrors.length) return res.status(400).json({ error: businessErrors.join('; '), errors: businessErrors });
    const file = fileForId(id);
    try { await fs.promises.access(file); }
    catch (error) { if (error.code === 'ENOENT') return res.status(404).json({ error: 'Experiment not found' }); throw error; }
    const data = Object.assign({}, req.body);
    await atomicWrite(id, data);
    return res.json({ experiment: data });
  });
}));
app.delete('/api/experiments/:id', asyncRoute(async (req, res) => {
  const id = req.params.id;
  if (!validateId(id)) return res.status(400).json({ error: 'Invalid experiment ID' });
  await serializeWrite(async () => {
    try { await fs.promises.unlink(fileForId(id)); }
    catch (error) { if (error.code === 'ENOENT') return res.status(404).json({ error: 'Experiment not found' }); throw error; }
    return res.status(204).end();
  });
}));
app.post('/api/experiments/:id/validate', asyncRoute(async (req, res) => {
  const id = req.params.id;
  const errors = validateExperiment(req.body, id);
  if (errors.length) return res.status(400).json({ error: errors.join('; '), errors });
  const businessErrors = validateBusinessRules(req.body, await readAll(), id);
  if (businessErrors.length) return res.status(400).json({ error: businessErrors.join('; '), errors: businessErrors });
  res.json({ valid: true });
}));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API endpoint not found' });
  res.status(404).send('Page not found');
});
app.use((error, req, res, next) => {
  console.error('Request failed:', error.message);
  if (res.headersSent) return next(error);
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });
  if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: 'Request body contains invalid JSON' });
  res.status(500).json({ error: 'An unexpected server error occurred' });
});

app.listen(PORT, () => {
  console.log(`ABTEST Dashboard running at http://localhost:${PORT}`);
});
