# Dev Wrapped — GitHub Activity Analytics

A Spotify Wrapped–inspired breakdown of GitHub activity, built from public event data archived by [GH Archive](https://www.gharchive.org/). Search for a GitHub handle to explore its activity in the collected sample, including event types, repositories, activity patterns, and a rule-based persona. MongoDB aggregation pipelines power the analytics behind a Node.js/Express API and a single-page dashboard.

> **Dataset scope:** this project uses a sample of 16 one-hour GH Archive snapshots taken at 10:00 and 20:00 UTC from **29 September to 6 October 2026**. It is not a complete history of GitHub activity. The measured local dataset contains **1,156,300 events**.

## Features

### Your Wrapped
Enter a GitHub username to view a receipt-style summary of activity found in the sample: total events, event-type breakdown, top repositories, activity by date and weekday/time slot, and a rule-based persona. Results can be cached in the MongoDB `wrapped_summaries` collection to speed up repeat lookups.

### Global overview
Explore overall event volume, bot-flagged versus other accounts, event-type distribution, trending repositories, and organisation activity. Global analytics endpoints use a short in-memory cache.

### Explore Accounts
Browse accounts from the derived `users` collection. Search, filter by account kind, sort by name or event count, paginate the results, and open an account's Wrapped summary.

### Index Lab
Compare a user-timeline query using a collection scan with the same query using the `actor_time` compound index. The endpoint returns MongoDB explain statistics so the impact of indexing can be examined. Query timings vary with machine performance and cache state.

### Event Log
Browse a user's raw events with pagination and filters for event type and repository. The API also includes write endpoints for local development; these are **not protected by authentication** and must not be exposed to the public internet as-is.

## Technology stack

- **Database:** MongoDB; validated event documents, aggregation pipelines, indexes, and derived collections.
- **Backend:** Node.js, Express 5, Mongoose 9, `cors`, and `dotenv`.
- **Frontend:** vanilla HTML, CSS, and JavaScript in `backend/public/index.html`; no frontend build step is required.
- **Ingestion:** Python, PyMongo, and Requests for downloading and inserting GH Archive data.

The current implementation uses rule-based account labels and a `[bot]` login suffix heuristic. It does not claim to verify whether an account is operated by a human, and it does not include a trained machine-learning clustering model.

## Project structure

```text
dev-wrapped/
├── .gitignore
├── ingest.py                   # Downloads snapshots and bulk-loads events
└── backend/
    ├── .env                    # Local configuration; do not commit
    ├── package.json
    ├── package-lock.json
    ├── server.js               # Express app and MongoDB connection
    ├── models/
    │   └── Event.js             # Mongoose model for the events collection
    ├── routes/
    │   ├── wrapped.js            # Per-account Wrapped aggregation
    │   ├── global.js             # Global analytics and account browsing
    │   ├── events.js             # Event log and CRUD endpoints
    │   └── perf.js               # Scan-versus-index explain comparison
    └── public/
        └── index.html            # Single-page dashboard
```

Raw archives and local dependencies are intentionally excluded from Git tracking. The `data/` directory is created locally by ingestion and is not included in the repository.

## Requirements

- MongoDB Server 7.x or 8.x, running locally
- Node.js 18 or newer
- Python 3.10 or newer
- Python packages: `pymongo` and `requests`

The development environment used for the reported measurements included MongoDB 8.2.3, Node.js 24.13.1, Python 3.13.0, and PyMongo 4.19.0.

## Setup

### 1. Start MongoDB

Start your local MongoDB service and ensure it is reachable at `mongodb://127.0.0.1:27017`.

### 2. Ingest the GH Archive snapshots

From the project root, install the Python dependencies and run the ingestion script:

**Windows (PowerShell or Command Prompt):**

```powershell
py -3 -m pip install pymongo requests
py -3 ingest.py
```

**Linux/macOS:**

```bash
python3 -m pip install pymongo requests
python3 ingest.py
```

The script downloads the configured one-hour `.json.gz` snapshots into `data/`, parses the event records, and bulk-inserts them into the local `dev_wrapped` database. Re-running ingestion is designed to avoid duplicate event IDs through the unique event-ID index. Processing time and final counts depend on the configured files and local environment.

The collected sample used for the project currently has **1,156,300 events**. Some snapshot files were much smaller than others, so the sample should not be treated as a uniform or representative view of all GitHub activity.

### 3. Configure the backend

Create `backend/.env` locally with:

```dotenv
MONGO_URI=mongodb://127.0.0.1:27017/dev_wrapped
PORT=3000
```

Keep this file out of version control. Do not put database passwords, tokens, or other secrets in source files.

### 4. Install dependencies and start the API

```bash
cd backend
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). The Express server serves the frontend and API from the same origin. Check [http://localhost:3000/api/health](http://localhost:3000/api/health) to verify that the server is responding.

### 5. Create the performance index

The Index Lab expects an index named `actor_time`. In `mongosh`, run:

```javascript
use dev_wrapped

db.events.createIndex(
  { "actor.login": 1, created_at: -1 },
  { name: "actor_time" }
)
```

The ingestion process also creates or relies on a unique index on the GH Archive event `id`. The project uses additional indexes for event type/date queries, repository lookup, and text search; the Index Lab specifically compares the user/date compound index.

### 6. Prepare derived collections

The dashboard's Explore Accounts page reads the derived `users` collection. The project also uses a derived `repos` collection for repository-level analytics. These collections are built from `events` with MongoDB aggregation pipelines and `$merge`; they are **not raw GH Archive collections**. After a fresh ingestion, run the following in `mongosh` against `dev_wrapped` to create or refresh both collections.

Build `users` (one document per actor login, with event counts by type):

```javascript
use dev_wrapped

db.events.aggregate([
  {
    $group: {
      _id: { login: "$actor.login", type: "$type" },
      actor_id: { $first: "$actor.id" },
      is_bot: { $first: "$is_bot" },
      type_count: { $sum: 1 },
      first_seen: { $min: "$created_at" },
      last_seen: { $max: "$created_at" }
    }
  },
  {
    $group: {
      _id: "$_id.login",
      actor_id: { $first: "$actor_id" },
      is_bot: { $first: "$is_bot" },
      events: { $sum: "$type_count" },
      by_type: { $push: { k: "$_id.type", v: "$type_count" } },
      first_seen: { $min: "$first_seen" },
      last_seen: { $max: "$last_seen" }
    }
  },
  { $set: { by_type: { $arrayToObject: "$by_type" } } },
  {
    $merge: {
      into: "users",
      on: "_id",
      whenMatched: "replace",
      whenNotMatched: "insert"
    }
  }
], { allowDiskUse: true })
```

Build `repos` (one document per repository, with event and distinct-actor counts):

```javascript
db.events.aggregate([
  {
    $group: {
      _id: { name: "$repo.name", repo_id: "$repo.id", actor: "$actor.login" },
      actor_events: { $sum: 1 }
    }
  },
  {
    $group: {
      _id: "$_id.name",
      repo_id: { $first: "$_id.repo_id" },
      events: { $sum: "$actor_events" },
      actors: { $sum: 1 }
    }
  },
  {
    $merge: {
      into: "repos",
      on: "_id",
      whenMatched: "replace",
      whenNotMatched: "insert"
    }
  }
], { allowDiskUse: true })
```

These pipelines may take some time on the full sample. Re-run them after re-ingestion to refresh the summaries.

## API reference

All paths below are relative to `http://localhost:3000`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/wrapped/:username` | Per-account Wrapped summary |
| `GET` | `/api/global/overview` | Overall event volume, account-kind split, and event-type analytics |
| `GET` | `/api/global/trending` | Repositories ranked by distinct non-bot contributors |
| `GET` | `/api/global/orgs` | Organisation activity summary |
| `GET` | `/api/global/automation` | Heuristic list of high-volume, low-repository accounts not marked as bots |
| `GET` | `/api/global/accounts` | Searchable, filterable, sortable, paginated account list |
| `GET` | `/api/events?user=X&type=Y&repo=Z&page=1&limit=20` | Paginated event log with optional filters |
| `POST` | `/api/events` | Insert an event (local development only; unauthenticated) |
| `PUT` | `/api/events/:id` | Update an event by its GH Archive ID (local development only; unauthenticated) |
| `DELETE` | `/api/events/:id` | Delete an event by its GH Archive ID (local development only; unauthenticated) |
| `GET` | `/api/perf/user/:username` | Explain-plan comparison of collection scan and indexed query |

Global analytics endpoints use an in-memory cache with a 10-minute lifetime. Wrapped summaries may be cached in MongoDB in `wrapped_summaries`.

## Persona rules

Persona assignment is rule-based. Rules are checked in this order; the first matching rule wins:

| Persona | Rule |
|---|---|
| **Reviewer** | At least 25% of the account's events are pull-request review or review-comment events |
| **Issue Hunter** | At least 25% are issue or issue-comment events |
| **Pull Request Pro** | At least 25% are pull-request events |
| **Committer** | At least 60% are `PushEvent` events |
| **All-Rounder** | No earlier rule matches |

These labels are project-defined summaries of the sampled events, not official GitHub classifications.

## Bot classification and limitations

- An event is marked as bot activity when the actor login ends with `[bot]`. This is a simple heuristic, not proof of account ownership or automation.
- The automation endpoint uses a separate heuristic based on high event volume and activity concentrated in a small number of repositories. It should be interpreted as a shortlist for inspection, not a definitive bot detector.
- The sample includes two one-hour windows per day over eight days. Accounts active outside those hours may be absent, and counts should not be interpreted as full GitHub totals.
- One collected snapshot was unusually small compared with other sampled hours. This is retained as a data-quality limitation rather than treated as evidence of lower platform-wide activity.
- Query benchmarks are local observations; results depend on hardware, data/cache state, and the query plan. A text-index search is not directly comparable to a different regular-expression query.
- Event write endpoints have no authentication or authorisation in the current implementation. Keep the app local-only unless those endpoints are disabled or secured.
- Docker deployment and machine-learning clustering are not part of the completed implementation described here.

## Indexing results

The following are observed timings from the local dataset of 1,156,300 events. They are examples, not guaranteed performance figures.

| Query | Before index | After index | Documents examined before → after |
|---|---:|---:|---:|
| User timeline, sorted by date | 3,236 ms | 36 ms | 1,156,300 → 203 |
| Event type and date filter | 2,805 ms | 18 ms | 1,156,300 → 6,309 |
| Repository event lookup | 2,905 ms | 2 ms | 1,156,300 → 519 |
| Covered-query candidate | 3,205 ms | 1 ms | 1,156,300 → 0 |

The key lesson is that an appropriate index can reduce the number of documents MongoDB must examine. The covered-query result had zero documents examined because the query could be satisfied from index keys. Actual elapsed times can vary between runs.

## Data source

The raw public event archives are provided by [GH Archive](https://www.gharchive.org/). The project samples the hours starting at **10:00 UTC** and **20:00 UTC** on each date from **29 September through 6 October 2026**. It does not collect a continuous 24-hour stream or a user's complete historical activity.

## License and data use

This repository contains project code and setup instructions; raw archive files and local database data are not committed. Review GH Archive and GitHub's applicable terms before redistributing data or deploying a public service.
