// 召回判定：返修召回的全部业务规则，纯函数，不读写数据。
// 台账落库见 rework-ledger.js，页面与接口见 server.js。

export const RECALL_STAGES = ["待返修", "待复验", "已放行"];

// 老数据可能只有 code 没有 id，统一取业务键
export function itemKey(item) {
  return item.id || item.code;
}

// 进行中的召回 = 未放行的召回
export function activeRecall(recalls, itemId) {
  return (recalls || []).find(r => r.itemId === itemId && r.status !== "已放行") || null;
}

// 规则一：每艘模型只留一条进行中的召回
export function canOpenRecall(recalls, itemId) {
  const active = activeRecall(recalls, itemId);
  if (active) {
    return { ok: false, error: `该模型已有进行中的召回（${active.id} · ${active.status}），须先复验放行` };
  }
  return { ok: true };
}

// 同一索位的历史召回，按时间升序
export function positionHistory(recalls, itemId, position) {
  return (recalls || [])
    .filter(r => r.itemId === itemId && r.position === position)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

// 规则二：同一索位再次返修要沿用历史 —— 轮次递增并挂接历史召回
export function planRecall(recalls, itemId, position) {
  const history = positionHistory(recalls, itemId, position);
  return {
    round: history.length + 1,
    repeat: history.length > 0,
    previousRecallIds: history.map(r => r.id),
  };
}

// 规则三：登记召回必须填齐缺陷索位、原因、接回人
export function canRegisterRecall(input) {
  if (!input.position || !String(input.position).trim()) return { ok: false, error: "请登记缺陷索位" };
  if (!input.reason || !String(input.reason).trim()) return { ok: false, error: "请登记召回原因" };
  if (!input.receiver || !String(input.receiver).trim()) return { ok: false, error: "请登记接回人" };
  return { ok: true };
}

// 返修完成：仅待返修可提交，且须登记返修人
export function canCompleteRework(recall, reworkBy) {
  if (!recall) return { ok: false, error: "召回不存在" };
  if (recall.status !== "待返修") return { ok: false, error: `召回当前为「${recall.status}」，不能提交返修完成` };
  if (!reworkBy || !String(reworkBy).trim()) return { ok: false, error: "请登记返修人" };
  return { ok: true };
}

// 规则四：复验人不能与返修人相同
export function canRelease(recall, recheckBy) {
  if (!recall) return { ok: false, error: "召回不存在" };
  if (recall.status !== "待复验") return { ok: false, error: `召回当前为「${recall.status}」，不能复验放行` };
  if (!recheckBy || !String(recheckBy).trim()) return { ok: false, error: "请登记复验人" };
  if (String(recheckBy).trim() === String(recall.reworkBy).trim()) {
    return { ok: false, error: `复验人不能与返修人（${recall.reworkBy}）相同` };
  }
  return { ok: true };
}

// 规则五：召回未放行即占着原船台，挡住交付
export function deliveryBlock(recalls, itemId) {
  const active = activeRecall(recalls, itemId);
  if (!active) return null;
  const repeat = active.round > 1 ? `（同一索位第 ${active.round} 次返修）` : "";
  return `召回 ${active.id} ${active.status}中${repeat}，船台被占用，禁止交付`;
}

// 累计返修次数（该模型全部召回条数）
export function reworkCount(recalls, itemId) {
  return (recalls || []).filter(r => r.itemId === itemId).length;
}

// 页面统计：待返修、待复验、已放行、累计返修次数
export function recallStats(recalls) {
  const stats = { "待返修": 0, "待复验": 0, "已放行": 0, "累计返修次数": (recalls || []).length };
  for (const r of recalls || []) {
    if (stats[r.status] !== undefined) stats[r.status] += 1;
  }
  return stats;
}
