"""
etl/db.py
PostgreSQL 連線、schema 管理與寫入工具（Supabase）
"""
import os
import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get("DATABASE_URL", "")

_SCHEMA = [
    """CREATE TABLE IF NOT EXISTS markets (
        id   SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE
    )""",
    """CREATE TABLE IF NOT EXISTS crops (
        id   SERIAL PRIMARY KEY,
        code TEXT,
        name TEXT NOT NULL UNIQUE
    )""",
    """CREATE TABLE IF NOT EXISTS produce_daily_prices (
        id          SERIAL PRIMARY KEY,
        trade_date  TEXT    NOT NULL,
        market_id   INTEGER NOT NULL REFERENCES markets(id),
        crop_id     INTEGER NOT NULL REFERENCES crops(id),
        upper_price REAL,
        mid_price   REAL,
        lower_price REAL,
        avg_price   REAL,
        volume_kg   REAL,
        UNIQUE (trade_date, market_id, crop_id)
    )""",
    """CREATE TABLE IF NOT EXISTS fetch_log (
        id           SERIAL PRIMARY KEY,
        run_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        run_type     TEXT NOT NULL,
        date_start   TEXT NOT NULL,
        date_end     TEXT NOT NULL,
        market       TEXT NOT NULL,
        crop         TEXT NOT NULL,
        rows_fetched INTEGER NOT NULL DEFAULT 0,
        rows_written INTEGER NOT NULL DEFAULT 0,
        status       TEXT NOT NULL DEFAULT 'ok',
        error_msg    TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_prices_date   ON produce_daily_prices(trade_date)",
    "CREATE INDEX IF NOT EXISTS idx_prices_crop   ON produce_daily_prices(crop_id)",
    "CREATE INDEX IF NOT EXISTS idx_prices_market ON produce_daily_prices(market_id)",
]


class _PgConn:
    """psycopg2 wrapper — 對外行為與 sqlite3.Connection 相容。"""

    def __init__(self, raw):
        self._conn = raw
        self._cur  = raw.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    def execute(self, sql: str, params=()):
        # Escape literal % (e.g. LIKE patterns) before converting ? to %s
        self._cur.execute(sql.replace("%", "%%").replace("?", "%s"), params)
        return self._cur

    def commit(self):
        self._conn.commit()

    def close(self):
        self._cur.close()
        self._conn.close()


def get_db(url: str = DATABASE_URL) -> _PgConn:
    raw = psycopg2.connect(url)
    with raw.cursor() as cur:
        for stmt in _SCHEMA:
            cur.execute(stmt)
    raw.commit()
    return _PgConn(raw)


def upsert_market(conn: _PgConn, name: str) -> int:
    conn.execute(
        "INSERT INTO markets (name) VALUES (?) ON CONFLICT (name) DO NOTHING", (name,)
    )
    return conn.execute("SELECT id FROM markets WHERE name=?", (name,)).fetchone()["id"]


def upsert_crop(conn: _PgConn, code: str, name: str) -> int:
    conn.execute(
        "INSERT INTO crops (code, name) VALUES (?, ?) ON CONFLICT (name) DO NOTHING",
        (code, name),
    )
    return conn.execute("SELECT id FROM crops WHERE name=?", (name,)).fetchone()["id"]


def safe_float(val) -> float | None:
    try:
        return float(val) if val not in (None, "", "-") else None
    except (ValueError, TypeError):
        return None


def write_records(conn: _PgConn, records: list[dict]) -> int:
    written = 0
    for r in records:
        market_id  = upsert_market(conn, r["MarketName"])
        crop_id    = upsert_crop(conn, r.get("CropCode", ""), r["CropName"])
        y, m, d    = r["TransDate"].split(".")
        trade_date = f"{int(y) + 1911}-{int(m):02d}-{int(d):02d}"

        cur = conn.execute(
            """
            INSERT INTO produce_daily_prices
                (trade_date, market_id, crop_id,
                 upper_price, mid_price, lower_price, avg_price, volume_kg)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (trade_date, market_id, crop_id) DO NOTHING
            """,
            (
                trade_date, market_id, crop_id,
                safe_float(r.get("Upper_Price")),
                safe_float(r.get("Middle_Price")),
                safe_float(r.get("Lower_Price")),
                safe_float(r.get("Avg_Price")),
                safe_float(r.get("Trans_Quantity")),
            ),
        )
        written += cur.rowcount
    return written


def log_run(
    conn: _PgConn,
    *,
    run_type: str,
    date_start: str,
    date_end: str,
    market: str,
    crop: str,
    rows_fetched: int,
    rows_written: int,
    status: str = "ok",
    error_msg: str | None = None,
):
    conn.execute(
        """
        INSERT INTO fetch_log
            (run_type, date_start, date_end, market, crop,
             rows_fetched, rows_written, status, error_msg)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (run_type, date_start, date_end, market, crop,
         rows_fetched, rows_written, status, error_msg),
    )
