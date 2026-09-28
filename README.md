# 古船模型帆索校准

运行：

```bash
npm start
```

访问`http://localhost:3038`。数据保存在`data/model-rigging-calibration.json`。

## 返修召回

代码按职责分三块：

- `recall.js`：召回判定（纯规则）。一船只允许一条进行中的召回；登记缺陷索位、原因、接回人；返修人完成后才能复验，复验人不能与返修人相同；返修未放行前模型占着原船台，禁止改状态/交付。
- `ledger.js`：返修台账（落库与状态推进）。同索位再次返修沿用历史（`repeat`、第几次、历史快照），复验通过后仍挡住交付，必须显式放行。
- `page.js` / `server.js`：页面操作与 HTTP 接口，只做展示和转发，判定以后端为准。

召回流程：登记召回（待返修，占用原船台）→ 完成返修（待复验）→ 复验通过（首次返修自动放行；同索位重复返修需再点放行）→ 恢复召回前状态、可以交付。页面可看「待返修 / 待复验 / 已放行 / 累计返修次数」。

接口：

- `POST /api/items/:id/recalls` `{ position, reason, receiver }`
- `POST /api/items/:id/recalls/:rid/repair` `{ repairer, note? }`
- `POST /api/items/:id/recalls/:rid/inspect` `{ inspector, note? }`
- `POST /api/items/:id/recalls/:rid/release` `{ releasedBy }`
- `GET /api/recalls/board`
