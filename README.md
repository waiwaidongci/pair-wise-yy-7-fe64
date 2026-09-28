# 古船模型帆索校准

运行：

```bash
npm start
```

访问`http://localhost:3038`。数据保存在`data/model-rigging-calibration.json`。

## 返修召回

- `recall-policy.js`：召回判定（每船一条进行中召回、复验人≠返修人、同索位沿用历史、未放行挡交付）。
- `rework-ledger.js`：返修台账（登记召回、返修完成、复验放行的落库与流转）。
- `server.js`：页面操作与接口。

接口：`POST /api/items/:id/recalls` 登记召回（缺陷索位、原因、接回人），`POST /api/recalls/:id/complete` 返修完成（返修人），`POST /api/recalls/:id/release` 复验放行（复验人），`GET /api/recalls`、`GET /api/recall-stats` 查看台账与统计。
