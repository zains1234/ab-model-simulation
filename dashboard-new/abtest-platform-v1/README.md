# ABTEST Experiment Platform — Version 1.1

This version keeps the existing dashboard UI and experiment logic, adds a local Node.js workspace, and supports browser-history routes for experiment pages.

## Requirements

- Node.js 18 or newer
- npm
- Internet access in the browser for the existing CDN SDK and JSZip CDN scripts

## Run on your laptop

```bash
cd abtest-platform-v1
npm install
cp .env.example .env
npm start
```

Open <http://localhost:8080>.

Do not open `index.html` directly with `file://`. The dashboard uses its local API and needs the Node.js server.

## Routes and browser navigation

- `/` — Experiments home
- `/experiments/:experimentId/configuration` — Experiment configuration
- `/experiments/:experimentId/simulation` — Experiment simulation
- `/experiments/new/configuration` — New experiment form

Opening Configuration or Simulation updates the browser URL. Browser Back and Forward navigate between pages. The server serves `index.html` for these routes, so direct links and page refreshes work too.

## Save and temporary workspace behavior

**Save configuration** writes only this file:

```text
temp/
└── workspace.json
```

`workspace.json` is the local working copy and contains all experiments and statuses (Active, Draft, Paused, Completed and Archived). It is loaded before CDN configuration on the next dashboard startup.

Saving does **not** create `temp/production/` and does not publish anything to CDN.

Duplicating an experiment creates an unsaved in-memory Draft. It is not written to `workspace.json` until the user opens it, validates it, and clicks **Save configuration**. If the browser is refreshed before saving, that unsaved duplicate is discarded.

## Production files and CDN ZIP

The **CDN ZIP** button builds the production package in browser memory and downloads it. It does not create `temp/production/` on the server. The ZIP contains:

```text
index.json
experiments/
└── folder_<sha256-prefix>/
    └── v<version>.json
```

Only Active experiments are included. `index.json` is the SDK manifest; it points to the individual experiment JSON files.

## Submit to CDN

The **Submit to CDN** button calls `POST /api/deploy`.

1. The server reads the saved `temp/workspace.json`.
2. It generates `temp/production/index.json` and the Active experiment JSON files only at deployment time.
3. It runs `DEPLOY_COMMAND` from this project directory. The command must publish `./temp/production/` to the agreed configuration repository / Jenkins / CDN flow.
4. If the command succeeds, the server clears `temp/` (including `workspace.json` and generated production files).
5. If the command fails, the server preserves `workspace.json` and removes the generated `temp/production/` directory so the working copy remains the only temporary configuration source.

If `DEPLOY_COMMAND` is empty, deployment is not configured and the server does not generate production files or delete the workspace.

Example `.env` (placeholder only — use an approved script from IT):

```env
PORT=8080
HOST=127.0.0.1
DEPLOY_COMMAND="./scripts/deploy-config.sh"
```

The deployment script is intentionally not included because the Git repository, Jenkins endpoint, credentials and CDN publishing process have not yet been provided.

## Version 1.1 boundaries

- No user login or multi-user access control yet. Do not expose this local server to the office network without authentication and IT review.
- Initial published configuration is loaded from the existing CDN URL in `index.html` when `temp/workspace.json` does not exist.
- Save is local only. CDN ZIP is a manual export. Submit to CDN requires a configured deployment command.

## Frontend file structure

The frontend is split into separate files to make maintenance easier:

- `index.html` — page structure and external library/SDK references
- `assets/css/styles.css` — all application styles
- `assets/js/app.js` — application logic and interactions

Keep the external JSZip and AnalyticModelSDK script references in `index.html` before `app.js`, because the application uses those libraries.
