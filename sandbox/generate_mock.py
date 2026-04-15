"""
sandbox/generate_mock.py
產生模擬用的 JSON 資料，放在 sandbox/data/ 供前端沙盒測試。

用法：
    python sandbox/generate_mock.py
"""
import json
import math
import random
from datetime import date, timedelta
from pathlib import Path

random.seed(42)

# ─── 設定 ────────────────────────────────────────────────────────────────────

OUT_DIR = Path(__file__).parent / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

CROPS   = ["青花菜", "牛番茄", "洋蔥"]
MARKETS = ["台北一", "台北二", "三重", "桃園"]

# 各品項基礎價格（元/公斤）與市場偏移
BASE_PRICE = {
    "青花菜": 42.0,
    "牛番茄": 28.0,
    "洋蔥":   16.0,
}
MARKET_OFFSET = {
    "台北一":  0.0,
    "台北二": +1.5,
    "三重":   -1.0,
    "桃園":   -2.0,
}
BASE_VOLUME = {
    "青花菜": {"台北一": 2800, "台北二": 1800, "三重": 1200, "桃園": 900},
    "牛番茄": {"台北一": 3500, "台北二": 2200, "三重": 1600, "桃園": 1100},
    "洋蔥":   {"台北一": 4200, "台北二": 2500, "三重": 1800, "桃園": 1400},
}

HISTORY_DAYS = 90
TODAY = date.today()


# ─── 產生歷史價格序列 ─────────────────────────────────────────────────────────

def make_price_series(base: float, days: int) -> list[float]:
    """
    用加權隨機漫步 + 季節性正弦波模擬價格走勢。
    回傳長度為 days 的 mid_price 列表。
    """
    prices = []
    p = base
    for i in range(days):
        # 季節性：28 天週期的正弦波，振幅 ±8%
        seasonal = base * 0.08 * math.sin(2 * math.pi * i / 28)
        # 隨機漂移：每日 ±3%
        drift = p * random.gauss(0, 0.03)
        # 均值回歸：向 base 拉回
        revert = (base - p) * 0.08
        p = max(p + drift + revert + seasonal * 0.15, base * 0.4)
        prices.append(round(p, 1))
    return prices


# ─── 建立完整歷史資料 ─────────────────────────────────────────────────────────

# 先為每個 (crop, market) 產生 90 天的基礎價格序列
price_series: dict[tuple, list[float]] = {}
for crop in CROPS:
    for market in MARKETS:
        base = BASE_PRICE[crop] + MARKET_OFFSET[market]
        price_series[(crop, market)] = make_price_series(base, HISTORY_DAYS)

start_date = TODAY - timedelta(days=HISTORY_DAYS - 1)

history_rows = []
for day_idx in range(HISTORY_DAYS):
    d = start_date + timedelta(days=day_idx)
    # 週六/週日市場休市（約 20% 機率）—— 簡化版：只跳週日
    if d.weekday() == 6:
        continue
    for crop in CROPS:
        for market in MARKETS:
            mid = price_series[(crop, market)][day_idx]
            spread = mid * random.uniform(0.08, 0.16)
            upper  = round(mid + spread, 1)
            lower  = round(mid - spread * 0.8, 1)
            vol    = int(BASE_VOLUME[crop][market] * random.uniform(0.6, 1.4))
            history_rows.append({
                "date":      d.isoformat(),
                "crop":      crop,
                "market":    market,
                "mid_price": mid,
                "volume_kg": vol,
            })

history_json = {
    "generated_at": TODAY.isoformat(),
    "days":         HISTORY_DAYS,
    "crops":        CROPS,
    "markets":      MARKETS,
    "rows":         history_rows,
}


# ─── 最新行情（最後一個有資料的日期）────────────────────────────────────────

latest_date = max(r["date"] for r in history_rows)
prev_date   = (date.fromisoformat(latest_date) - timedelta(days=1)).isoformat()

def get_mid(d_iso, crop, market):
    for r in reversed(history_rows):
        if r["date"] == d_iso and r["crop"] == crop and r["market"] == market:
            return r["mid_price"]
    return None

latest_rows = []
for crop in CROPS:
    for market in MARKETS:
        mid  = get_mid(latest_date, crop, market)
        prev = get_mid(prev_date,   crop, market)
        change_pct = None
        if mid and prev and prev > 0:
            change_pct = round((mid - prev) / prev * 100, 1)
        base = BASE_PRICE[crop] + MARKET_OFFSET[market]
        spread = (mid or base) * 0.12
        latest_rows.append({
            "crop":        crop,
            "market":      market,
            "mid_price":   mid,
            "upper_price": round((mid or base) + spread, 1),
            "lower_price": round((mid or base) - spread * 0.8, 1),
            "volume_kg":   int(BASE_VOLUME[crop][market] * random.uniform(0.7, 1.2)),
            "change_pct":  change_pct,
        })

latest_json = {
    "updated_at": TODAY.isoformat(),
    "trade_date": latest_date,
    "crops":      CROPS,
    "markets":    MARKETS,
    "rows":       latest_rows,
}


# ─── 週摘要 ───────────────────────────────────────────────────────────────────

def week_bounds(ref: date):
    mon = ref - timedelta(days=ref.weekday())
    return mon, mon + timedelta(days=6)

this_mon, this_sun = week_bounds(TODAY - timedelta(weeks=1))
prev_mon, prev_sun = week_bounds(TODAY - timedelta(weeks=2))

def week_avg(start: date, end: date, crop: str) -> float | None:
    prices = [
        r["mid_price"]
        for r in history_rows
        if r["crop"] == crop and start.isoformat() <= r["date"] <= end.isoformat()
        and r["mid_price"] is not None
    ]
    return round(sum(prices) / len(prices), 1) if prices else None

digest_items = []
for crop in CROPS:
    this_avg = week_avg(this_mon, this_sun, crop)
    prev_avg = week_avg(prev_mon, prev_sun, crop)
    if this_avg is None or prev_avg is None or prev_avg == 0:
        continue
    digest_items.append({
        "crop":       crop,
        "this_avg":   this_avg,
        "prev_avg":   prev_avg,
        "change_pct": round((this_avg - prev_avg) / prev_avg * 100, 1),
    })
digest_items.sort(key=lambda x: x["change_pct"], reverse=True)

digest_json = {
    "generated_at": TODAY.isoformat(),
    "this_week": {
        "start": this_mon.isoformat(),
        "end":   this_sun.isoformat(),
        "label": f"{this_mon.month}/{this_mon.day}－{this_sun.month}/{this_sun.day}",
    },
    "prev_week": {
        "start": prev_mon.isoformat(),
        "end":   prev_sun.isoformat(),
    },
    "items": digest_items,
}


# ─── 寫入檔案 ─────────────────────────────────────────────────────────────────

files = {
    "history.json":       history_json,
    "latest.json":        latest_json,
    "weekly_digest.json": digest_json,
}

for name, data in files.items():
    path = OUT_DIR / name
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    count = len(data.get("rows") or data.get("items") or [])
    print(f"✓ sandbox/data/{name}  ({count} 筆)")

print(f"\n最新交易日：{latest_date}")
print(f"本週區間：{this_mon} ～ {this_sun}")
print(f"前週區間：{prev_mon} ～ {prev_sun}")
print("\n完成！執行以下指令預覽：")
print("  cd taipei-vegetable && python -m http.server 8080")
print("  開啟 http://localhost:8080/sandbox/")
