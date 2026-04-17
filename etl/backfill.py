"""
etl/backfill.py
歷史資料補抓腳本（API v1）

用法：
    python -m etl.backfill                          # 預設補抓 2024-01-01 至昨日
    python -m etl.backfill --start 2025-01-01
    python -m etl.backfill --start 2025-01-01 --end 2025-12-31
    python -m etl.backfill --dry-run                # 僅印出請求清單

環境變數：
    MOA_API_KEY  農業部 Open API 金鑰
"""
import argparse
import os
import time
from datetime import date, datetime, timedelta

import requests

from etl.db import DB_PATH, get_db, log_run, write_records

API_BASE = "https://data.moa.gov.tw/api/v1/AgriProductsTransType/"
API_KEY  = os.environ.get("MOA_API_KEY", "")

CROP_CODES = {
    "青花菜": ["FB1"],
    "牛番茄": ["FJ3"],
    "洋蔥":   ["SD1", "SD9"],
}

TARGET_MARKETS = {"台北一", "台北二", "三重區", "板橋區"}

DELAY = 0.3


# ── 工具函式 ──────────────────────────────────────────────────────────────────

def iso(d: date) -> str:
    return d.strftime("%Y-%m-%d")


def to_minguo(d: date) -> str:
    """Convert ISO date to 民國年格式 e.g. 2024-01-01 → 113.01.01"""
    return f"{d.year - 1911}.{d.month:02d}.{d.day:02d}"


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

def fetch_batch(start: date, end: date, crop_code: str) -> tuple[list[dict], str]:
    all_records: list[dict] = []
    page = 1

    while True:
        try:
            resp = requests.get(
                API_BASE,
                params={
                    "apikey":     API_KEY,
                    "format":     "json",
                    "CropCode":   crop_code,
                    "Start_time": to_minguo(start),
                    "End_time":   to_minguo(end),
                    "Page":       page,
                },
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as e:
            return all_records, f"error: {e}"
        except ValueError as e:
            return all_records, f"error: JSON parse failed: {e}"

        if data.get("RS") != "OK":
            return all_records, f"error: RS={data.get('RS')}"

        batch = [r for r in (data.get("Data") or [])
                 if r.get("MarketName") in TARGET_MARKETS]
        all_records.extend(batch)

        if not data.get("Next"):
            break
        page += 1
        time.sleep(DELAY)

    return all_records, "empty" if not all_records else "ok"


# ── 主流程 ────────────────────────────────────────────────────────────────────

def build_jobs(start: date, end: date) -> list[tuple]:
    return [
        (ms, me, display, code)
        for ms, me in month_range(start, end)
        for display, codes in CROP_CODES.items()
        for code in codes
    ]


def run_backfill(start: date, end: date, dry_run: bool = False):
    if not API_KEY and not dry_run:
        print("✗ 未設定環境變數 MOA_API_KEY")
        return 1

    jobs  = build_jobs(start, end)
    total = len(jobs)

    print(f"\n{'═'*60}")
    print(f"  菜價歷史補抓（API v1）")
    print(f"  期間：{iso(start)} ～ {iso(end)}")
    print(f"  品項：{', '.join(CROP_CODES.keys())}")
    print(f"  請求數：{total} 次")
    if dry_run:
        print("  ⚠ DRY RUN — 不實際呼叫 API")
    print(f"{'═'*60}\n")

    if dry_run:
        for i, (ms, me, display, code) in enumerate(jobs, 1):
            print(f"  [{i:3d}/{total}] {iso(ms)}～{iso(me)}  {display} ({code})")
        return 0

    conn          = get_db(DB_PATH)
    total_fetched = 0
    total_written = 0
    errors: list[str] = []

    try:
        for i, (ms, me, display, code) in enumerate(jobs, 1):
            label = f"[{i:3d}/{total}] {iso(ms)}～{iso(me)}  {display} ({code})"
            print(f"  {label}", end="", flush=True)

            records, status = fetch_batch(ms, me, code)
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
                    market="*", crop=f"{display}/{code}",
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
                   default=date(2024, 1, 1), help="起始日（YYYY-MM-DD，預設 2024-01-01）")
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
