import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { recallStats, activeRecall, reworkCount, itemKey } from "./recall-policy.js";
import { LedgerError, openRecall, completeRework, releaseRecall, assertNotHeld } from "./rework-ledger.js";

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
  ],
  "recalls": []
};
const fields = [["code","模型编号","text"],["shipType","船型","text"],["scale","比例","text"],["mastCount","桅杆数量","number"],["riggingMaterial","帆索材料","text"],["owner","负责人","text"],["dueDate","交付日期","date"]];
const stages = ["待检查","校准中","待复核","已交付","返修中"];
const statLabels = ["待检查","校准中","待复核","已交付","返修中"];
const extraFields = [["position","索具位置"],["tension","松紧状态"],["note","调整备注"]];

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  db.recalls ||= [];
  return db;
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
function summarize(item, recalls) {
  const logCount = (item.logs || []).length + (item.tasks || []).reduce((n, t) => n + (t.logs || []).length, 0);
  const key = itemKey(item);
  const active = activeRecall(recalls, key);
  return {
    ...item,
    logCount,
    recallCount: reworkCount(recalls, key),
    activeRecall: active ? { id: active.id, status: active.status, position: active.position, round: active.round } : null,
  };
}
function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>古船模型帆索校准</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; } textarea { min-height:68px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; } button.secondary { background:#69736a; } button.warn { background:var(--warn); }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; }
    .stat.recall { border-color:#e3c9c0; } .stat.recall strong { color:var(--warn); }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:160px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; } .card { display:grid; gap:8px; align-content:start; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.warn { border-color:var(--warn); color:var(--warn); font-weight:700; }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:110px; overflow:auto; } .warn { color:var(--warn); font-weight:700; }
    .row { display:flex; gap:8px; flex-wrap:wrap; } .row button { flex:1; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header><div><h1>古船模型帆索校准</h1><div class="meta">模型、帆索任务、校准记录与返修召回串联</div></div><button id="reload">刷新</button></header>
  <main>
    <section>
      <form id="createForm"><h2>新增模型</h2><div id="fields"></div><label>初始状态</label><select name="status">${stages.map(s => '<option>'+s+'</option>').join('')}</select><button>保存模型</button></form>
      <form id="actionForm" style="margin-top:14px"><h2>新增帆索任务</h2><label>选择模型</label><select name="id" id="itemSelect"></select><div id="extraFields"></div><button>提交记录</button></form>
      <form id="recallForm" style="margin-top:14px"><h2>登记返修召回</h2><label>选择模型</label><select name="id" id="recallItemSelect"></select><label>缺陷索位</label><input name="position" required><label>召回原因</label><textarea name="reason" required></textarea><label>接回人</label><input name="receiver" required><button class="warn">登记召回</button><div class="meta" style="margin-top:8px">每艘模型仅一条进行中的召回；返修完成前占原船台、禁止交付。</div></form>
    </section>
    <section>
      <div class="stats" id="stats"></div>
      <div class="stats" id="recallStats"></div>
      <div class="toolbar"><select id="statusFilter"><option value="">全部状态</option>${stages.map(s => '<option>'+s+'</option>').join('')}</select><input id="search" placeholder="搜索编号或关键词"></div>
      <div class="panel" style="margin-bottom:14px"><h2>返修台账</h2><div class="grid" id="recalls"></div></div>
      <div class="panel"><h2>创建模型后可拆分帆索任务，逐条记录松紧状态、调整备注和完成时间。</h2><div class="grid" id="cards"></div></div>
    </section>
  </main>
  <script>
    const fields = [["code","模型编号","text"],["shipType","船型","text"],["scale","比例","text"],["mastCount","桅杆数量","number"],["riggingMaterial","帆索材料","text"],["owner","负责人","text"],["dueDate","交付日期","date"]];
    const stages = ["待检查","校准中","待复核","已交付","返修中"];
    const recallStages = ["待返修","待复验","已放行"];
    const extraFields = [["position","索具位置"],["tension","松紧状态"],["note","调整备注"]];
    const createForm = document.querySelector('#createForm');
    const actionForm = document.querySelector('#actionForm');
    const recallForm = document.querySelector('#recallForm');
    const cards = document.querySelector('#cards');
    const recallCards = document.querySelector('#recalls');
    const statsEl = document.querySelector('#stats');
    const recallStatsEl = document.querySelector('#recallStats');
    const itemSelect = document.querySelector('#itemSelect');
    const recallItemSelect = document.querySelector('#recallItemSelect');
    let items = [];
    let recalls = [];
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ 'Content-Type':'application/json' } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '请求失败');
      return data;
    }
    async function run(fn) { try { await fn(); await load(); } catch (e) { alert(e.message); } }
    function renderForms() {
      document.querySelector('#fields').innerHTML = fields.map(([key,label,type]) => '<label>'+label+'</label><input name="'+key+'" type="'+type+'" '+(key==='code'?'required':'')+'>').join('');
      document.querySelector('#extraFields').innerHTML = extraFields.map(([key,label]) => '<label>'+label+'</label><input name="'+key+'">').join('');
    }
    function render() {
      const options = items.map(item => '<option value="'+(item.id || item.code)+'">'+(item.code || item.id)+' · '+(item.name || item.shipType || item.source || item.plateSize || '')+'</option>').join('');
      itemSelect.innerHTML = options;
      recallItemSelect.innerHTML = options;
      const stats = Object.fromEntries(stages.map(s => [s, items.filter(i => i.status === s).length]));
      statsEl.innerHTML = Object.entries(stats).map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join('');
      const rstats = { '待返修': 0, '待复验': 0, '已放行': 0, '累计返修次数': recalls.length };
      recalls.forEach(r => { if (rstats[r.status] !== undefined) rstats[r.status] += 1; });
      recallStatsEl.innerHTML = Object.entries(rstats).map(([k,v]) => '<div class="stat recall"><span>'+k+'</span><strong>'+v+'</strong></div>').join('');
      const status = document.querySelector('#statusFilter').value;
      const q = document.querySelector('#search').value.trim();
      const visible = items.filter(item => (!status || item.status === status) && (!q || JSON.stringify(item).includes(q)));
      cards.innerHTML = visible.map(item => cardHtml(item)).join('');
      const sorted = recalls.slice().sort((a, b) => (a.status === '已放行') - (b.status === '已放行') || String(b.createdAt).localeCompare(String(a.createdAt)));
      recallCards.innerHTML = sorted.map(recallHtml).join('') || '<div class="meta">暂无召回记录</div>';
      document.querySelectorAll('[data-status]').forEach(sel => sel.onchange = () => run(async () => { await api('/api/items/'+sel.dataset.status, { method:'PATCH', body: JSON.stringify({ status: sel.value }) }); }));
      document.querySelectorAll('[data-note]').forEach(btn => btn.onclick = () => run(async () => { const note = prompt('记录备注'); if (note) await api('/api/items/'+btn.dataset.note+'/logs', { method:'POST', body: JSON.stringify({ step:'备注', note }) }); }));
      document.querySelectorAll('[data-complete]').forEach(btn => btn.onclick = () => run(async () => { const reworkBy = prompt('返修人'); if (reworkBy) { const note = prompt('返修说明（可空）') || ''; await api('/api/recalls/'+btn.dataset.complete+'/complete', { method:'POST', body: JSON.stringify({ reworkBy, note }) }); } }));
      document.querySelectorAll('[data-release]').forEach(btn => btn.onclick = () => run(async () => { const recheckBy = prompt('复验人（须与返修人不同）'); if (recheckBy) { const note = prompt('复验结论（可空）') || ''; await api('/api/recalls/'+btn.dataset.release+'/release', { method:'POST', body: JSON.stringify({ recheckBy, note }) }); } }));
    }
    function cardHtml(item) {
      const main = fields.slice(0,4).map(([key,label]) => '<div><b>'+label+'</b> '+(item[key] ?? '')+'</div>').join('');
      const tasks = (item.tasks || []).map(t => '<div class="meta">任务 '+t.position+' · '+t.status+' · '+t.tension+'</div>').join('');
      const logs = (item.logs || []).slice(-4).map(l => '<div>'+(l.step || '')+'：'+l.note+'</div>').join('');
      const held = item.activeRecall;
      const recallInfo = '<div class="meta">累计返修 '+(item.recallCount || 0)+' 次'+(held ? ' · <span class="warn">召回 '+held.id+' '+held.status+'（'+held.position+' 第'+held.round+'次），船台占用中，禁止交付</span>' : '')+'</div>';
      const pill = held ? '<span class="pill warn">'+item.status+' · 召回中</span>' : '<span class="pill">'+item.status+'</span>';
      const statusSelect = held
        ? '<div class="meta">召回未放行，状态已锁定</div>'
        : '<label>状态</label><select data-status="'+(item.id || item.code)+'">'+stages.map(s => '<option '+(s===item.status?'selected':'')+'>'+s+'</option>').join('')+'</select>';
      return '<article class="card"><h3>'+(item.code || item.id)+'</h3>'+pill+main+recallInfo+tasks+statusSelect+'<button class="secondary" data-note="'+(item.id || item.code)+'">追加备注</button><div class="logs meta">'+(logs || '暂无记录')+'</div></article>';
    }
    function recallHtml(r) {
      const rows = [
        ['缺陷索位', r.position + '（第 ' + r.round + ' 次返修）'],
        ['原因', r.reason],
        ['接回人', r.receiver],
        ['返修人', r.reworkBy || '—'],
        ['复验人', r.recheckBy || '—'],
      ].map(([k,v]) => '<div><b>'+k+'</b> '+v+'</div>').join('');
      const chain = (r.previousRecallIds && r.previousRecallIds.length) ? '<div class="meta">沿用历史：'+r.previousRecallIds.join('、')+'</div>' : '';
      const history = (r.history || []).map(h => '<div>'+h.step+'：'+h.note+'</div>').join('');
      const actions = r.status === '待返修'
        ? '<div class="row"><button class="warn" data-complete="'+r.id+'">完成返修</button></div>'
        : r.status === '待复验'
          ? '<div class="row"><button data-release="'+r.id+'">复验放行</button></div>'
          : '';
      return '<article class="card"><h3>'+r.id+' · '+(r.code || '')+'</h3><span class="pill'+(r.status==='已放行'?'':' warn')+'">'+r.status+'</span>'+rows+chain+actions+'<div class="logs meta">'+(history || '')+'</div></article>';
    }
    async function load() { [items, recalls] = await Promise.all([api('/api/items'), api('/api/recalls')]); render(); }
    createForm.onsubmit = async event => { event.preventDefault(); await run(async () => { await api('/api/items', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(createForm).entries())) }); createForm.reset(); }); };
    actionForm.onsubmit = async event => { event.preventDefault(); await run(async () => { await api('/api/items/'+itemSelect.value+'/action', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(actionForm).entries())) }); actionForm.reset(); }); };
    recallForm.onsubmit = async event => { event.preventDefault(); await run(async () => { const data = Object.fromEntries(new FormData(recallForm).entries()); await api('/api/items/'+recallItemSelect.value+'/recalls', { method:'POST', body: JSON.stringify(data) }); recallForm.reset(); }); };
    document.querySelector('#statusFilter').onchange = render; document.querySelector('#search').oninput = render; document.querySelector('#reload').onclick = load;
    renderForms(); load();
  </script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();
    if (req.method === "GET" && url.pathname === "/") return html(res, page());
    if (req.method === "GET" && url.pathname === "/api/items") return send(res, 200, db.items.map(item => summarize(item, db.recalls)));
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
      if (input.status && input.status !== item.status) assertNotHeld(db, item);
      Object.assign(item, input);
      item.logs ||= [];
      item.logs.push({ at: new Date().toISOString(), step: "状态", note: "更新为" + item.status });
      await saveDb(db);
      return send(res, 200, item);
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
      item.status = "校准中";
      item.logs.push({ at: new Date().toISOString(), step: "帆索", note: input.position + " · " + input.tension });
      await saveDb(db);
      return send(res, 201, item);
    }
    // 返修召回：登记（每船一条进行中，登记缺陷索位/原因/接回人）
    const recallOpen = url.pathname.match(/^\/api\/items\/([^/]+)\/recalls$/);
    if (recallOpen && req.method === "POST") {
      const recall = openRecall(db, recallOpen[1], await body(req));
      await saveDb(db);
      return send(res, 201, recall);
    }
    // 返修完成：登记返修人，转入待复验
    const recallDone = url.pathname.match(/^\/api\/recalls\/([^/]+)\/complete$/);
    if (recallDone && req.method === "POST") {
      const recall = completeRework(db, recallDone[1], await body(req));
      await saveDb(db);
      return send(res, 200, recall);
    }
    // 复验放行：复验人≠返修人，放行后释放船台
    const recallRelease = url.pathname.match(/^\/api\/recalls\/([^/]+)\/release$/);
    if (recallRelease && req.method === "POST") {
      const recall = releaseRecall(db, recallRelease[1], await body(req));
      await saveDb(db);
      return send(res, 200, recall);
    }
    if (req.method === "GET" && url.pathname === "/api/recalls") return send(res, 200, db.recalls);
    if (req.method === "GET" && url.pathname === "/api/stats") return send(res, 200, computeStats(db.items));
    if (req.method === "GET" && url.pathname === "/api/recall-stats") return send(res, 200, recallStats(db.recalls));
    send(res, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof LedgerError) return send(res, error.status, { error: error.message });
    send(res, 500, { error: error.message });
  }
});
server.listen(port, () => console.log("古船模型帆索校准 listening on http://localhost:" + port));
