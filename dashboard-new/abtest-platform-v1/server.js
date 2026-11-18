const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const TEMP_DIR = path.join(ROOT, 'temp');
const MAX_BODY = '10mb';

app.use(express.json({ limit: MAX_BODY }));
app.use('/assets', express.static(path.join(ROOT, 'assets')));
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));

function folderName(name) {
  const hash = crypto.createHash('sha256').update(String(name)).digest('hex');
  return `folder_${hash.slice(0, 20)}`;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function saveWorkspace(experiments) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  // Saving a workspace must not generate deployment artifacts.
  // workspace.json is the only temporary file written by Save.
  writeJson(path.join(TEMP_DIR, 'workspace.json'), {
    saved_at: new Date().toISOString(),
    experiments
  });
}

function buildProductionFiles(experiments) {
  const productionDir = path.join(TEMP_DIR, 'production');
  fs.rmSync(productionDir, { recursive: true, force: true });
  fs.mkdirSync(productionDir, { recursive: true });

  const active = experiments.filter(item => item && item.status === 'active');
  const manifest = {
    schema_version: 3,
    config_version: Date.now(),
    generated_at: new Date().toISOString(),
    experiments: active.map(item => ({
      id: item.id,
      name: item.name,
      version: item.version,
      status: item.status,
      target: item.target || {},
      event_keys: Object.keys(item.events || {}),
      config_url: `./experiments/${folderName(item.name)}/v${item.version}.json`
    }))
  };

  writeJson(path.join(productionDir, 'index.json'), manifest);
  for (const item of active) {
    writeJson(
      path.join(productionDir, 'experiments', folderName(item.name), `v${item.version}.json`),
      item
    );
  }
}

app.get('/api/draft', (req, res) => {
  const workspacePath = path.join(TEMP_DIR, 'workspace.json');
  if (!fs.existsSync(workspacePath)) return res.json({ hasDraft: false, experiments: [] });
  try {
    const workspace = JSON.parse(fs.readFileSync(workspacePath, 'utf8'));
    return res.json({ hasDraft: true, savedAt: workspace.saved_at, experiments: workspace.experiments || [] });
  } catch (error) {
    return res.status(500).json({ error: `Could not read local workspace: ${error.message}` });
  }
});

app.post('/api/draft', (req, res) => {
  if (!req.body || !Array.isArray(req.body.experiments)) {
    return res.status(400).json({ error: 'Request must contain an experiments array.' });
  }
  try {
    saveWorkspace(req.body.experiments);
    return res.json({ ok: true, message: 'Workspace saved to temp/workspace.json. Production files were not generated.' });
  } catch (error) {
    return res.status(500).json({ error: `Could not generate temporary files: ${error.message}` });
  }
});

app.post('/api/deploy', (req, res) => {
  const workspacePath = path.join(TEMP_DIR, 'workspace.json');
  if (!fs.existsSync(workspacePath)) {
    return res.status(409).json({ error: 'There is no saved workspace to submit. Save a configuration first.' });
  }

  const command = process.env.DEPLOY_COMMAND;
  if (!command) {
    return res.status(501).json({
      error: 'CDN deployment is not configured yet. Set DEPLOY_COMMAND in .env. The workspace remains saved and production files have not been generated.'
    });
  }

  try {
    const workspace = JSON.parse(fs.readFileSync(workspacePath, 'utf8'));
    // Generate deployment files only when an actual deployment is requested.
    buildProductionFiles(workspace.experiments || []);
  } catch (error) {
    return res.status(500).json({ error: `Could not prepare production files: ${error.message}` });
  }

  exec(command, { cwd: ROOT, timeout: 10 * 60 * 1000, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      console.error('Deployment command failed:', stderr || error.message);
      // Keep the workspace for recovery, but remove the generated deployment copy.
      fs.rmSync(path.join(TEMP_DIR, 'production'), { recursive: true, force: true });
      return res.status(500).json({
        error: `Deployment command failed. Your workspace was kept and temporary production files were removed. ${stderr || error.message}`
      });
    }

    // Clear all temporary state only after the deployment command succeeds.
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    return res.json({
      ok: true,
      message: 'Deployment command completed. Temporary workspace files have been cleared.',
      output: stdout
    });
  });
});

// Client-side routes: serve the same dashboard for direct links and refreshes.
app.get('*', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));

app.listen(PORT, HOST, () => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  console.log(`ABTEST Experiment Platform running at http://localhost:${PORT}`);
});
