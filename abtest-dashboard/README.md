# ABTEST Dashboard

A modular Node.js + Express application using vanilla JavaScript. No frontend build tool or framework is required.

## Requirements

- Node.js 18 or newer
- npm

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Production:

```bash
npm start
```

## Pages

- `/` — Main Dashboard (listing, search/filtering, create, duplicate, export)
- `/configuration/:id` — Edit a saved experiment or work on a temporary create/duplicate draft
- `/simulation/:id` — Run the original assignment simulation against a saved experiment

## API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/experiments` | List saved experiments |
| GET | `/api/experiments/:id` | Retrieve one saved experiment |
| POST | `/api/experiments` | Create a saved experiment |
| PUT | `/api/experiments/:id` | Update a saved experiment |
| DELETE | `/api/experiments/:id` | Delete a saved experiment |
| POST | `/api/experiments/:id/validate` | Validate an experiment payload |

## Data and drafts

Saved experiments are stored as individual JSON files under `data/experiments/`. The server derives each filename from a SHA-256 digest of the experiment ID, so IDs are never used directly as filesystem paths. Writes are serialized and use a temporary file followed by an atomic rename.

New and duplicated experiments are stored temporarily in `sessionStorage` and are not included in the API list until the server confirms a successful Save. Editing an existing experiment uses a separate in-memory working copy. A failed save leaves the current draft intact.

## Unsaved changes

The configuration page compares the current form data with its original snapshot. New and duplicated drafts are always considered unsaved until committed. In-app links show a custom confirmation modal. Browser refresh, tab close, and full-page Back/Forward navigation use the browser's native `beforeunload` confirmation because Express routing performs normal document navigation.

## Save, Export, and Deploy

- **Save** writes local JSON through the Express API.
- **Export** retains the original ZIP export behavior and JSZip dependency.
- **Submit/Deploy** is not implemented; there are no fake Git, Jenkins, or CDN deployment statuses.

The original CDN manifest loader is retained as a fallback when the local JSON store is empty. The Analytic Model SDK is loaded on the Simulation page.

## Structure

```text
abtest-dashboard/
├── package.json
├── server.js
├── README.md
├── data/experiments/
├── public/assets/
└── src/
    ├── pages/                 # exactly three HTML pages
    ├── components/            # reusable markup partials
    ├── css/                   # shared and page-specific styles
    └── js/
        ├── legacy-core.js     # preserved original dashboard behavior
        ├── shared/
        ├── services/
        └── pages/
```

## Notes and limitations

- Existing UI markup, CSS rules, validation logic, export logic, CDN manifest loading, and simulation logic were carried forward from the supplied HTML.
- The server validates the structural fields and ID/status constraints. Detailed business-rule validation remains in the preserved client-side validator.
- Browser-native refresh/close prompts are controlled by the browser and cannot be customized.
- The CDN fallback is loaded only when the local experiment store is empty; successfully loaded experiments are imported into local storage so the editor can manage them.
- Git/Jenkins/CDN publishing remains future work.
