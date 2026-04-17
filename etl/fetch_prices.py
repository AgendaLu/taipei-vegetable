"""
etl/fetch_prices.py
每日抓取農業部農產品交易行情（API v1）

用法：
    python -m etl.fetch_prices                   # 抓今日
    python -m etl.fetch_prices --date 2026-04-09 # 指定日期

環境變數：
    MOA_API_KEY  農業部 Open API 金鑰
"""
import argparse
import os
import time
from datetime import date, datetime

import requests

from etl.db import DB_PATH, get_db, log_run, write_records

API_BASE = "https://data.moa.gov.tw/api/v1/AgriProductsTransType/"
API_KEY  = os.environ.get("MOA_API_KEY", "")

# 目標品項：顯示名稱 → [作物代號, ...]
CROP_CODES = {
    "青花菜": ["FB1"],
    "牛番茄": ["FJ3"],
    "洋蔥":   ["SD1", "SD9"],
}

# 僅保留以下市場（MarketName 完全比對）
TARGET_MARKETS = {"台北一", "台北二", "三重區", "桃農"}

DELAY = 0.3


def fetch_crop_range(start: date, end: date, crop_code: str) -> tuple[list[dict], str]:
    """抓取單一作物代號、日期區間資料，回傳 (records, status)。"""
    all_records: list[dict] = []
    page = 1

    while True:
        try:
            resp = requests.get(
                API_BASE,
                params={
                    "apikey":    API_KEY,
                    "format":    "json",
                    "CropCode":  crop_code,
                    "StartDate": start.strftime("%Y-%m-%d"),
                    "EndDate":   end.strftime("%Y-%m-%d"),
                    "Page":      page,
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


def run_daily(target: date) -> int:
    """回傳錯誤數量（0 = 全部成功）"""
    if not API_KEY:
        print("✗ 未設定環境變數 MOA_API_KEY")
        return 1

    iso = target.strftime("%Y-%m-%d")
    print(f"\n▶ 抓取 {iso} 資料")
    print(f"  品項：{', '.join(CROP_CODES.keys())}\n")

    conn = get_db(DB_PATH)
    total_written = 0
    errors: list[str] = []

    try:
        for display_name, codes in CROP_CODES.items():
            for code in codes:
                records, status = fetch_crop_range(target, target, code)
                fetched = len(records)

                if status.startswith("error"):
                    written = 0
                    errors.append(f"{display_name} ({code}): {status}")
                else:
                    written = write_records(conn, records)
                    conn.commit()

                log_run(conn, run_type="daily",
                        date_start=iso, date_end=iso,
                        market="*", crop=f"{display_name}/{code}",
                        rows_fetched=fetched, rows_written=written,
                        status=status,
                        error_msg=status if status.startswith("error") else None)
                conn.commit()
                total_written += written

                marker = "✓" if status == "ok" else ("–" if status == "empty" else "✗")
                print(f"  {marker} {display_name} ({code})：{fetched} 筆取得 / {written} 筆寫入")
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
