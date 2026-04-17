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
HISTORY_DAYS = 90

# ── 名稱對照：API 原始名稱 → 消費者用語 ───────────────────────────────────────
#
# API 回傳的作物名稱格式為「種類-品種」，以 LIKE 子字串比對找到對應資料，
# 再統一對外顯示為消費者熟悉的名稱。
#
# 格式：{ 顯示名稱: DB LIKE 比對字串 }
CROP_MAP = {
    "青花菜": "花椰菜",   # DB: 花椰菜-青梗
    "牛番茄": "牛番茄",   # DB: 番茄-牛番茄
    "洋蔥":   "洋蔥",     # DB: 洋蔥-本產、洋蔥-進口
}

# 格式：{ DB 市場名稱: 顯示名稱 }
MARKET_MAP = {
    "台北一": "台北一",
    "台北二": "台北二",
    "三重區": "三重",
    "板橋區": "板橋",
}

CROPS   = list(CROP_MAP.keys())    # ["青花菜", "牛番茄", "洋蔥"]
MARKETS = list(MARKET_MAP.values()) # ["台北一", "台北二", "三重", "桃農"]


# ── 最新行情 ──────────────────────────────────────────────────────────────────

def _display_crop(db_name: str) -> str | None:
    """DB 作物名稱 → 消費者顯示名稱；不在對照表內的回傳 None。"""
    for display, pattern in CROP_MAP.items():
        if pattern in db_name:
            return display
    return None


def _display_market(db_name: str) -> str:
    """DB 市場名稱 → 顯示名稱；不在對照表內的直接回傳原名。"""
    return MARKET_MAP.get(db_name, db_name)


