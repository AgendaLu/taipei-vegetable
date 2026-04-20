#!/usr/bin/env python3
"""
example_fallback.py - 自動回溯功能的完整演示

用法：
    export MOA_API_KEY='your_api_key'
    python example_fallback.py
"""

import os
from datetime import date, timedelta

from etl.fetch_with_fallback import fetch_crop_with_fallback, fetch_single_day


def example_basic():
    """基本用法：查詢單日資料"""
    print("\n" + "=" * 60)
    print("【示例 1】基本用法：查詢單日資料")
    print("=" * 60)

    api_key = os.environ.get("MOA_API_KEY")
    if not api_key:
        print("✗ 請設定 MOA_API_KEY 環境變數")
        return

    # 查詢今日白菜
    target = date.today()
    print(f"\n查詢日期：{target.strftime('%Y-%m-%d')}")
    print("品項：白菜（N00100）\n")

    records, status, actual_date = fetch_single_day(
        target=target,
        crop_code="N00100",
        api_key=api_key
    )

    print(f"結果：{status}")
    if status == "ok":
        print(f"筆數：{len(records)}")
        if records:
            r = records[0]
            print(f"\n首筆資料：")
            print(f"  市場：{r.get('MarketName')}")
            print(f"  品項：{r.get('CropName')}")
            print(f"  日期：{r.get('TransDate')}")
            print(f"  交易量：{r.get('TransQty')} kg")
            print(f"  平均價：{r.get('AvgPrice')} 元/kg")


def example_with_fallback():
    """帶回溯的查詢：當日無資料自動查前一日"""
    print("\n" + "=" * 60)
    print("【示例 2】自動回溯：當日無資料查前一日")
    print("=" * 60)

    api_key = os.environ.get("MOA_API_KEY")
    if not api_key:
        print("✗ 請設定 MOA_API_KEY 環境變數")
        return

    target = date.today()
    print(f"\n起始日期：{target.strftime('%Y-%m-%d')}")
    print("品項：蕃茄（N01600）")
    print("最多回溯：3 天\n")

    records, status, actual_date = fetch_crop_with_fallback(
        target=target,
        crop_code="N01600",
        api_key=api_key,
        max_lookback=3,
        verbose=True
    )

    print(f"\n最終結果：{status}")
    if status == "ok" and actual_date:
        print(f"實際取得日期：{actual_date.strftime('%Y-%m-%d')}")
        print(f"筆數：{len(records)}")
        if records:
            r = records[0]
            print(f"\n首筆資料：")
            print(f"  市場：{r.get('MarketName')}")
            print(f"  品項：{r.get('CropName')}")
            print(f"  日期：{r.get('TransDate')}")


def example_compare_dates():
    """比較多個日期的資料情況"""
    print("\n" + "=" * 60)
    print("【示例 3】比較多日期：檢視資料可用性")
    print("=" * 60)

    api_key = os.environ.get("MOA_API_KEY")
    if not api_key:
        print("✗ 請設定 MOA_API_KEY 環境變數")
        return

    today = date.today()
    crop_code = "N00100"  # 白菜

    print(f"\n品項：白菜（{crop_code}）")
    print("檢查最近 7 天的資料可用性：\n")

    for i in range(7):
        check_date = today - timedelta(days=i)
        records, status, _ = fetch_single_day(
            target=check_date,
            crop_code=crop_code,
            api_key=api_key
        )

        marker = {
            "ok": "✓",
            "empty": "–",
        }.get(status[0] if status else "?", "✗")

        count = len(records) if status == "ok" else 0
        print(f"  {marker} {check_date.strftime('%Y-%m-%d')}: {status:15s} ({count} 筆)")


def example_multiple_crops():
    """多品項查詢：依次查詢多個作物"""
    print("\n" + "=" * 60)
    print("【示例 4】多品項查詢：查詢多個作物的可用性")
    print("=" * 60)

    api_key = os.environ.get("MOA_API_KEY")
    if not api_key:
        print("✗ 請設定 MOA_API_KEY 環境變數")
        return

    target = date.today()
    crops = [
        ("N00100", "白菜"),
        ("N00300", "甘藍"),
        ("N01600", "蕃茄"),
        ("N02000", "洋蔥"),
    ]

    print(f"\n查詢日期：{target.strftime('%Y-%m-%d')}")
    print("品項清單：\n")

    for code, name in crops:
        records, status, actual_date = fetch_crop_with_fallback(
            target=target,
            crop_code=code,
            api_key=api_key,
            max_lookback=3,
            verbose=False
        )

        if status == "ok":
            marker = "✓"
            date_str = f"（{actual_date.strftime('%Y-%m-%d')}）" if actual_date else ""
        elif status == "empty":
            marker = "–"
            date_str = "（無資料）"
        else:
            marker = "✗"
            date_str = f"（{status}）"

        print(f"  {marker} {name:10s} ({code}) {len(records):4d} 筆 {date_str}")


def example_date_format_conversion():
    """日期格式轉換示例"""
    print("\n" + "=" * 60)
    print("【示例 5】日期格式轉換：西元年 → 民國年")
    print("=" * 60)

    from etl.fetch_with_fallback import to_minguo

    print("\n轉換範例：\n")

    test_dates = [
        date(2026, 4, 20),
        date(2025, 1, 1),
        date(2024, 12, 31),
    ]

    for d in test_dates:
        minguo = to_minguo(d)
        print(f"  {d.strftime('%Y-%m-%d')} → {minguo}")


if __name__ == "__main__":
    print("\n" + "┏" + "━" * 58 + "┓")
    print("┃  農業部菜價 API - 自動回溯功能演示                           ┃")
    print("┗" + "━" * 58 + "┛")

    try:
        # 執行各個示例
        example_basic()
        example_with_fallback()
        example_compare_dates()
        example_multiple_crops()
        example_date_format_conversion()

        print("\n" + "=" * 60)
        print("✓ 所有示例完成")
        print("=" * 60 + "\n")

    except KeyboardInterrupt:
        print("\n\n⚠ 中斷執行")
    except Exception as e:
        print(f"\n✗ 發生錯誤：{e}")
        import traceback
        traceback.print_exc()
