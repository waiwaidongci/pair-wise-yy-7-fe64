import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RecallError, assertCanChangeStatus } from "./recall.js";
import {
  REWORK_STATUS,
  openRecall,
  completeRepair,
  passInspection,
  releaseRecall,
  findActiveRecall,
  reworkCount,
  recallBoard
} from "./ledger.js";
import { page } from "./page.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "model-rigging-calibration.json");
const port = Number(process.env.PORT || 3038);
const seed = {
  "items": [
    {
      "code": "MR-001",
      "shipType": "福船",
      "scale": "1:48",
      "mastCount": 3,
      "riggingMaterial": "蜡线",
      "owner": "周宁",
      "dueDate": "2026-06-28",
      "status": "校准中",
      "tasks": [
        {
          "id": "T-1",
          "position": "前桅侧支索",
          "tension": "偏松",
          "status": "调整中",
          "logs": [
            {
              "at": "2026-06-12",
              "note": "已缩短2mm"
            }
          ]
        }
      ],
      "logs": []
    }
  ]
};
const fields = [["code","模型编号","text"],["shipType","船型","text"],["scale","比例","text"],["mastCount","桅杆数量","number"],["riggingMaterial","帆索材料","text"],["owner","负责人","text"],["dueDate","交付日期","date"]];
const stages = ["待检查","校准中","待复核","已交付"];
const statLabels = ["待检查","校准中","待复核","已交付", REWORK_STATUS];
const extraFields = [["position","索具位置"],["tension","松紧状态"],["note","调整备注"]];

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  return JSON.parse(await readFile(dbPath, "utf8"));
}
async function saveDb(db) { await writeFile(dbPath, JSON.stringify(db, null, 2)); }
async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function html(res, text) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(text);
}
function newId() { return "MR-" + Date.now(); }
function computeStats(items) {
  const stats = Object.fromEntries(statLabels.map(label => [label, 0]));
  for (const item of items) {
    if (stats[item.status] !== undefined) stats[item.status] += 1;
  }
  return stats;
}
function summarize(item) {
  const logCount = (item.logs || []).length + (item.tasks || []).reduce((n, t) => n + (t.logs || []).length, 0);
  return { ...item, logCount, activeRecall: findActiveRecall(item), reworkCount: reworkCount(item) };
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();
    if (req.method === "GET" && url.pathname === "/") return html(res, page());
    if (req.method === "GET" && url.pathname === "/api/items") return send(res, 200, db.items.map(summarize));
    if (req.method === "POST" && url.pathname === "/api/items") {
      const input = await body(req);
      const item = { id: newId(), ...input, logs: [{ at: new Date().toISOString(), step: "建档", note: "创建模型" }] };
      item.tasks = [];
      db.items.unshift(item);
      await saveDb(db);
      return send(res, 201, item);
    }
    const patch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
    if (patch && req.method === "PATCH") {
      const item = db.items.find(x => x.id === patch[1] || x.code === patch[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      const input = await body(req);
      if (input.status !== undefined) assertCanChangeStatus(item, input.status);
      Object.assign(item, input);
      item.logs ||= [];
      item.logs.push({ at: new Date().toISOString(), step: "状态", note: "更新为" + item.status });
      await saveDb(db);
      return send(res, 200, summarize(item));
    }
    const log = url.pathname.match(/^\/api\/items\/([^/]+)\/logs$/);
    if (log && req.method === "POST") {
      const item = db.items.find(x => x.id === log[1] || x.code === log[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      const input = await body(req);
      item.logs ||= [];
      item.logs.push({ at: new Date().toISOString(), step: input.step || "记录", note: input.note || "" });
      await saveDb(db);
      return send(res, 201, item);
    }
    const action = url.pathname.match(/^\/api\/items\/([^/]+)\/action$/);
    if (action && req.method === "POST") {
      const item = db.items.find(x => x.id === action[1] || x.code === action[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      const input = await body(req);
      item.logs ||= [];
      item.tasks ||= [];
      item.tasks.push({ id: "T-" + Date.now(), position: input.position, tension: input.tension, status: "待检查", logs: [{ at: new Date().toISOString(), note: input.note || "新增帆索任务" }] });
      // 召回进行中时模型占着原船台，新增任务不改变其返修状态
      if (!findActiveRecall(item)) item.status = "校准中";
      item.logs.push({ at: new Date().toISOString(), step: "帆索", note: input.position + " · " + input.tension });
      await saveDb(db);
      return send(res, 201, summarize(item));
    }

    // ---------- 返修召回（判定在 recall.js，台账在 ledger.js） ----------
    const openRecallRoute = url.pathname.match(/^\/api\/items\/([^/]+)\/recalls$/);
    if (openRecallRoute && req.method === "POST") {
      const item = db.items.find(x => x.id === openRecallRoute[1] || x.code === openRecallRoute[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      const recall = openRecall(item, await body(req));
      await saveDb(db);
      return send(res, 201, { item: summarize(item), recall });
    }
    const recallStep = url.pathname.match(/^\/api\/items\/([^/]+)\/recalls\/([^/]+)\/(repair|inspect|release)$/);
    if (recallStep && req.method === "POST") {
      const item = db.items.find(x => x.id === recallStep[1] || x.code === recallStep[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      const input = await body(req);
      let recall;
      if (recallStep[3] === "repair") recall = completeRepair(item, recallStep[2], input);
      else if (recallStep[3] === "inspect") recall = passInspection(item, recallStep[2], input);
      else recall = releaseRecall(item, recallStep[2], input);
      if (!recall) return send(res, 404, { error: "recall_not_found" });
      await saveDb(db);
      return send(res, 200, { item: summarize(item), recall });
    }
    if (req.method === "GET" && url.pathname === "/api/recalls/board") {
      return send(res, 200, recallBoard(db.items));
    }
    if (req.method === "GET" && url.pathname === "/api/stats") return send(res, 200, { ...computeStats(db.items), ...recallBoard(db.items) });
    send(res, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof RecallError) return send(res, 409, { error: error.code, message: error.message });
    send(res, 500, { error: error.message });
  }
});
server.listen(port, () => console.log("古船模型帆索校准 listening on http://localhost:" + port));
