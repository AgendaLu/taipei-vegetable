"""
etl/backfill.py
歷史資料補抓腳本

用法：
    python -m etl.backfill                          # 預設補抓 2026-01-01 至昨日
    python -m etl.backfill --start 2025-01-01
    python -m etl.backfill --start 2025-01-01 --end 2025-12-31
    python -m etl.backfill --dry-run                # 僅印出請求清單

注意：
    Crop / Market 參數為子字串比對。
    - 花椰菜 → 花椰菜-青梗（即青花菜）
    - 牛番茄 → 番茄-牛番茄
    - 洋蔥   → 洋蔥-本產、洋蔥-進口
    - 桃農   → 桃農（桃園農產，'桃園' 不匹配）
"""

import argparse
import time
import urllib3
from datetime import date, datetime, timedelta
from pathlib import Path

import requests

from etl.db import DB_PATH, get_db, log_run, write_records

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

API_URL   = "https://data.moa.gov.tw/Service/OpenData/FromM/FarmTransData.aspx"
CROPS     = ["花椰菜", "牛番茄", "洋蔥"]
MARKETS   = ["台北一", "台北二", "三重", "桃農"]
PAGE_SIZE = 1000
DELAY     = 0.5


# ── 工具函式 ──────────────────────────────────────────────────────────────────

def to_roc(d: date) -> str:
    return f"{d.year - 1911}.{d.month:02d}.{d.day:02d}"


def iso(d: date) -> str:
    return d.strftime("%Y-%m-%d")


def month_range(start: date, end: date):
    cur = start.replace(day=1)
    while cur <= end:
        if cur.month == 12:
            last = cur.replace(year=cur.year + 1, month=1, day=1) - timedelta(days=1)
            nxt  = cur.replace(year=cur.year + 1, month=1, day=1)
        else:
            last = cur.replace(month=cur.month + 1, day=1) - timedelta(days=1)
            nxt  = cur.replace(month=cur.month + 1, day=1)
        yield cur, min(last, end)
        cur = nxt


# ── API 呼叫 ──────────────────────────────────────────────────────────────────

def fetch_batch(start: date, end: date, market: str, crop: str) -> tuple[list[dict], str]:
    all_records: list[dict] = []
    skip = 0
    while True:
        try:
            resp = requests.get(
                API_URL,
                params={
                    "$top":      PAGE_SIZE,
                    "$skip":     skip,
                    "StartDate": to_roc(start),
                    "EndDate":   to_roc(end),
                    "Market":    market,
                    "Crop":      crop,
                },
                timeout=30,
                verify=False,
            )
            resp.raise_for_status()
            batch = resp.json()
        except requests.RequestException as e:
            return all_records, f"error: {e}"
        except ValueError as e:
            return all_records, f"error: JSON parse failed: {e}"

        if not batch:
            break
        all_records.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        skip += PAGE_SIZE
        time.sleep(DELAY)

    return all_records, "empty" if not all_records else "ok"


# ── 主流程 ────────────────────────────────────────────────────────────────────

def build_jobs(start: date, end: date) -> list[tuple]:
    return [
        (ms, me, market, crop)
        for ms, me in month_range(start, end)
        for market in MARKETS
        for crop   in CROPS
    ]


def run_backfill(start: date, end: date, dry_run: bool = False):
    jobs  = build_jobs(start, end)
    total = len(jobs)

    print(f"\n{'═'*60}")
    print(f"  菜價歷史補抓")
    print(f"  期間：{iso(start)} ～ {iso(end)}")
    print(f"  品項：{', '.join(CROPS)}")
    print(f"  市場：{', '.join(MARKETS)}")
    print(f"  請求數：{total} 次")
    if dry_run:
        print("  ⚠ DRY RUN — 不實際呼叫 API")
    print(f"{'═'*60}\n")

    if dry_run:
        for i, (ms, me, market, crop) in enumerate(jobs, 1):
            print(f"  [{i:3d}/{total}] {iso(ms)}～{iso(me)}  {market}  {crop}")
        return

    conn           = get_db(DB_PATH)
    total_fetched  = 0
    total_written  = 0
    errors: list[str] = []

    try:
        for i, (ms, me, market, crop) in enumerate(jobs, 1):
            label = f"[{i:3d}/{total}] {iso(ms)}～{iso(me)}  {market:<5}  {crop}"
            print(f"  {label}", end="", flush=True)

            records, status = fetch_batch(ms, me, market, crop)
            fetched = len(records)

            if status.startswith("error"):
                written = 0
                errors.append(f"{label} → {status}")
                print(f"  ✗ {status}")
            else:
                written = write_records(conn, records)
                conn.commit()
                marker = "✓" if status == "ok" else "–"
                print(f"  {marker}  {fetched} 筆取得 / {written} 筆寫入")

            log_run(conn, run_type="backfill",
                    date_start=iso(ms), date_end=iso(me),
                    market=market, crop=crop,
                    rows_fetched=fetched, rows_written=written,
                    status=status,
                    error_msg=status if status.startswith("error") else None)
            conn.commit()

            total_fetched += fetched
            total_written += written
            time.sleep(DELAY)

    except KeyboardInterrupt:
        print("\n\n  ⚠ 中斷，已儲存進度。重新執行可繼續（INSERT OR IGNORE 保護）。")
    finally:
        conn.close()

    print(f"\n{'═'*60}")
    print(f"  完成｜總取得：{total_fetched} 筆｜總寫入：{total_written} 筆")
    if errors:
        print(f"\n  ⚠ 錯誤清單（{len(errors)} 筆）：")
        for e in errors:
            print(f"    - {e}")
    print(f"  資料庫：{DB_PATH}")
    print(f"{'═'*60}\n")
    return len(errors)


# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="補抓農業部蔬菜交易歷史行情")
    p.add_argument("--start", type=lambda s: datetime.strptime(s, "%Y-%m-%d").date(),
                   default=date(2026, 1, 1), help="起始日（YYYY-MM-DD，預設 2026-01-01）")
    p.add_argument("--end",   type=lambda s: datetime.strptime(s, "%Y-%m-%d").date(),
                   default=date.today() - timedelta(days=1), help="結束日（預設昨日）")
    p.add_argument("--dry-run", action="store_true", help="只印清單，不抓取")
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    if args.start > args.end:
        print("錯誤：--start 不可晚於 --end")
        raise SystemExit(1)
    raise SystemExit(0 if run_backfill(args.start, args.end, args.dry_run) == 0 else 1)
