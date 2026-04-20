# 台北蔬菜行情 ETL 架构分析
## Supabase 迁移后的流程和性能影响评估

**分析日期**：2026-04-19  
**当前数据范围**：2024-01-01 ~ 2026-04-18（~850天）  
**当前追踪品项**：3 个（青花菜、牛番茄、洋蔥）  
**目标市场**：4 个（台北一、台北二、三重、板橋）

---

## 一、每日 ETL 流程概览

### 1.1 日常数据抓取流程（fetch_prices.py）

```
農業部 API → 品項迴圈 → 市場過濾 → 資料入庫 → 日誌記錄
     ↓          ↓
  v1 API      3 品項  
```

**时间表示**（假设每天 00:00 运行）：
1. `fetch_prices` 被触发（cron 或手动）
2. 对每个 tracked 品项（目前 3 个）：
   - 调用农业部 API（分页处理）
   - 过滤 4 个目标市场
   - 写入 `produce_daily_prices` 表
3. 记录到 `fetch_log`
4. 导出 JSON（`export_json.py`）提供给前端

**关键参数**：
- API 延迟：0.3 秒/请求（防止频率限制）
- 数据库事务：每品项一次提交
- 去重机制：`ON CONFLICT (trade_date, market_id, crop_id) DO NOTHING`

---

## 二、数据库架构

### 2.1 表结构与索引

| 表名 | 行数估计 | 用途 |
|------|---------|------|
| `markets` | 4 | 市场映射 |
| `crops` | 3 | 品项映射 |
| `produce_daily_prices` | ~8,500 | 价格数据（主表）|
| `fetch_log` | ~600 | 执行日志 |

**主表索引**：
```sql
- trade_date     -- 历史查询（常用）
- crop_id        -- 品项过滤
- market_id      -- 市场过滤
- (trade_date, market_id, crop_id)  -- UNIQUE 约束
```

### 2.2 关键查询模式

**导出 latest.json** 时的查询：
```sql
SELECT ... FROM produce_daily_prices p
  JOIN crops c, markets m
  WHERE p.trade_date = ? 
    AND (c.name LIKE '%花椰菜%' OR c.name LIKE '%番茄%' ...)
  ORDER BY c.name, m.name
```

**导出 history.json** 时（近 90 天）：
```sql
SELECT ... FROM produce_daily_prices p
  WHERE p.trade_date >= ?   -- 受 trade_date 索引优化
    AND (c.name LIKE ...)
```

---

## 三、Supabase 迁移后的流量影响

### 3.1 数据库连接频率

| 操作 | 频率 | 连接数 | 事务数 |
|------|------|--------|--------|
| 日抓取 | 每天 1 次 | 1 | 3+ 次提交 |
| 导出 JSON | 每天 1 次 | 1 | 5 次查询 |
| 页面查询 | 实时 | 按访问量 | 变量 |

**每日数据库访问量**：
- **写入操作**：~24-36 条记录/天（3 品项 × 4 市场 × 1.5-3 条记录）
- **日志记录**：~3-5 条记录/天
- **读取操作**（导出）：~5 次查询，扫描 ~1,000-3,000 行

### 3.2 Supabase 计费影响（免费层）

**当前状态**：
- **数据库大小**：~5-10 MB（含索引）
  - produce_daily_prices：~3 MB
  - fetch_log：~0.5 MB
  - 其他表及索引：~1-2 MB
- **Storage API 调用**：~50-100 次/天（JSON 导出）
- **免费层配额**：500 MB 数据库空间，无存储 API 费用

**评估**：✅ **完全在免费层范围内**

---

## 四、Supabase PostgreSQL vs SQLite 的差异

| 特性 | SQLite | Supabase PG |
|------|--------|-----------|
| 并发连接 | 1（单进程）| 100+ |
| 事务隔离 | 默认 serializable | 默认 READ COMMITTED |
| 参数化查询 | `?` | `%s` |
| LIKE 性能 | 无全文索引 | 可用 GIN 索引 |
| 连接开销 | 无（本地） | ~50-100ms |
| 自动备份 | 无 | 包含 |

