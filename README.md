# Recommendation Experiment Platform — Phase 1 MVP

Database-free implementation.

## Flow
Dashboard → versioned JSON → CDN/object storage → generic SDK → stable GTM → `window.dsrec`.

## Files
- `dashboard/index.html`: experiment management prototype using localStorage; export manifest/config JSON.
- `sdk/recommendation-sdk.js`: generic runtime engine.
- `config/production/index.json`: manifest.
- `config/production/base.json`: static/base configuration.
- `config/production/experiments/.../v1.json`: example experiment.
- `gtm/stable-tag.html`: stable GTM tag.
- `tests/`: browser tests.

## Run
From the project root:
`python3 -m http.server 8080`

Open `/dashboard/` and `/tests/`.

## Runtime rules
- Target matching is exact AND.
- Active conflicts on the same recommendation key are rejected.
- Assignment input is `experimentId:userId`.
- SHA-256 → first 8 hex chars → modulo 100.
- Percentages map bucket 0–99.
- Missing/unresolved user IDs do not receive random assignments.
- `window.dsrec` remains an object per recommendation key.
- Unaffected keys come from base configuration.
- Historical config versions are intended to be immutable.
- No database is required by runtime.

## Later database phase
A backend/database can later provide authentication, multi-user editing, approvals and audit history. It does not need to change the deterministic assignment algorithm or frontend `window.dsrec` contract.

## Configuration hierarchy (v2)

The dashboard separates experiment-level model assignment from recommendation URLs:

```text
Experiment
├── Targeting
├── Models
│   ├── modelA -> percentage
│   ├── modelB -> percentage
│   └── ...
└── Recommendations
    ├── newsfeed
    │   ├── modelA -> URL
    │   └── modelB -> URL
    └── detail
        ├── modelA -> URL
        └── modelB -> URL
```

Models are the single source of truth for model names and percentages. Adding or removing a model automatically changes the model rows under every recommendation. The recommendation section only stores the URL/configuration for each model.

### SDK / GTM compatibility

The stable GTM tag does not need to change. It still loads the SDK and passes user ID, runtime context, and the manifest URL. The SDK is updated to understand configuration schema v2 and select one experiment-level model bucket for all experiment-controlled recommendation keys.

The published CDN manifest and experiment artifacts must use schema version 2. Existing schema-v1 artifacts should be republished/migrated before using SDK v1.1.0.
