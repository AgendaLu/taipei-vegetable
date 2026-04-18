"""
etl/catalog.py
crops.yaml 的單一載入點，供 fetch / backfill / export_json 共用。

設計原則：
- crops.yaml 是單一事實來源（Single Source of Truth）。
- 新增品項只需編輯 YAML，無須改 Python 程式碼。
- 把「要抓 / 要匯出 / 要給前端搜尋」三件事一次決定。

主要介面：
- load_catalog()           讀取並回傳原始 YAML dict
- iter_crops()             展平所有 crop 項目為 (category1, category2, crop_dict)
- tracked_crops()          { 顯示名稱: {codes: [...], db_pattern: str} }，供 fetch / backfill
- tracked_crop_map()       { 顯示名稱: db_pattern }，供 export_json SQL LIKE
- flatten_for_frontend()   給前端用的扁平陣列，搭配 Fuse.js 做模糊搜尋
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterator

import yaml

CATALOG_PATH = Path(__file__).parent / "crops.yaml"


def load_catalog(path: Path = CATALOG_PATH) -> dict:
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f)


# ── 遍歷 ─────────────────────────────────────────────────────────────────────

def iter_crops(catalog: dict | None = None) -> Iterator[tuple[str, str, dict]]:
    """回傳 (大類, 分類, crop_dict) 三元組，逐一展開所有品項。"""
    cat = (catalog or load_catalog()).get("catalog") or {}
    for group_name, subcats in (cat or {}).items():
        for subcat_name, items in (subcats or {}).items():
            for crop in (items or []):
                yield group_name, subcat_name, crop


# ── 給 fetch / backfill 用 ───────────────────────────────────────────────────

def tracked_crops(catalog: dict | None = None) -> dict[str, dict]:
    """
    只回傳 tracked: true 的品項，結構：
        {
          "青花菜": {
            "db_pattern": "花椰菜",
            "codes": ["FB1"],
          },
          ...
        }
    codes 只取 `code` 欄位（fetch 只需要代號）。
    """
    out: dict[str, dict] = {}
    for _g, _s, crop in iter_crops(catalog):
        if not crop.get("tracked"):
            continue
        name = crop["crop"]
        codes = [c["code"] for c in (crop.get("codes") or []) if c.get("code")]
        if not codes:
            raise ValueError(f"tracked 品項 {name} 必須至少有一個 code")
        if not crop.get("db_pattern"):
            raise ValueError(f"tracked 品項 {name} 必須設定 db_pattern")
        out[name] = {
            "db_pattern": crop["db_pattern"],
            "codes":      codes,
        }
    return out


def tracked_crop_codes(catalog: dict | None = None) -> dict[str, list[str]]:
    """扁平版本：{ 顯示名稱: [code, ...] }，供 fetch_prices / backfill 直接替代舊 CROP_CODES。"""
    return {name: info["codes"] for name, info in tracked_crops(catalog).items()}


def tracked_crop_map(catalog: dict | None = None) -> dict[str, str]:
    """{ 顯示名稱: DB LIKE pattern }，供 export_json 替代舊 CROP_MAP。"""
    return {name: info["db_pattern"] for name, info in tracked_crops(catalog).items()}


# ── 給前端搜尋用 ────────────────────────────────────────────────────────────

def flatten_for_frontend(catalog: dict | None = None) -> list[dict]:
    """
    產生扁平陣列供前端搜尋使用。
    每筆包含搜尋所需欄位：crop / aliases / 官方全名 / 代號 / 分類 / 是否 tracked。
    """
    out: list[dict] = []
    for group, subcat, crop in iter_crops(catalog):
        names = [c["name"] for c in (crop.get("codes") or []) if c.get("name")]
        codes = [c["code"] for c in (crop.get("codes") or []) if c.get("code")]
        out.append({
            "crop":       crop["crop"],
            "aliases":    list(crop.get("aliases") or []),
            "names":      names,
            "codes":      codes,
            "category":   f"{group} / {subcat}",
            "tracked":    bool(crop.get("tracked")),
        })
    # tracked 品項排前面，其他依大類 / 品項名排序
    out.sort(key=lambda x: (not x["tracked"], x["category"], x["crop"]))
    return out
