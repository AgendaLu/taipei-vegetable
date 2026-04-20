"""
etl/fetch_prices.py
每日抓取農業部農產品交易行情（API v1）

用法：
    python -m etl.fetch_prices                   # 抓今日（無資料自動回溯）
    python -m etl.fetch_prices --date 2026-04-09 # 指定日期
    python -m etl.fetch_prices --no-fallback      # 不使用回溯功能

環境變數：
    MOA_API_KEY     農業部 Open API 金鑰
    LOOKBACK_DAYS   無資料時往回查詢的天數（預設 3）
"""
import argparse
import os
import time
from datetime import date, datetime

import requests

from etl.catalog import tracked_crop_codes
from etl.db import get_db, log_run, write_records

API_BASE = "https://data.moa.gov.tw/api/v1/AgriProductsTransType/"
API_KEY  = os.environ.get("MOA_API_KEY", "")

# 目標品項：顯示名稱 → [作物代號, ...]
# 來源：etl/crops.yaml 中 tracked: true 的品項（單一事實來源）
CROP_CODES = tracked_crop_codes()

# 僅保留以下市場（MarketName 完全比對）
TARGET_MARKETS = {"台北一", "台北二", "三重區", "板橋區"}

DELAY = 0.3
LOOKBACK_DAYS = int(os.environ.get("LOOKBACK_DAYS", "3"))


def to_minguo(d: date) -> str:
    """Convert ISO date to 民國年格式 e.g. 2026-04-17 → 115.04.17"""
    return f"{d.year - 1911}.{d.month:02d}.{d.day:02d}"


def fetch_crop_range(start: date, end: date, crop_code: str) -> tuple[list[dict], str]:
    """抓取單一作物代號、日期區間資料，回傳 (records, status)。"""
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


def fetch_crop_with_fallback(target: date, crop_code: str, max_lookback: int = LOOKBACK_DAYS) -> tuple[list[dict], str, date]:
    """
    抓取單一作物代號，當日無資料自動往回查詢。
    回傳 (records, status, actual_date)
    """
    from datetime import timedelta

    current_date = target

    for day_offset in range(max_lookback + 1):
        records, status = fetch_crop_range(current_date, current_date, crop_code)

        if status == "ok":
            return records, status, current_date

        if status.startswith("error"):
            return records, status, target

        # status == "empty"，往回查詢
        if day_offset < max_lookback:
            current_date = current_date - timedelta(days=1)
            time.sleep(DELAY)
        else:
            break

    return [], "empty", target


def run_daily(target: date, use_fallback: bool = True) -> int:
    """回傳錯誤數量（0 = 全部成功）"""
    if not API_KEY:
        print("✗ 未設定環境變數 MOA_API_KEY")
        return 1

    iso = target.strftime("%Y-%m-%d")
    fallback_desc = f"（往回查詢最多 {LOOKBACK_DAYS} 天）" if use_fallback else "（不使用回溯）"
    print(f"\n▶ 抓取 {iso} 資料 {fallback_desc}")
    print(f"  品項：{', '.join(CROP_CODES.keys())}\n")

    conn = get_db()
    total_written = 0
    errors: list[str] = []

    try:
        for display_name, codes in CROP_CODES.items():
            for code in codes:
                if use_fallback:
                    records, status, actual_date = fetch_crop_with_fallback(target, code)
                    actual_iso = actual_date.strftime("%Y-%m-%d") if actual_date else iso
                else:
                    records, status = fetch_crop_range(target, target, code)
                    actual_iso = iso

                fetched = len(records)

                if status.startswith("error"):
                    written = 0
                    errors.append(f"{display_name} ({code}): {status}")
                else:
                    written = write_records(conn, records)
                    conn.commit()

                log_run(conn, run_type="daily",
                        date_start=iso, date_end=actual_iso,
                        market="*", crop=f"{display_name}/{code}",
                        rows_fetched=fetched, rows_written=written,
                        status=status,
                        error_msg=status if status.startswith("error") else None)
                conn.commit()
                total_written += written

                marker = "✓" if status == "ok" else ("–" if status == "empty" else "✗")
                date_note = f" [{actual_iso}]" if use_fallback and actual_iso != iso else ""
                print(f"  {marker} {display_name} ({code})：{fetched} 筆取得 / {written} 筆寫入{date_note}")
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
    p = argparse.ArgumentParser(description="抓取農業部蔬菜交易行情（單日，含自動回溯）")
    p.add_argument(
        "--date",
        type=lambda s: datetime.strptime(s, "%Y-%m-%d").date(),
        default=date.today(),
        help="抓取日期（YYYY-MM-DD，預設今日）",
    )
    p.add_argument(
        "--no-fallback",
        action="store_true",
        help="不使用自動回溯功能（預設使用）",
    )
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    raise SystemExit(1 if run_daily(args.date, use_fallback=not args.no_fallback) > 0 else 0)
