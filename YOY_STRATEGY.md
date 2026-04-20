# YoY 数据策略：分离静态与动态数据

## 现状分析

✅ **已有数据**：
- 2024 全年（12 个月）
- 2025 全年（12 个月）  
- 2026 当年（4 个月）

**存储现状**：
- `data/yoy.json`：3.5 KB，包含所有年份数据
- 数据库查询：每次 `export_json` 都要扫描 ~1000 行

---

## 方案对比

### 方案 A：全量静态化（推荐 ⭐）

**策略**：
1. GitHub 存储 2024-2025 静态数据（`yoy_historical_2024_2025.json`）
2. `yoy.json` 只包含当年 2026 月均数据
3. 前端合并两个 JSON：历史 + 当年

**优点**：
- 🚀 **数据库查询减少 67%**（只查当年）
- 💰 **Supabase 流量降低 67%**
- 📦 **GitHub CDN 加载更快**（静态文件）
- 🔄 **历史数据永不变更**（可启用缓存）

**缺点**：
- 前端需要合并两个 JSON 源
- 品项增加时需要手动更新历史文件

**实施工作量**：⭐ 1 天

---

### 方案 B：混合方案（平衡）

**策略**：
1. `yoy.json` 包含当年 + 去年（2025-2026）
2. 静态历史文件包含更早数据（2024 之前）
3. 每年轮转：当 2027 到来时，2024 数据转入静态文件

**优点**：
- 🎯 **查询量仍减少 ~50%**
- 📊 **前端代码简化**（通常只需当年 + 去年）
- 🔄 **自动轮转**，最多 2 年数据在 DB

**缺点**：
- 每年需要维护脚本
- 中等复杂性

**实施工作量**：⭐⭐ 2-3 天

---

### 方案 C：保持现状（不推荐）

**现状**：
- 每日 `export_json` 扫描完整 produce_daily_prices 表
- YoY 查询涉及所有年份 (~3000 行)

**缺点**：
- ❌ 品项增加到 10 个时会有明显性能下降
- ❌ 50+ 品项时查询会变得很慢
- ❌ 浪费 Supabase 免费层配额

---

## 推荐实施方案 A 的步骤

### Step 1：创建静态文件 ✅（已完成）

```
data/yoy_historical_2024_2025.json   (1.8 KB)
```

### Step 2：修改 export_json.py

修改 `export_yoy()` 函数，只查询当年数据：

```python
def export_yoy(conn) -> dict:
    """只导出当年（2026）的月均数据。"""
    current_year = date.today().year
    
    rows = conn.execute(
        f"""
        SELECT LEFT(p.trade_date, 7) AS year_month,
               c.name                 AS crop,
               p.mid_price,
               p.volume_kg
        FROM produce_daily_prices p
        JOIN crops c ON p.crop_id = c.id
        WHERE LEFT(p.trade_date, 4) = ?    -- 仅当年
          AND {_crop_where_clause()}
          AND p.mid_price  IS NOT NULL
          AND p.volume_kg  > 0
        ORDER BY year_month, c.name
        """,
        (str(current_year),),
    ).fetchall()
    # ... 其余逻辑不变
```

**预期结果**：
- `yoy.json` 从 1.5 KB → 0.4 KB（仅 4 个月数据）
- 查询时间从 ~200ms → ~50ms

### Step 3：前端适配（app.js）

```javascript
// 加载历史数据（从 GitHub）
const historical = await fetch(
  'https://raw.githubusercontent.com/YOUR_USER/taipei-vegetable/main/data/yoy_historical_2024_2025.json'
).then(r => r.json());

// 加载当年数据（从服务器）
const current = await fetch('/data/yoy.json').then(r => r.json());

// 合并
const allData = {
  crops: current.crops,
  rows: [...historical.rows, ...current.rows]
};
```

### Step 4：年度维护流程（2027 年 1 月）

