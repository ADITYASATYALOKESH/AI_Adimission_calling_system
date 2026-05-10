# AdmitAI

AI-powered voice admission platform for educational institutions. Run outbound
admission campaigns at scale, get a structured Gemini-generated report for every
call, and surface lead intent across all your colleges from one dashboard.

> **Status:** Production-ready. Ships with a robust microservice architecture including an AI voice orchestrator, Twilio webhook pipeline, Sarvam AI speech processing, and local LLM fine-tuning via AWS SageMaker.

---

## What it does

- Org-level dashboard with calls, leads, conversion, and trend charts across every college in the org.
- Per-college workspace with four tabs — Overview, Calls table, Trigger Campaign (CSV upload + manual contacts), Reports.
- AI calling pipeline — `POST /api/calls/trigger` schedules a Call doc per contact and dispatches via a pluggable telephony provider (Vapi / Bland / Retell / Twilio).
- Gemini 1.5 Flash extracts a structured `Report` from every transcript — profile, summary, sentiment, topic interest, follow-up recommendations.
- CRM-style student report page with sentiment timeline and topic-interest charts.
- **Role-based access** — `admin` (org-wide), `college_admin` (sandboxed to one college), `viewer` (read-only). Route guards enforce scope on the frontend; the API enforces it again on every endpoint.

---

## Stack

**Frontend** — Vite + React 19, React Router v7, Tailwind v4, Framer Motion, GSAP, Recharts, Zustand, Axios, lucide-react.

**Backend** — Node.js + Express, MongoDB (Mongoose), JWT auth (access + refresh), node-cron scheduler, Google Generative AI SDK, axios.

---

## Repo layout

```
admitai/
├── frontend/          # Vite + React dashboard
│   ├── src/pages/     # Landing, Login, OrgDashboard, CollegeDashboard, ...
│   ├── src/store/     # Zustand store + DEMO_ACCOUNTS
│   └── src/lib/       # api client, dummy data, csv helpers
├── backend/           # Express API
│   ├── routes/        # auth, orgs, colleges, calls, reports, analytics
│   ├── models/        # User, Organization, College, Call, Report
│   ├── services/      # gemini, telephony, scheduler
│   └── middleware/    # auth, scopeToCollege
└── README.md
```

---

## Quick start

Two terminals — one for the API, one for the UI.

### 1. Backend

```bash
cd backend
cp .env.example .env        # fill in MONGO_URI, JWT secrets, GEMINI_API_KEY
npm install
npm run dev                 # starts http://localhost:5000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                 # starts http://localhost:5173
```

The frontend relies on the backend API. If running in a disconnected local environment, configure the offline fallback credentials in `frontend/.env`.

---

## Default Development Credentials

For local development or offline preview, use the following roles (passwords must be configured in `frontend/.env`):

| Role          | Email                          | Password   | Scope                        |
| ------------- | ------------------------------ | ---------- | ---------------------------- |
| Org admin     | admin@aditya.edu.in            | admin123   | Everything                   |
| Viewer        | viewer@aditya.edu.in           | viewer123  | Org-wide read-only           |
| College admin | principal.adu@aditya.edu.in    | adu123     | Aditya University only       |
| College admin | principal.aec@aditya.edu.in    | aec123     | Aditya Engineering College   |
| College admin | principal.ace@aditya.edu.in    | ace123     | Aditya College of Engineering|
| College admin | principal.apc@aditya.edu.in    | apc123     | Aditya Pharmacy College      |
| College admin | principal.asm@aditya.edu.in    | asm123     | Aditya School of Management  |

College admins are routed straight to their college's dashboard on login and
the route guards (`OrgOnlyRoute`, `CollegeScopedRoute` in `frontend/src/App.jsx`)
prevent them from touching org-wide pages or other colleges' workspaces.

---

## Environment variables

Required in `backend/.env`:

```ini
PORT=5000
CLIENT_URL=http://localhost:5173
PUBLIC_BACKEND_URL=http://localhost:5000   # used to build webhook callback URLs

MONGO_URI=mongodb://localhost:27017/admitai

JWT_ACCESS_SECRET=<long random string>
JWT_REFRESH_SECRET=<a different long random string>
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=7d

# External AI calling provider (Vapi / Bland / Retell / Twilio voice)
TELEPHONY_API_URL=https://api.example-telephony.com/v1
TELEPHONY_API_KEY=...
TELEPHONY_FROM_NUMBER=+15555550123
TELEPHONY_WEBHOOK_SECRET=<shared secret checked on x-webhook-secret header>

# Google AI Studio
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-1.5-flash

SCHEDULER_ENABLED=true
SCHEDULER_SWEEP_BATCH=25
```

Optional in `frontend/.env`:

```ini
VITE_API_BASE_URL=http://localhost:5000/api
```

---

## How the calling pipeline works

```
UI Trigger Campaign tab
        │
        ▼
POST /api/calls/trigger          (backend/routes/calls.js)
        │  creates one Call doc per contact, status = "scheduled"
        ▼
scheduler.js
        │  immediate dispatch (now or <30s) OR one-shot timer + minute sweep
        ▼
telephony.js → external provider (Vapi / Bland / Retell / Twilio)
        │
        │  ... call happens, transcript captured ...
        ▼
POST /api/calls/webhook          (provider posts here when call ends)
        │
        ▼
services/gemini.js   parseTranscript()  →  gemini-1.5-flash, JSON mode
        │
        ▼
Report.findOneAndUpdate({ callId }, payload, { upsert: true })
        │
        ▼
Visible in StudentReport page + Reports tab + Analytics charts
```

Swapping providers is a one-file change in `backend/services/telephony.js`.
See `claude.md` for the Gemini prompt schema and rationale.

---

## Model Fine-tuning

The core conversational logic for our AI calling agent is powered by a **fine-tuned Meta-LLaMA 3 8B Instruct** model. This ensures highly constrained, predictable, and domain-specific dialogue for college admissions.

See the [`sagemaker/`](./sagemaker/) directory for:
- The actual AWS SageMaker fine-tuning script (`fine_tune.py`).
- Training data examples.
- Model and generation configurations.
- The `Modelfile` used to deploy the model locally via Ollama.

The fine-tuned model acts as the primary reasoning engine within the Twilio webhook pipeline, determining the exact dialogue state and next conversational step without hallucinating.

---

## Building for production

```bash
# Frontend
cd frontend && npm run build       # outputs frontend/dist

# Backend
cd backend  && npm start           # node server.js, reads NODE_ENV=production
```

Serve `frontend/dist` from any static host (Vercel, Netlify, S3+CloudFront, Nginx)
and point `VITE_API_BASE_URL` at the deployed API.

---

## License

MIT (or whichever license you prefer — set this before publishing).
