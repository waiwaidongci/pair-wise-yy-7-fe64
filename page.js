// 页面操作：只负责渲染与调用接口，所有判定以后端 recall.js / ledger.js 为准。

const stages = ["待检查", "校准中", "待复核", "已交付"];
const reworkStatus = "返修中";
const allStatuses = [...stages, reworkStatus];

export function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>古船模型帆索校准 · 返修召回</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; --hold:#8a5a16; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; } textarea { min-height:68px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; } button.secondary { background:#69736a; } button.small { padding:6px 10px; font-size:13px; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin-bottom:10px; } .stat strong { display:block; font-size:24px; }
    .recall-stats { border:1px dashed var(--warn); border-radius:8px; padding:10px; margin-bottom:14px; } .recall-stats .stat { background:#fbf6f0; } .recall-stats strong { color:var(--warn); }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:160px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; } .card { display:grid; gap:8px; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.hold { border-color:var(--warn); color:var(--warn); font-weight:700; }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:90px; overflow:auto; } .warn { color:var(--warn); font-weight:700; } .hold-text { color:var(--hold); font-weight:700; }
    .recall-box { border-top:1px solid var(--line); padding-top:8px; display:grid; gap:6px; } .recall-box .btns { display:flex; gap:6px; flex-wrap:wrap; }
    .ledger { font-size:12px; color:var(--muted); max-height:84px; overflow:auto; } .ledger div { border-bottom:1px dotted var(--line); padding:2px 0; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header><div><h1>古船模型帆索校准</h1><div class="meta">模型、帆索任务、校准记录与返修召回串联</div></div><button id="reload">刷新</button></header>
  <main>
    <section>
      <form id="createForm"><h2>新增模型</h2><div id="fields"></div><label>初始状态</label><select name="status">${stages.map(s => '<option>'+s+'</option>').join('')}</select><button>保存模型</button></form>
      <form id="actionForm" style="margin-top:14px"><h2>新增帆索任务</h2><label>选择模型</label><select name="id" id="itemSelect"></select><div id="extraFields"></div><button>提交记录</button></form>
      <form id="recallForm" style="margin-top:14px;border:1px solid var(--warn)"><h2>返修召回登记</h2>
        <label>选择模型</label><select name="id" id="recallItemSelect" required></select>
        <label>缺陷索位</label><input name="position" list="positionList" required placeholder="如：前桅侧支索">
        <datalist id="positionList"></datalist>
        <label>返修原因</label><input name="reason" required placeholder="如：展馆巡检发现索具松动">
        <label>接回人</label><input name="receiver" required placeholder="电话叫回后实际接回人">
        <button type="submit" class="secondary">登记召回（占用原船台）</button>
      </form>
    </section>
    <section>
      <div class="stats" id="stats"></div>
      <div class="recall-stats"><div class="stats" id="recallStats" style="margin-bottom:0"></div></div>
      <div class="toolbar"><select id="statusFilter"><option value="">全部状态</option>${allStatuses.map(s => '<option>'+s+'</option>').join('')}</select><input id="search" placeholder="搜索编号或关键词"></div>
      <div class="panel"><h2>召回进行中时模型占着原船台不能改状态/交付；复验人不能与返修人相同；同一索位再次返修沿用历史，复验后仍需放行。</h2><div class="grid" id="cards"></div></div>
    </section>
  </main>
  <script>
    const fields = [["code","模型编号","text"],["shipType","船型","text"],["scale","比例","text"],["mastCount","桅杆数量","number"],["riggingMaterial","帆索材料","text"],["owner","负责人","text"],["dueDate","交付日期","date"]];
    const stages = ${JSON.stringify(stages)};
    const allStatuses = ${JSON.stringify(allStatuses)};
    const extraFields = [["position","索具位置"],["tension","松紧状态"],["note","调整备注"]];
    const createForm = document.querySelector('#createForm');
    const actionForm = document.querySelector('#actionForm');
    const recallForm = document.querySelector('#recallForm');
    const cards = document.querySelector('#cards');
    const statsEl = document.querySelector('#stats');
    const recallStatsEl = document.querySelector('#recallStats');
    const itemSelect = document.querySelector('#itemSelect');
    const recallItemSelect = document.querySelector('#recallItemSelect');
    let items = [];
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ 'Content-Type':'application/json' } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '请求失败');
      return data;
    }
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const ref = item => item.id || item.code;
    function renderForms() {
      document.querySelector('#fields').innerHTML = fields.map(([key,label,type]) => '<label>'+label+'</label><input name="'+key+'" type="'+type+'" '+(key==='code'?'required':'')+'>').join('');
      document.querySelector('#extraFields').innerHTML = extraFields.map(([key,label]) => '<label>'+label+'</label><input name="'+key+'">').join('');
    }
    function renderSelects() {
      const opts = items.map(item => '<option value="'+esc(ref(item))+'">'+esc(item.code || item.id)+' · '+esc(item.name || item.shipType || item.source || item.plateSize || '')+'</option>').join('');
      itemSelect.innerHTML = opts;
      recallItemSelect.innerHTML = opts;
      const positions = [...new Set(items.flatMap(item => [
        ...(item.tasks || []).map(t => t.position),
        ...(item.recalls || []).map(r => r.position)
      ].filter(Boolean)))];
      document.querySelector('#positionList').innerHTML = positions.map(p => '<option value="'+esc(p)+'">').join('');
    }
    function activeRecall(item) { return (item.recalls || []).find(r => r.status === '待返修' || r.status === '待复验') || null; }
    function render() {
      renderSelects();
      const stats = Object.fromEntries(allStatuses.map(s => [s, items.filter(i => i.status === s).length]));
      statsEl.innerHTML = Object.entries(stats).map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join('');
      const pendingRepair = items.reduce((n,i) => n + (i.recalls || []).filter(r => r.status === '待返修').length, 0);
      const pendingInspect = items.reduce((n,i) => n + (i.recalls || []).filter(r => r.status === '待复验').length, 0);
      const released = items.reduce((n,i) => n + (i.recalls || []).filter(r => r.status === '已放行').length, 0);
      const totalReworks = items.reduce((n,i) => n + (i.recalls || []).length, 0);
      recallStatsEl.innerHTML = [
        ['待返修', pendingRepair], ['待复验', pendingInspect], ['已放行', released], ['累计返修次数', totalReworks]
      ].map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join('');
      const status = document.querySelector('#statusFilter').value;
      const q = document.querySelector('#search').value.trim();
      const visible = items.filter(item => (!status || item.status === status) && (!q || JSON.stringify(item).includes(q)));
      cards.innerHTML = visible.map(item => cardHtml(item)).join('');
      bindCardEvents();
    }
    function recallHtml(item) {
      const recalls = item.recalls || [];
      if (!recalls.length) return '<div class="recall-box meta">暂无返修召回</div>';
      const active = activeRecall(item);
      const parts = ['<div class="recall-box">', '<div class="hold-text">累计返修次数：'+recalls.length+'</div>'];
      if (active) {
        parts.push('<span class="pill hold">召回进行中 · '+esc(active.status)+'</span>');
        parts.push('<div class="meta">缺陷索位：<b>'+esc(active.position)+'</b>'+(active.repeat ? ' <span class="warn">同索位第 '+active.seq+' 次返修（沿用历史）</span>' : '')+'</div>');
        parts.push('<div class="meta">原因：'+esc(active.reason)+'<br>接回人：'+esc(active.receiver)+' · 召回于 '+esc((active.openedAt || '').slice(0,10))+'</div>');
        parts.push('<div class="meta">占着原船台：召回前状态 '+esc(active.heldStatus || '未知')+'，放行前不能改状态/交付</div>');
        if (active.status === '待返修') {
          parts.push('<div class="btns"><button class="small" data-act="repair" data-item="'+esc(ref(item))+'" data-recall="'+esc(active.id)+'">完成返修</button></div>');
        } else {
          parts.push('<div class="meta">返修人：'+esc(active.repairer)+(active.repairNote ? ' · '+esc(active.repairNote) : '')+'</div>');
          parts.push('<div class="btns"><button class="small" data-act="inspect" data-item="'+esc(ref(item))+'" data-recall="'+esc(active.id)+'">复验通过</button>'
            + (active.repeat && active.inspectionPassed ? '<button class="small secondary" data-act="release" data-item="'+esc(ref(item))+'" data-recall="'+esc(active.id)+'">放行交付</button>' : '') + '</div>');
          if (active.inspectionPassed && active.repeat) parts.push('<div class="meta warn">复验已通过，等待放行才能交付</div>');
        }
      }
      const ledger = recalls.slice().reverse().map(r => '<div>['+esc(r.status)+'] '+esc(r.position)+(r.repeat ? '（第'+r.seq+'次）' : '')+' · 返修 '+esc(r.repairer || '—')+' / 复验 '+esc(r.inspector || '—')+' · 放行 '+esc(r.releasedBy || '—')+'</div>').join('');
      parts.push('<div class="ledger"><div class="meta" style="margin-bottom:2px">返修台账：</div>'+ledger+'</div>');
      parts.push('</div>');
      return parts.join('');
    }
    function cardHtml(item) {
      const main = fields.slice(0,4).map(([key,label]) => '<div><b>'+label+'</b> '+(item[key] ?? '')+'</div>').join('');
      const tasks = (item.tasks || []).map(t => '<div class="meta">任务 '+esc(t.position)+' · '+esc(t.status)+' · '+esc(t.tension)+'</div>').join('');
      const logs = (item.logs || []).slice(-4).map(l => '<div>'+esc(l.step)+'：'+esc(l.note)+'</div>').join('');
      const active = activeRecall(item);
      const statusSelect = '<label>状态</label><select data-status="'+esc(ref(item))+'"'+(active ? ' disabled title="返修召回未放行，占着原船台"':'')+'>'+allStatuses.map(s => '<option '+(s===item.status?'selected':'')+'>'+s+'</option>').join('')+'</select>';
      return '<article class="card"><h3>'+esc(item.code || item.id)+'</h3><span class="pill'+(active?' hold':'')+'">'+esc(item.status)+'</span>'+main+tasks+statusSelect+'<button class="secondary" data-note="'+esc(ref(item))+'">追加备注</button>'+recallHtml(item)+'<div class="logs meta">'+(logs || '暂无记录')+'</div></article>';
    }
    function bindCardEvents() {
      document.querySelectorAll('[data-status]').forEach(sel => sel.onchange = async () => {
        try { await api('/api/items/'+sel.dataset.status, { method:'PATCH', body: JSON.stringify({ status: sel.value }) }); await load(); }
        catch (e) { alert(e.message); await load(); }
      });
      document.querySelectorAll('[data-note]').forEach(btn => btn.onclick = async () => { const id = btn.dataset.note; const note = prompt('记录备注'); if (note) { await api('/api/items/'+id+'/logs', { method:'POST', body: JSON.stringify({ step:'备注', note }) }); await load(); } });
      document.querySelectorAll('[data-act]').forEach(btn => btn.onclick = async () => {
        const { act, item, recall } = btn.dataset;
        try {
          if (act === 'repair') {
            const repairer = prompt('返修人（复验人不能与其相同）'); if (repairer === null) return;
            const note = prompt('返修备注（可留空）') || '';
            await api('/api/items/'+item+'/recalls/'+recall+'/repair', { method:'POST', body: JSON.stringify({ repairer, note }) });
          } else if (act === 'inspect') {
            const inspector = prompt('复验人（不能与返修人相同）'); if (inspector === null) return;
            const note = prompt('复验备注（可留空）') || '';
            await api('/api/items/'+item+'/recalls/'+recall+'/inspect', { method:'POST', body: JSON.stringify({ inspector, note }) });
          } else if (act === 'release') {
            const releasedBy = prompt('放行人'); if (releasedBy === null) return;
            await api('/api/items/'+item+'/recalls/'+recall+'/release', { method:'POST', body: JSON.stringify({ releasedBy }) });
          }
          await load();
        } catch (e) { alert(e.message); await load(); }
      });
    }
    async function load() { items = await api('/api/items'); render(); }
    createForm.onsubmit = async event => { event.preventDefault(); await api('/api/items', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(createForm).entries())) }); createForm.reset(); await load(); };
    actionForm.onsubmit = async event => { event.preventDefault(); await api('/api/items/'+itemSelect.value+'/action', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(actionForm).entries())) }); actionForm.reset(); await load(); };
    recallForm.onsubmit = async event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(recallForm).entries());
      try { await api('/api/items/'+data.id+'/recalls', { method:'POST', body: JSON.stringify({ position:data.position, reason:data.reason, receiver:data.receiver }) }); recallForm.reset(); await load(); }
      catch (e) { alert(e.message); }
    };
    document.querySelector('#statusFilter').onchange = render; document.querySelector('#search').oninput = render; document.querySelector('#reload').onclick = load;
    renderForms(); load();
  </script>
</body>
</html>`;
}
