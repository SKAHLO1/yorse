# Yorse — AI-verified escrow

Milestone payments for freelancers, escrowed in **Circle testnet USDC** on **Arbitrum Sepolia** (chain 421614) and released when an AI check confirms the deliverable meets the agreed terms.

```
contracts/   Foundry project: Escrow.sol, fork tests, deploy + smoke scripts
backend/     Express service: relayer wallet, AI layer (Groq → Gemini), Firebase Admin, REST API
app/ …       Next.js frontend: landing, auth, dashboard, jobs, admin panel
```

## How the pieces fit

| Concern | Where it lives |
| --- | --- |
| USDC + job state (Funded → Submitted → Released / Disputed → ResolvedRelease / ResolvedRefund) | `Escrow.sol` on-chain |
| Jobs, submissions, AI verdicts, events, complaints, reviews | Firestore (written only by the backend via Admin SDK) |
| `markSubmitted` / `release` / `dispute` / `refund` | Backend relayer key only (`backend/src/chain/escrow.ts`) |
| AI verdict | `backend/src/ai/*`: returns JSON only, never touches the chain |
| Release decision | `backend/src/ai/decision.ts`: verdict = release **and** confidence ≥ 0.85 **and** every criterion confirmed, otherwise dispute |

Browsers never read or write Firestore directly (`firestore.rules` denies everything). Every API call carries a Firebase ID token that the backend verifies, and all data is scoped to that user. Admins are identified by the Firebase custom claim `admin: true`.

## Job lifecycle

A client either lists a job **publicly** (it appears in every user's live feed and accepts applications) or **invites** one developer by email (private, never in the feed).

0. **Public listings only:** developers browse the feed, apply with a short pitch, and the client picks one. Applications are visible only to the client. Choosing one closes the rest and removes the listing from the feed.
1. **Client** creates a job: terms, acceptance criteria, due date, USDC amount, and either "open to applications" or the developer's email.
2. **Freelancer** accepts the terms.
3. **Client** approves USDC and calls `fund()` from their linked wallet. The backend then verifies that the on-chain client, freelancer and amount match the terms.
4. **Freelancer** submits a link, a file reference and a description. The backend then:
   - calls `markSubmitted()`;
   - fetches the link as evidence (with SSRF protection);
   - runs the AI check;
   - applies the decision rule, then calls `release()` or `dispute()`.
5. **Disputes**: an admin reviews the full history and calls `release()` or `refund()` through the backend.
6. **Non-delivery**: the client (or an admin) can dispute a funded job before any submission.
7. **Feedback**: complaints (private to the filer and admins) and reviews (one per party) open once a job is completed. Admins moderate both.
8. **Ratings**: published reviews roll up into a public rating for each side - `ratingAsFreelancer` and `ratingAsClient`. Only completed jobs produce reviews, hidden reviews are excluded, and the average is recomputed whenever a review is posted or moderated. Anyone can open `/u/<uid>` to see a person's rating, completed-job counts and the reviews behind the score. Profiles never expose email or wallet addresses.

Failures are surfaced, never swallowed:
- **AI outage:** the job stays locked, and the verdict record holds the error and every provider attempt. "Retry" re-runs the check.
- **Chain failure after a verdict:** the verdict is kept. "Retry" re-sends only the transaction; the AI is never asked again.

---

## Setup

### 1. Firebase (console)

1. Create a project, then add a **Web app**. Copy its config into `.env.local` (see `.env.example`).
2. Go to **Authentication → Sign-in method** and enable **Email/Password** and **Google**.
3. Go to **Firestore Database**, create it in production mode, then paste `firestore.rules` into the **Rules** tab and publish.
4. Go to **Project settings → Service accounts → Generate new private key**. Put the JSON path (or its fields) into `backend/.env`.
5. Deploying the frontend somewhere other than localhost? Add that domain under **Authentication → Settings → Authorized domains**.

No composite indexes are required.

### 2. Keys

| Key | Where | Notes |
| --- | --- | --- |
| `RELAYER_PRIVATE_KEY` | `contracts/.env`, `backend/.env` | Fresh testnet-only wallet with Arbitrum Sepolia ETH |
| `GROQ_API_KEY` | `backend/.env` | console.groq.com |
| `GEMINI_API_KEY` | `backend/.env` | aistudio.google.com |
| Firebase service account | `backend/.env` | Server only |
| Firebase web config | `.env.local` | Public by design |

Every `.env*` file is gitignored except the `.env.example` templates.

### 3. Contracts (step 1)

```bash
cd contracts
./install-deps.sh           # lib/ is gitignored (13MB of OpenZeppelin + forge-std)
cp .env.example .env        # RELAYER_PRIVATE_KEY, SMOKE_FREELANCER
forge test -vv              # 13 fork tests against real Circle USDC
forge script script/Deploy.s.sol --rpc-url arbitrum_sepolia --broadcast
# set ESCROW_ADDRESS in contracts/.env and backend/.env, then (needs 0.30 USDC from faucet.circle.com):
forge script script/Smoke.s.sol --rpc-url arbitrum_sepolia --broadcast --slow
```

Foundry lives at `~/.foundry/bin` on this machine; add it to PATH if `forge` is not found.

### 4. Backend (steps 2–4)

```bash
cd backend
pnpm install
cp .env.example .env        # fill in chain, Firebase, AI keys
pnpm test                   # 41 unit/API tests (no keys needed)
pnpm ai:eval                # real Groq + Gemini against real & mismatched submissions
pnpm dev                    # http://localhost:4000  (GET /health shows chain + AI status)
pnpm set-admin you@example.com   # grant admin claim; sign out/in afterwards
```

The server refuses to start if:
- the RPC isn't chain 421614;
- the escrow's token isn't Circle USDC;
- the relayer key doesn't match the escrow's relayer;
- no AI key is set.

### 5. Frontend (steps 5–6)

```bash
pnpm install
cp .env.example .env.local
pnpm dev                    # http://localhost:3000
```

Each user signs in, connects an injected wallet (MetaMask etc.) on Arbitrum Sepolia, and links it by signing a message (free, no transaction).

### 6. End-to-end (step 7)

```bash
# No keys: real Escrow + real USDC on a local fork, full HTTP flow (AI verdicts scripted)
anvil --fork-url https://sepolia-rollup.arbitrum.io/rpc --port 8546
cd backend && pnpm e2e:local

# Live: real Firebase, Groq/Gemini and Arbitrum Sepolia (backend must be running)
#   needs FIREBASE_WEB_API_KEY and E2E_CLIENT_PRIVATE_KEY (ETH + ≥0.20 USDC) in backend/.env
cd backend && pnpm e2e
```

The live run covers:
- **Auto-release:** a real repo that meets the terms.
- **Dispute:** a mismatched repo, then an admin refund.
- **Complaints and reviews:** filed by the parties, then moderated by an admin, with visibility rules checked.

## Out of scope (MVP)

Billing, real payments, multi-milestone contracts, mainnet. (The live feed, applications and cross-job ratings were added after the original MVP brief, at your request.)
