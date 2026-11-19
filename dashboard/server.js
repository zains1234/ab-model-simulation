'use strict';

const express = require('express');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

app.disable('x-powered-by');
app.use('/css', express.static(path.join(ROOT, 'src', 'css'), { maxAge: '1h' }));
app.use('/js', express.static(path.join(ROOT, 'src', 'js'), { maxAge: '1h' }));
app.use('/components', express.static(path.join(ROOT, 'src', 'components'), { maxAge: '1h' }));
app.use('/assets', express.static(path.join(ROOT, 'public', 'assets'), { maxAge: '1d' }));

// Express only serves the application. Experiment data is loaded from the CDN
// and temporary changes are stored in the user's browser localStorage.
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'src', 'pages', 'index.html')));
app.get('/configuration/:name', (req, res) => res.sendFile(path.join(ROOT, 'src', 'pages', 'configuration.html')));
app.get('/simulation/:name', (req, res) => res.sendFile(path.join(ROOT, 'src', 'pages', 'simulation.html')));

app.use((req, res) => res.status(404).send('Page not found'));

app.listen(PORT, () => {
  console.log(`ABTEST Dashboard running at http://localhost:${PORT}`);
});