**关键调整**（etl/db.py 已处理）：
```python
# LIKE 查询中，% 需要转义
sql.replace("%", "%%").replace("?", "%s")
```

---

## 五、品项增加的影响预测

### 5.1 线性增长场景

假设品项从 3 个扩展到 **N 个**：

#### N = 10（增加 7 个品项）

**存储增长**：
- produce_daily_prices：~28,000 行（3.3 倍）→ ~10 MB
- 总数据库大小：~30-35 MB
- **影响**：仍在免费层范围内 ✅

**流量增长**：
- 每日 API 调用：10 次（从 3 次）
- 每日写入记录数：~80-120 条
- 导出查询：扫描 ~3,300 行
- **影响**：可接受，无需优化 ✅

**耗时估计**：
```
单次 fetch_prices：
  - API 调用：10 × (0.5-2s) ≈ 5-20s
  - 数据库写入：~5s
  - 总耗时：~10-25s（取决于 API 响应）
```

#### N = 30（增加 27 个品项）

**存储增长**：
- produce_daily_prices：~85,000 行（10 倍）→ ~30 MB
- 总数据库大小：~50-60 MB
- **影响**：仍在免费层范围内 ✅

**流量增长**：
- 每日 API 调用：30 次
- 每日写入记录数：~240-360 条
- 导出查询：扫描 ~10,000 行
- **影响**：开始需要关注查询性能 ⚠️

**潜在瓶颈**：
```
- export_json 中的 LIKE 查询可能变慢
  （30 个 OR 条件 vs 3 个）
- fetch_prices 总耗时可能达到 1-2 分钟
```

#### N = 100（增加 97 个品项）

**存储增长**：
- produce_daily_prices：~280,000 行（33 倍）→ ~100 MB
- 总数据库大小：~150-200 MB
- **影响**：可能接近免费层限制，需评估 ⚠️

**流量增长**：
- 每日 API 调用：100 次 → ~100-500 秒
- 每日写入记录数：~800-1,200 条
- 导出查询：扫描 ~35,000 行
- **影响**：需要架构优化 ❌

**必需的优化**：
1. 批量 API 调用（并行化）
2. 分布式数据抓取
3. 物化视图或数据聚合
4. 增量导出而非全量重建

---

## 六、性能优化建议

### 6.1 当前状态（3-10 品项）

**无需优化** ✅，但可做的改进：

1. **批量提交**（当前逐品项提交）
```python
# 目前：3 个品项 = 3 次 commit
# 改进：所有品项完成后一次 commit
```

2. **连接复用**
```python
# 目前：get_db() 每次都新建连接
# 改进：保持单一连接直到最后
```

3. **导出优化**
```python
# 目前：5 次独立查询
# 改进：使用 WITH 子句减少扫描次数
```

### 6.2 中期优化（10-50 品项）

**应该实施** ⚠️

1. **缓存 CROP_MAP 对应关系**
```sql
-- 创建物化视图
CREATE MATERIALIZED VIEW crop_display AS
  SELECT id, name, display_name FROM crops;
```

2. **分时段导出**
```python
# 不一次性导出 90 天所有数据
# 改为导出 latest + 周数据 + 月数据（缓存）
```

3. **异步 API 调用**
```python
# 使用 asyncio 或 concurrent.futures
# 将 10 次串行调用变成 3-5 并发
```

### 6.3 长期架构（50+ 品项）

**必须重构** ❌

1. **数据分片**
- 按品项分片存储
- 或者按日期分区：`produce_daily_prices_2024`, `produce_daily_prices_2025` ...

2. **消息队列**
```
API 抓取 → Redis Queue → 多个 Worker 并行写入
```

3. **增量导出**
```python
# 不导出全部 90 天
# 只导出最新 1 天 + 缓存历史
```

4. **专用数据仓库**
- Supabase (PG) 用于实时查询
- BigQuery/Snowflake 用于历史分析

---

## 七、关键指标监控

### 7.1 需要定期检查的指标

