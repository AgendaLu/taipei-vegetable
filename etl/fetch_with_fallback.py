"""
etl/fetch_with_fallback.py
當日無數據自動回溯的增強版本

用法：
    from etl.fetch_with_fallback import fetch_crop_with_fallback
    records = fetch_crop_with_fallback(target_date, crop_code, max_lookback=3)
"""
import time
from datetime import date, timedelta
from typing import Optional

import requests

from etl.catalog import tracked_crop_codes
from etl.db import write_records

API_BASE = "https://data.moa.gov.tw/api/v1/AgriProductsTransType/"
TARGET_MARKETS = {"台北一", "台北二", "三重區", "板橋區"}
DELAY = 0.3


def to_minguo(d: date) -> str:
    """Convert ISO date to 民國年格式 e.g. 2026-04-17 → 115.04.17"""
    return f"{d.year - 1911}.{d.month:02d}.{d.day:02d}"


def fetch_single_day(target: date, crop_code: str, api_key: str) -> tuple[list[dict], str, date]:
    """
    查詢單一日期的資料，回傳 (records, status, actual_date)
    status: "ok", "empty", "error: ..."
    """
    all_records: list[dict] = []
    page = 1

    while True:
        try:
            resp = requests.get(
                API_BASE,
                params={
                    "apikey":     api_key,
                    "format":     "json",
                    "CropCode":   crop_code,
                    "Start_time": to_minguo(target),
                    "End_time":   to_minguo(target),
                    "Page":       page,
                },
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as e:
            return all_records, f"error: {e}", target
        except ValueError as e:
            return all_records, f"error: JSON parse failed: {e}", target

        if data.get("RS") != "OK":
            return all_records, f"error: RS={data.get('RS')}", target

        batch = [r for r in (data.get("Data") or [])
                 if r.get("MarketName") in TARGET_MARKETS]
        all_records.extend(batch)

        if not data.get("Next"):
            break
        page += 1
        time.sleep(DELAY)

    return all_records, "empty" if not all_records else "ok", target


def fetch_crop_with_fallback(
    target: date,
    crop_code: str,
    api_key: str,
    max_lookback: int = 3,
    verbose: bool = False,
) -> tuple[list[dict], str, Optional[date]]:
    """
    查詢指定日期的資料，如果當日無數據則自動往回查詢。

    Args:
        target: 目標日期
        crop_code: 作物代號
        api_key: MOA API Key
        max_lookback: 最多往回查詢幾天（預設 3 天）
        verbose: 是否印出查詢過程

    Returns:
        (records, status, actual_date)
        - records: 查詢到的記錄清單
        - status: "ok", "empty", "error: ..."
        - actual_date: 實際查到資料的日期（若無資料則為 None）

    Example:
        records, status, actual_date = fetch_crop_with_fallback(
            target=date(2026, 4, 20),
            crop_code="N00100",
            api_key="your_api_key",
            max_lookback=3
        )
        if status == "ok":
            print(f"取得 {len(records)} 筆資料（日期：{actual_date}）")
    """
    current_date = target

    for day_offset in range(max_lookback + 1):
        if verbose:
            print(f"  嘗試查詢 {current_date.strftime('%Y-%m-%d')}")

        records, status, actual_date = fetch_single_day(current_date, crop_code, api_key)

        if status == "ok":
            if verbose:
                print(f"  ✓ 取得資料：{len(records)} 筆（日期：{actual_date.strftime('%Y-%m-%d')}）")
            return records, status, actual_date

        if status.startswith("error"):
            if verbose:
                print(f"  ✗ API 錯誤：{status}")
            return [], status, None

        # status == "empty"，往回查詢
        if verbose:
            print(f"  – 無資料，往回查詢")

        current_date = current_date - timedelta(days=1)
        time.sleep(DELAY)

    # 所有日期都查不到資料
    if verbose:
        print(f"  ✗ 在 {max_lookback + 1} 天內未找到資料")
    return [], "empty", None


def demo():
    """簡單示例"""
    import os
    from datetime import date

    api_key = os.environ.get("MOA_API_KEY", "")
    if not api_key:
        print("✗ 請設定 MOA_API_KEY 環境變數")
        return

    target = date.today()
    crop_code = "N00100"  # 白菜

    print(f"\n▶ 開始查詢 {target.strftime('%Y-%m-%d')} 的白菜資料")
    print(f"  （最多往回查 3 天）\n")

    records, status, actual_date = fetch_crop_with_fallback(
        target=target,
        crop_code=crop_code,
        api_key=api_key,
        max_lookback=3,
        verbose=True,
    )

    print(f"\n結果：{status}")
    if status == "ok" and actual_date:
        print(f"日期：{actual_date.strftime('%Y-%m-%d')}")
        print(f"筆數：{len(records)}")
        if records:
            print(f"\n首筆記錄範例：")
            r = records[0]
            print(f"  市場：{r.get('MarketName')}")
            print(f"  品項：{r.get('CropName')}")
            print(f"  交易量：{r.get('TransQty')}")
            print(f"  平均價：{r.get('AvgPrice')}")


if __name__ == "__main__":
    demo()