def _crop_where_clause() -> str:
    """產生 SQL WHERE 子句，僅保留 CROP_MAP 中的品項。"""
    conditions = " OR ".join(f"c.name LIKE '%{p}%'" for p in CROP_MAP.values())
    return f"({conditions})"


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
        f"""
        SELECT c.name AS crop, m.name AS market,
               p.mid_price, p.upper_price, p.lower_price, p.volume_kg
        FROM produce_daily_prices p
        JOIN crops   c ON p.crop_id   = c.id
        JOIN markets m ON p.market_id = m.id
        WHERE p.trade_date = ? AND {_crop_where_clause()}
        ORDER BY c.name, m.name
        """,
        (latest_date,),
    ).fetchall()

    rows_prev = {
        (r["crop"], r["market"]): r["mid_price"]
        for r in conn.execute(
            f"""
            SELECT c.name AS crop, m.name AS market, p.mid_price
            FROM produce_daily_prices p
            JOIN crops   c ON p.crop_id   = c.id
            JOIN markets m ON p.market_id = m.id
            WHERE p.trade_date = ? AND {_crop_where_clause()}
            """,
            (prev_date,),
        ).fetchall()
    }

    # 彙整：同一 (顯示品項, 顯示市場) 取中價平均（應對一對多的 DB 名稱）
    from collections import defaultdict
    buckets: dict[tuple, list] = defaultdict(list)
    for r in rows_cur:
        display_crop   = _display_crop(r["crop"])
        display_market = _display_market(r["market"])
        if display_crop and r["mid_price"]:
            buckets[(display_crop, display_market)].append(r)

    output = []
    for (dcrop, dmkt), rs in sorted(buckets.items()):
        avg_mid   = round(sum(r["mid_price"]   for r in rs if r["mid_price"])   / len(rs), 1)
        avg_upper = round(sum(r["upper_price"] for r in rs if r["upper_price"]) / len(rs), 1) if any(r["upper_price"] for r in rs) else None
        avg_lower = round(sum(r["lower_price"] for r in rs if r["lower_price"]) / len(rs), 1) if any(r["lower_price"] for r in rs) else None
        total_vol = sum(r["volume_kg"] for r in rs if r["volume_kg"])

        # 前日比較（同 DB 名稱取平均）
        prev_vals = [rows_prev[(r["crop"], r["market"])] for r in rs if (r["crop"], r["market"]) in rows_prev]
        prev_avg  = sum(prev_vals) / len(prev_vals) if prev_vals else None
        change_pct = round((avg_mid - prev_avg) / prev_avg * 100, 1) if prev_avg else None

        output.append({
            "crop":        dcrop,
            "market":      dmkt,
            "mid_price":   avg_mid,
            "upper_price": avg_upper,
            "lower_price": avg_lower,
            "volume_kg":   total_vol,
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
        f"""
        SELECT p.trade_date AS date,
               c.name       AS crop,
               m.name       AS market,
               p.mid_price,
               p.volume_kg
        FROM produce_daily_prices p
        JOIN crops   c ON p.crop_id   = c.id
        JOIN markets m ON p.market_id = m.id
        WHERE p.trade_date >= ? AND {_crop_where_clause()}
        ORDER BY p.trade_date, c.name, m.name
        """,
        (cutoff,),
    ).fetchall()

    # 彙整同一 (日期, 顯示品項, 顯示市場) 的多筆 DB 記錄
    from collections import defaultdict
    buckets: dict[tuple, list] = defaultdict(list)
    for r in rows:
        dc = _display_crop(r["crop"])
        dm = _display_market(r["market"])
        if dc and r["mid_price"]:
            buckets[(r["date"], dc, dm)].append(r)

    output = []
    for (trade_date, dcrop, dmkt), rs in sorted(buckets.items()):
        avg_mid = round(sum(r["mid_price"] for r in rs) / len(rs), 1)
        tot_vol = sum(r["volume_kg"] for r in rs if r["volume_kg"])
        output.append({
            "date":      trade_date,
            "crop":      dcrop,
            "market":    dmkt,
            "mid_price": avg_mid,
            "volume_kg": tot_vol,
        })

    return {
        "generated_at": date.today().isoformat(),
        "days":         days,
        "crops":        CROPS,
        "markets":      MARKETS,
        "rows":         output,
    }


# ── 週摘要 ────────────────────────────────────────────────────────────────────

def week_bounds(ref: date) -> tuple[date, date]:
    monday = ref - timedelta(days=ref.weekday())
    return monday, monday + timedelta(days=6)


def export_weekly_digest(conn) -> dict:
    today                 = date.today()
    this_mon, this_sun    = week_bounds(today - timedelta(weeks=1))
    prev_mon, prev_sun    = week_bounds(today - timedelta(weeks=2))

    def avg_by_display_crop(start: date, end: date) -> dict[str, list[float]]:
        """回傳 { 顯示品項名稱: [mid_price, ...] }，供後續取平均。"""
        rows = conn.execute(
            f"""
            SELECT c.name        AS crop,
                   AVG(p.mid_price)  AS avg_price,
                   SUM(p.volume_kg)  AS total_volume
            FROM produce_daily_prices p
            JOIN crops c ON p.crop_id = c.id
            WHERE p.trade_date BETWEEN ? AND ?
              AND {_crop_where_clause()}
            GROUP BY c.id
            HAVING total_volume >= 100
            """,
            (start.isoformat(), end.isoformat()),
        ).fetchall()
        from collections import defaultdict
        buckets: dict[str, list] = defaultdict(list)
        for r in rows:
            dc = _display_crop(r["crop"])
            if dc and r["avg_price"]:
                buckets[dc].append(r["avg_price"])
        return buckets

    this_buckets = avg_by_display_crop(this_mon, this_sun)
    prev_buckets = avg_by_display_crop(prev_mon, prev_sun)

    items = []
    for crop in CROPS:
        t_vals = this_buckets.get(crop)
        p_vals = prev_buckets.get(crop)
        if not t_vals or not p_vals:
            continue
        t = round(sum(t_vals) / len(t_vals), 1)
        p = round(sum(p_vals) / len(p_vals), 1)
        if p == 0:
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


# ── YoY 月均 ──────────────────────────────────────────────────────────────────

def export_yoy(conn) -> dict:
    """
    各品項每個自然月的四市場加權平均中價與總交易量，供前端做 YoY 比較。
    加權方式：volume_kg 為權重。
    """
    rows = conn.execute(
        f"""
        SELECT substr(p.trade_date, 1, 7) AS year_month,
               c.name                     AS crop,
               p.mid_price,
               p.volume_kg
        FROM produce_daily_prices p
        JOIN crops   c ON p.crop_id   = c.id
        JOIN markets m ON p.market_id = m.id
        WHERE {_crop_where_clause()}
          AND p.mid_price  IS NOT NULL
          AND p.volume_kg  IS NOT NULL
          AND p.volume_kg  > 0
        ORDER BY year_month, c.name
        """
    ).fetchall()

    from collections import defaultdict
    # key: (year_month, display_crop)  value: list of (mid_price, volume_kg)
    buckets: dict[tuple, list] = defaultdict(list)
    for r in rows:
        dc = _display_crop(r["crop"])
        if dc:
            buckets[(r["year_month"], dc)].append((r["mid_price"], r["volume_kg"]))

    output = []
    for (year_month, crop), pairs in sorted(buckets.items()):
        total_vol = sum(v for _, v in pairs)
        wavg_mid  = round(sum(p * v for p, v in pairs) / total_vol, 1)
        output.append({
            "year_month": year_month,
            "crop":       crop,
            "avg_mid":    wavg_mid,
            "volume_kg":  round(total_vol),
        })

    # 找出有資料的品項清單（按 CROPS 順序）
    crops_present = [c for c in CROPS if any(r["crop"] == c for r in output)]

    return {
        "generated_at": date.today().isoformat(),
        "crops":        crops_present,
        "rows":         output,
    }


# ── 主程式 ────────────────────────────────────────────────────────────────────

def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = get_db(DB_PATH)

    tasks = {
        "latest.json":        export_latest(conn),
        "history.json":       export_history(conn),
        "weekly_digest.json": export_weekly_digest(conn),
        "yoy.json":           export_yoy(conn),
    }

    for filename, data in tasks.items():
        path = DATA_DIR / filename
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        count = len(data.get("rows") or data.get("items") or [])
        print(f"✓ {filename}（{count} 筆）")

    conn.close()


if __name__ == "__main__":
    main()
