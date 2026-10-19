import gzip, json, os, requests
from datetime import datetime
from pymongo import MongoClient
from pymongo.errors import BulkWriteError

MONGO_URI = "mongodb://localhost:27017"
DB, COLL = "dev_wrapped", "events"
FILES = (
    [(f"2026-09-{day}", h)
     for day in ("29", "30")
     for h in (10, 20)]
    + [(f"2026-10-{day:02d}", h)
       for day in range(1, 7)
       for h in (10, 20)]
)              
DATA_DIR = "data"
BATCH = 5000

def slim(o):
    if isinstance(o, dict):
        o.pop("performed_via_github_app", None)
        for k, v in list(o.items()):
            if k == "body" and isinstance(v, str):
                if len(v) > 500:
                    o[k] = v[:500]
            else:
                slim(v)
    elif isinstance(o, list):
        for x in o:
            slim(x)

def fetch(day, hour):
    os.makedirs(DATA_DIR, exist_ok=True)
    name = f"{day}-{hour}.json.gz"
    path = os.path.join(DATA_DIR, name)
    if os.path.exists(path):
        return path
    with requests.get(f"https://data.gharchive.org/{name}", stream=True, timeout=60) as r:
        r.raise_for_status()
        with open(path + ".part", "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    os.replace(path + ".part", path)
    return path

def flush(coll, batch):
    try:
        res = coll.insert_many(batch, ordered=False)
        n, dup = len(res.inserted_ids), 0
    except BulkWriteError as e:
        errs = e.details["writeErrors"]
        if any(x["code"] != 11000 for x in errs):
            raise
        n, dup = e.details["nInserted"], len(errs)
    batch.clear()
    return n, dup

def load(path, coll):
    ins = dup = 0
    batch = []
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            e = json.loads(line)
            e["created_at"] = datetime.strptime(e["created_at"], "%Y-%m-%dT%H:%M:%SZ")
            e["is_bot"] = e["actor"]["login"].endswith("[bot]")
            slim(e["payload"])
            batch.append(e)
            if len(batch) >= BATCH:
                n, d = flush(coll, batch); ins += n; dup += d
    if batch:
        n, d = flush(coll, batch); ins += n; dup += d
    return ins, dup

if __name__ == "__main__":
    coll = MongoClient(MONGO_URI)[DB][COLL]
    coll.create_index("id", unique=True)      # makes re-runs safe (duplicates are skipped)
    for day, hour in FILES:
        path = fetch(day, hour)
        ins, dup = load(path, coll)
        print(f"{day} {hour:02d}h  inserted={ins}  duplicates={dup}")
    print("Total:", coll.estimated_document_count())