```sql
-- 1. 数据增长速度
SELECT COUNT(*) FROM produce_daily_prices;
SELECT 
  DATE_TRUNC('month', trade_date) AS month,
  COUNT(*) as row_count
FROM produce_daily_prices
GROUP BY month
ORDER BY month DESC;

-- 2. 最大查询耗时（导出操作）
SELECT 
  date,
  MAX(total_duration_ms) as slowest_query
FROM pg_stat_statements
WHERE query ILIKE '%produce_daily_prices%'
GROUP BY date
ORDER BY date DESC;

-- 3. 抓取日志统计
SELECT 
  DATE_TRUNC('day', run_at) as day,
  COUNT(*) as total_runs,
  SUM(rows_fetched) as total_fetched,
  SUM(rows_written) as total_written
FROM fetch_log
GROUP BY day
ORDER BY day DESC;
```

### 7.2 Supabase 仪表板检查项

- **Database Size**：current size vs 500 MB limit
- **Connection Count**：peak 时是否接近 100
- **Query Performance**：慢查询分析

---

## 八、风险评估与建议

### 8.1 近期（3-10 品项）

| 风险 | 概率 | 影响 | 建议 |
|-----|------|------|------|
| 存储不足 | 低 | 无 | 无需处理 |
| 查询变慢 | 低 | 低 | 监控 `export_json` 耗时 |
| API 限流 | 低 | 中 | 保持 0.3s 延迟 |

**建议**：继续按现有架构，每周检查一次日志

### 8.2 中期（10-50 品项）

**预期在 2026 年底**

| 风险 | 概率 | 影响 | 建议 |
|-----|------|------|------|
| export_json 超时 | 中 | 中 | 优化 WHERE 子句，引入缓存 |
| 抓取耗时过长 | 中 | 低 | 并行化 API 调用 |
| 冷启动连接延迟 | 低 | 低 | 连接池管理 |

**建议**：
1. 开始异步化 API 调用
2. 导出分离为 real-time + batch 流程
3. 评估是否需要升级 Supabase 计划

### 8.3 长期（50+ 品项）

**预期在 2027 年后**

| 风险 | 概率 | 影响 | 建议 |
|-----|------|------|------|
| 数据库 I/O 瓶颈 | 高 | 高 | 升级或迁移 |
| 抓取排期冲突 | 高 | 中 | 重构为微服务 |
| 存储成本增加 | 高 | 中 | 评估付费计划 |

**建议**：
1. 考虑 Supabase 付费计划或迁移到 RDS
2. 引入数据仓库（BigQuery/Snowflake）
3. 重新评估整体架构

---

## 九、关键结论

### ✅ 现状评价

1. **Supabase 迁移成功**
   - PostgreSQL 连接管理良好
   - ON CONFLICT 机制有效
   - 索引设计合理

2. **架构可扩展性**
   - 3-10 品项：无瓶颈 ✅
   - 10-50 品项：需优化但可行 ⚠️
   - 50+ 品项：需重构 ❌

3. **成本控制**
   - 当前完全在免费层范围
   - 预计 2027 前都可在免费层

### 📊 扩展路线图

| 阶段 | 品项数 | 预期时间 | 主要改动 | 成本影响 |
|------|--------|---------|---------|---------|
| Phase 1 | 3-10 | 现在 ~ 2026.12 | 批量优化 | 无 |
| Phase 2 | 10-50 | 2027.01 ~ 2027.06 | 异步化、缓存 | 无/评估 |
| Phase 3 | 50+ | 2027.07+ | 微服务、数仓 | 需付费 |

---

## 附录：快速诊断命令

```bash
# 检查当前存储大小
python -c "
from etl.db import get_db
conn = get_db()
result = conn.execute('SELECT COUNT(*) as cnt FROM produce_daily_prices').fetchone()
print(f'Total records: {result[\"cnt\"]}')
"

# 导出性能测试
time python -m etl.export_json

# 检查最新数据日期
python -c "
from etl.db import get_db
conn = get_db()
r = conn.execute('SELECT MAX(trade_date) FROM produce_daily_prices').fetchone()
print(f'Latest data: {r[0]}')
"
```