当 2027 年开始时：

```python
# 脚本：每年 1 月 1 日运行
def archive_yoy_history():
    """将去年数据追加到静态历史文件。"""
    current_year = date.today().year
    archive_year = current_year - 1
    
    # 1. 从数据库查询去年数据
    yoy_data = fetch_yoy_for_year(archive_year)
    
    # 2. 追加到 yoy_historical.json
    # 3. 从 yoy.json 中清除
```

---

## 成本效益分析

### Supabase 数据库查询成本

| 方案 | 查询 | 扫描行数 | 月流量 | 年成本 |
|------|------|---------|--------|--------|
| 现状（全年） | 1 | 3000 | 90K | 免费 |
| 方案 A（当年） | 1 | 750 | 22.5K | 🎉 **免费** |
| 10 品项现状 | 1 | 30K | 900K | ⚠️ 接近限制 |
| 10 品项方案 A | 1 | 7.5K | 225K | 🎉 **免费** |
| 50 品项现状 | 1 | 150K | 4.5M | ❌ 需付费 |
| 50 品项方案 A | 1 | 37.5K | 1.1M | ✅ **仍免费** |

### GitHub 原始文件 CDN 加载

```
静态文件地址：
https://raw.githubusercontent.com/YOUR_USER/taipei-vegetable/main/data/yoy_historical_2024_2025.json

特点：
- 由 Fastly CDN 加速
- 支持缓存（Cache-Control: max-age=86400）
- 完全免费
- 带宽无限制
```

---

## 实施时间表

| 里程碑 | 时间 | 工作 |
|--------|------|------|
| 静态文件准备 | 2026-04-19 | ✅ 完成 |
| 修改 export_json.py | 2026-04-19 | ⏳ 待做 |
| 前端适配 | 2026-04-20 | ⏳ 待做 |
| 测试部署 | 2026-04-21 | ⏳ 待做 |
| 上线 | 2026-04-22 | ⏳ 待做 |

---

## 长期扩展规划

### 当品项增加到 10+ 时

**立即应用**：使用方案 A（当年 + 静态历史）

**额外优化**：
1. 按品项拆分历史文件
   ```
   yoy_historical_2024_2025_青花菜.json
   yoy_historical_2024_2025_牛番茄.json
   yoy_historical_2024_2025_洋蔥.json
   ```

2. 前端按需加载
   ```javascript
   const historical = await fetch(
     `/data/yoy_historical_2024_2025_${selectedCrop}.json`
   );
   ```

### 当品项增加到 50+ 时

**必须优化**：
1. 改用增量导出（仅导出最近 7 天变化）
2. 历史数据全部转向 GitHub
3. 考虑使用数据仓库（BigQuery）做聚合

---

## 快速开始

### 立即可做的事

1. **提交静态文件** ✅
   ```bash
   git add data/yoy_historical_2024_2025.json
   git commit -m "data: add YoY historical 2024-2025 baseline"
   git push
   ```

2. **测试文件访问** ✅
   ```bash
   curl https://raw.githubusercontent.com/YOUR_USER/taipei-vegetable/main/data/yoy_historical_2024_2025.json
   ```

### 下一步（推荐在 2026-04-22 进行）

1. 修改 `export_yoy()` 只查询当年
2. 更新前端合并逻辑
3. 测试 YoY 功能
4. 部署上线

---

## 监控指标

实施后需要监控：

```sql
-- 每日 export_yoy() 查询性能
SELECT 
  DATE(created_at) as day,
  ROUND(AVG(duration_ms), 1) as avg_duration_ms,
  MAX(duration_ms) as max_duration_ms
FROM query_logs
WHERE query ILIKE '%export_yoy%'
GROUP BY day
ORDER BY day DESC;
```

预期改进：
- 查询时间：~200ms → ~50ms（75% ↓）
- 数据库扫描行数：~3000 → ~750（75% ↓）
