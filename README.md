# Financial Wellness AI Agent (Backend)

Node.js + TypeScript + Express service that powers a personal financial wellness agent using OpenAI tool calling, PostgreSQL via the `pg` driver, optional Python microservices for tax and OCR, and an in-memory RAG stub.

## Prerequisites

- Node.js 18+
- PostgreSQL
- OpenAI API key
- (Optional) Python services on `localhost:8001` (`POST /calculate`) and `localhost:8000` (`POST /parse`)

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment**

   ```bash
   cp .env.example .env
   ```

   Edit `.env`: set `DATABASE_URL`, `OPENAI_API_KEY`, and optionally `JWT_SECRET` (adds `token` on auth responses), `BCRYPT_ROUNDS`, `OPENAI_MODEL`, Python URLs.

3. **Create database tables**

   Apply `sql/schema.sql` to your database (e.g. `psql "$DATABASE_URL" -f sql/schema.sql`), or reuse an existing DB that already matches those tables.

4. **Seed sample payroll data** (optional)

   ```bash
   npm run db:seed
   ```

## Run

**Development (watch):**

```bash
npm run dev
```

**Production build:**

```bash
npm run build
npm start
```

Server listens on `APP_PORT` (default `3000`; Cloud Run’s `PORT` is used as fallback if `APP_PORT` is unset).

## API

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/health` | — | Liveness |
| GET | `/ping` | — | UI online check (`{ "ok": true }`, `Cache-Control: no-store`) |
| POST | `/auth/register` | `{ "name", "email", "password" }` | Create user (password hashed with bcrypt) |
| POST | `/auth/login` | `{ "email", "password" }` | Login; returns `user` and optional `token` if `JWT_SECRET` is set (JWT claims: `sub`, `userId` — same user id — and `email`) |
| POST | `/agent/query` | JSON or multipart | Run the agent (`Authorization: Bearer <jwt>` required; `userId` taken from token). Appends user + assistant rows to `chat_history`; response includes `sessionId` (UUID). Send the same `sessionId` on later turns to group the conversation. |
| POST | `/feedback` | See below | Store chat feedback (requires `Authorization: Bearer <jwt>`) |
| POST | `/agent/feedback` | See below | Same as `/feedback` |
| POST | `/agent/payslip/signed-upload` | `{ "userId", "filename", "contentType" }` | GCS signed URL (when bucket configured) |

### Examples

**Register / login**

```bash
curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Ada Lovelace","email":"ada@example.com","password":"hunter42!"}'

curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ada@example.com","password":"hunter42!"}'
```

**Agent** (requires `JWT_SECRET` in `.env` and `Authorization: Bearer <token>` from auth)

```bash
TOKEN="<paste token from login/register response>"

curl -s -X POST http://localhost:3000/agent/query \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"Compare my salary for 2025-03 vs 2025-04"}'
```

The JSON response includes `sessionId`. For follow-up messages in the same chat, add `"sessionId":"<that-uuid>"` to the body.

**Chat feedback** (`POST /feedback` or `POST /agent/feedback`)

Body (JSON): `query` and `response` are required (user message and assistant reply). Optional: `userId`, `rating` (integer 1–5), `comment` (string, max 4000 chars). Returns `201` with `{ "success": true, "id": <number>, "ok": true }`.

```bash
curl -s -X POST http://localhost:3000/feedback \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"What is PF?","response":"PF is provident fund...","rating":5,"comment":"Very clear"}'
```

Existing databases created before `user_id` / `comment` columns: run `sql/migrations/002_feedback_chat_columns.sql` once.

Registration can take a moment because of **bcrypt** hashing; lower `BCRYPT_ROUNDS` in `.env` for faster local dev only (not for production).

## Python parse stub (optional)

`calculate_tax` runs in-process via `src/services/tax.service.ts` (FY 2025–26 slabs; no Python tax service).

If the Python parse service is not running, `parse_salary_slip` may return structured errors when the text-only path is used without Document AI; the LLM can explain the failure without inventing numbers.

Minimal FastAPI example for **parse (`:8000`):** accept JSON `{ "text": "..." }` and return extracted fields as JSON.

## Project layout

- `src/services/agent.service.ts` — agent loop (payroll → RAG → LLM → tools)
- `src/services/chat-history.service.ts` — append-only `chat_history` rows for `/agent/query`
- `src/services/tool.service.ts` — tool execution (Axios + SQL)
- `src/utils/llm/` — OpenAI / Vertex Gemini completions + tool definitions
- `src/utils/prompt.ts` — system prompts
- `src/services/auth.service.ts` — register / login (bcrypt + optional JWT)
- `sql/schema.sql` — `users`, `salaries`, `chat_history`, `Feedback` tables
- `src/db/pool.ts` — shared `pg` connection pool
