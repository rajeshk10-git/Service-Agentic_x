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
| POST | `/auth/register` | `{ "name", "email", "password" }` | Create user (password hashed with bcrypt) |
| POST | `/auth/login` | `{ "email", "password" }` | Login; returns `user` and optional `token` if `JWT_SECRET` is set |
| POST | `/agent/query` | `{ "userId": string, "query": string }` | Run the agent |
| POST | `/agent/feedback` | `{ "query": string, "response": string, "rating": number }` | Store feedback |
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

**Agent**

```bash
curl -s -X POST http://localhost:3000/agent/query \
  -H "Content-Type: application/json" \
  -d '{"userId":"demo-user","query":"Compare my salary for 2025-03 vs 2025-04"}'
```

Registration can take a moment because of **bcrypt** hashing; lower `BCRYPT_ROUNDS` in `.env` for faster local dev only (not for production).

## Python stubs (optional)

If the Python services are not running, tool calls `calculate_tax` and `parse_salary_slip` return structured errors; the LLM explains the failure without inventing numbers.

Minimal FastAPI examples:

**Tax (`:8001`):** accept JSON body with `annual_gross`, `regime` and return JSON with estimated tax.

**Parse (`:8000`):** accept JSON `{ "text": "..." }` and return extracted fields as JSON.

## Project layout

- `src/services/agent.service.ts` — agent loop (payroll → RAG → LLM → tools)
- `src/services/tool.service.ts` — tool execution (Axios + SQL)
- `src/utils/llm/` — OpenAI / Vertex Gemini completions + tool definitions
- `src/utils/prompt.ts` — system prompts
- `src/services/auth.service.ts` — register / login (bcrypt + optional JWT)
- `sql/schema.sql` — `users`, `Salary`, `Feedback` tables
- `src/db/pool.ts` — shared `pg` connection pool
