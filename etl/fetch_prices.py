"""
etl/fetch_prices.py
每日抓取農業部農產品交易行情

用法：
    python -m etl.fetch_prices                   # 抓今日
    python -m etl.fetch_prices --date 2026-04-09 # 指定日期
"""
import argparse
import time
from datetime import date, datetime, timedelta

import requests

from etl.db import DB_PATH, get_db, log_run, write_records

API_URL   = "https://data.moa.gov.tw/Service/OpenData/FromM/FarmTransData.aspx"
CROPS     = ["青花菜", "牛番茄", "洋蔥"]
MARKETS   = ["台北一", "台北二", "三重", "桃園"]
PAGE_SIZE = 1000
DELAY     = 0.5  # 每次請求間隔秒數


def to_roc(d: date) -> str:
    return f"{d.year - 1911}.{d.month:02d}.{d.day:02d}"


def fetch_one(target: date, market: str, crop: str) -> tuple[list[dict], str]:
    roc = to_roc(target)
    all_records: list[dict] = []
    skip = 0

    while True:
        try:
            resp = requests.get(
                API_URL,
                params={
                    "$top": PAGE_SIZE,
                    "$skip": skip,
                    "StartDate": roc,
                    "EndDate": roc,
                    "Market": market,
                    "Crop": crop,
                },
                timeout=30,
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


def run_daily(target: date) -> int:
    """回傳錯誤數量（0 = 全部成功）"""
    iso = target.strftime("%Y-%m-%d")
    print(f"\n▶ 抓取 {iso} 資料")
    print(f"  品項：{', '.join(CROPS)}")
    print(f"  市場：{', '.join(MARKETS)}\n")

    conn = get_db(DB_PATH)
    total_written = 0
    errors: list[str] = []

    try:
        for market in MARKETS:
            for crop in CROPS:
                records, status = fetch_one(target, market, crop)
                fetched = len(records)

                if status.startswith("error"):
                    written = 0
                    errors.append(f"{market} / {crop}: {status}")
                else:
                    written = write_records(conn, records)
                    conn.commit()

                log_run(
                    conn,
                    run_type="daily",
                    date_start=iso,
                    date_end=iso,
                    market=market,
                    crop=crop,
                    rows_fetched=fetched,
                    rows_written=written,
                    status=status,
                    error_msg=status if status.startswith("error") else None,
                )
                conn.commit()
                total_written += written

                marker = "✓" if status == "ok" else ("–" if status == "empty" else "✗")
                print(f"  {marker} {market} × {crop}：{fetched} 筆取得 / {written} 筆寫入")
                time.sleep(DELAY)

    finally:
        conn.close()

    print(f"\n完成：共寫入 {total_written} 筆")
    if errors:
        print(f"⚠  錯誤 ({len(errors)} 筆)：")
        for e in errors:
            print(f"   - {e}")

    return len(errors)


def parse_args():
    p = argparse.ArgumentParser(description="抓取農業部蔬菜交易行情（單日）")
    p.add_argument(
        "--date",
        type=lambda s: datetime.strptime(s, "%Y-%m-%d").date(),
        default=date.today(),
        help="抓取日期（YYYY-MM-DD，預設今日）",
    )
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    raise SystemExit(1 if run_daily(args.date) > 0 else 0)
