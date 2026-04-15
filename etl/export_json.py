"""
etl/export_json.py
從 SQLite 匯出前端所需的 JSON 檔案

輸出：
    data/latest.json        最新交易日行情（含與前日漲跌比較）
    data/history.json       近 90 天每日中價
    data/weekly_digest.json 上週 vs 前週漲跌幅排行
"""
import json
from datetime import date, timedelta
from pathlib import Path

from etl.db import DB_PATH, get_db

DATA_DIR     = Path(__file__).parent.parent / "data"
CROPS        = ["青花菜", "牛番茄", "洋蔥"]
MARKETS      = ["台北一", "台北二", "三重", "桃園"]
HISTORY_DAYS = 90


# ── 最新行情 ──────────────────────────────────────────────────────────────────

def export_latest(conn) -> dict:
    row = conn.execute(
        "SELECT MAX(trade_date) FROM produce_daily_prices"
    ).fetchone()[0]

    if not row:
        return {
            "updated_at": date.today().isoformat(),
            "trade_date": None,
            "crops": CROPS,
            "markets": MARKETS,
            "rows": [],
        }

    latest_date = row
    prev_date   = (date.fromisoformat(latest_date) - timedelta(days=1)).isoformat()

    rows_cur = conn.execute(
        """
        SELECT c.name AS crop, m.name AS market,
               p.mid_price, p.upper_price, p.lower_price, p.volume_kg
        FROM produce_daily_prices p
        JOIN crops   c ON p.crop_id   = c.id
        JOIN markets m ON p.market_id = m.id
        WHERE p.trade_date = ?
        ORDER BY c.name, m.name
        """,
        (latest_date,),
    ).fetchall()

    rows_prev = {
        (r["crop"], r["market"]): r["mid_price"]
        for r in conn.execute(
            """
            SELECT c.name AS crop, m.name AS market, p.mid_price
            FROM produce_daily_prices p
            JOIN crops   c ON p.crop_id   = c.id
            JOIN markets m ON p.market_id = m.id
            WHERE p.trade_date = ?
            """,
            (prev_date,),
        ).fetchall()
    }

    output = []
    for r in rows_cur:
        crop, market = r["crop"], r["market"]
        prev         = rows_prev.get((crop, market))
        change_pct   = None
        if prev and prev > 0 and r["mid_price"] is not None:
            change_pct = round((r["mid_price"] - prev) / prev * 100, 1)
        output.append({
            "crop":        crop,
            "market":      market,
            "mid_price":   r["mid_price"],
            "upper_price": r["upper_price"],
            "lower_price": r["lower_price"],
            "volume_kg":   r["volume_kg"],
            "change_pct":  change_pct,
        })

    return {
        "updated_at": date.today().isoformat(),
        "trade_date": latest_date,
        "crops":      CROPS,
        "markets":    MARKETS,
        "rows":       output,
    }


# ── 歷史走勢 ──────────────────────────────────────────────────────────────────

def export_history(conn, days: int = HISTORY_DAYS) -> dict:
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    rows = conn.execute(
        """
        SELECT p.trade_date AS date,
               c.name       AS crop,
               m.name       AS market,
               p.mid_price,
               p.volume_kg
        FROM produce_daily_prices p
        JOIN crops   c ON p.crop_id   = c.id
        JOIN markets m ON p.market_id = m.id
        WHERE p.trade_date >= ?
        ORDER BY p.trade_date, c.name, m.name
        """,
        (cutoff,),
    ).fetchall()

    return {
        "generated_at": date.today().isoformat(),
        "days":         days,
        "crops":        CROPS,
        "markets":      MARKETS,
        "rows": [
            {
                "date":      r["date"],
                "crop":      r["crop"],
                "market":    r["market"],
                "mid_price": r["mid_price"],
                "volume_kg": r["volume_kg"],
            }
            for r in rows
        ],
    }


# ── 週摘要 ────────────────────────────────────────────────────────────────────

def week_bounds(ref: date) -> tuple[date, date]:
    monday = ref - timedelta(days=ref.weekday())
    return monday, monday + timedelta(days=6)


def export_weekly_digest(conn) -> dict:
    today                 = date.today()
    this_mon, this_sun    = week_bounds(today - timedelta(weeks=1))
    prev_mon, prev_sun    = week_bounds(today - timedelta(weeks=2))

    def avg_by_crop(start: date, end: date) -> dict[str, float | None]:
        rows = conn.execute(
            """
            SELECT c.name        AS crop,
                   AVG(p.mid_price)  AS avg_price,
                   SUM(p.volume_kg)  AS total_volume
            FROM produce_daily_prices p
            JOIN crops c ON p.crop_id = c.id
            WHERE p.trade_date BETWEEN ? AND ?
            GROUP BY c.id
            HAVING total_volume >= 100
            """,
            (start.isoformat(), end.isoformat()),
        ).fetchall()
        return {r["crop"]: round(r["avg_price"], 1) for r in rows}

    this_avg = avg_by_crop(this_mon, this_sun)
    prev_avg = avg_by_crop(prev_mon, prev_sun)

    items = []
    for crop in CROPS:
        t = this_avg.get(crop)
        p = prev_avg.get(crop)
        if t is None or p is None or p == 0:
            continue
        items.append({
            "crop":       crop,
            "this_avg":   t,
            "prev_avg":   p,
            "change_pct": round((t - p) / p * 100, 1),
        })

    items.sort(key=lambda x: x["change_pct"], reverse=True)

    return {
        "generated_at": date.today().isoformat(),
        "this_week": {
            "start": this_mon.isoformat(),
            "end":   this_sun.isoformat(),
            "label": f"{this_mon.month}/{this_mon.day}－{this_sun.month}/{this_sun.day}",
        },
        "prev_week": {
            "start": prev_mon.isoformat(),
            "end":   prev_sun.isoformat(),
        },
        "items": items,
    }


# ── 主程式 ────────────────────────────────────────────────────────────────────

def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = get_db(DB_PATH)

    tasks = {
        "latest.json":        export_latest(conn),
        "history.json":       export_history(conn),
        "weekly_digest.json": export_weekly_digest(conn),
    }

    for filename, data in tasks.items():
        path = DATA_DIR / filename
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        count = len(data.get("rows") or data.get("items") or [])
        print(f"✓ {filename}（{count} 筆）")

    conn.close()


if __name__ == "__main__":
    main()
