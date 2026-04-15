"""
etl/db.py
SQLite 連線、schema 管理與寫入工具
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "agri_prices.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS markets (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT    NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS crops (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT,
    name TEXT    NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS produce_daily_prices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_date  TEXT    NOT NULL,
    market_id   INTEGER NOT NULL REFERENCES markets(id),
    crop_id     INTEGER NOT NULL REFERENCES crops(id),
    upper_price REAL,
    mid_price   REAL,
    lower_price REAL,
    avg_price   REAL,
    volume_kg   REAL,
    UNIQUE (trade_date, market_id, crop_id)
);

CREATE TABLE IF NOT EXISTS fetch_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at       TEXT NOT NULL,
    run_type     TEXT NOT NULL,
    date_start   TEXT NOT NULL,
    date_end     TEXT NOT NULL,
    market       TEXT NOT NULL,
    crop         TEXT NOT NULL,
    rows_fetched INTEGER NOT NULL DEFAULT 0,
    rows_written INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'ok',
    error_msg    TEXT
);

CREATE INDEX IF NOT EXISTS idx_prices_date   ON produce_daily_prices(trade_date);
CREATE INDEX IF NOT EXISTS idx_prices_crop   ON produce_daily_prices(crop_id);
CREATE INDEX IF NOT EXISTS idx_prices_market ON produce_daily_prices(market_id);
"""


def get_db(path: Path = DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA)
    return conn


def upsert_market(conn: sqlite3.Connection, name: str) -> int:
    conn.execute("INSERT OR IGNORE INTO markets (name) VALUES (?)", (name,))
    return conn.execute("SELECT id FROM markets WHERE name=?", (name,)).fetchone()["id"]


def upsert_crop(conn: sqlite3.Connection, code: str, name: str) -> int:
    conn.execute(
        "INSERT OR IGNORE INTO crops (code, name) VALUES (?, ?)", (code, name)
    )
    return conn.execute("SELECT id FROM crops WHERE name=?", (name,)).fetchone()["id"]


def safe_float(val) -> float | None:
    try:
        return float(val) if val not in (None, "", "-") else None
    except (ValueError, TypeError):
        return None


def write_records(conn: sqlite3.Connection, records: list[dict]) -> int:
    """將 API 原始 records 寫入 DB，回傳實際寫入筆數。"""
    written = 0
    for r in records:
        market_id = upsert_market(conn, r["市場名稱"])
        crop_id   = upsert_crop(conn, r.get("作物代號", ""), r["作物名稱"])
        y, m, d   = r["交易日期"].split(".")
        trade_date = f"{int(y) + 1911}-{int(m):02d}-{int(d):02d}"

        cur = conn.execute(
            """
            INSERT OR IGNORE INTO produce_daily_prices
                (trade_date, market_id, crop_id,
                 upper_price, mid_price, lower_price, avg_price, volume_kg)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trade_date, market_id, crop_id,
                safe_float(r.get("上價")),
                safe_float(r.get("中價")),
                safe_float(r.get("下價")),
                safe_float(r.get("平均價")),
                safe_float(r.get("交易量")),
            ),
        )
        written += cur.rowcount
    return written


def log_run(
    conn: sqlite3.Connection,
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
            (run_at, run_type, date_start, date_end, market, crop,
             rows_fetched, rows_written, status, error_msg)
        VALUES (datetime('now','localtime'), ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (run_type, date_start, date_end, market, crop,
         rows_fetched, rows_written, status, error_msg),
    )
