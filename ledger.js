// 返修台账：召回记录的登记与状态推进，直接在 item 上落库。
// 所有业务判定都走 recall.js，这里只管数据结构与日志。

import {
  REWORK_STATUS,
  PENDING_REPAIR,
  PENDING_INSPECT,
  RELEASED,
  listRecalls,
  findActiveRecall,
  reworkCount,
  assertCanOpenRecall,
  assertCanRepair,
  assertCanInspect,
  assertCanRelease,
  needsExplicitRelease
} from "./recall.js";

export {
  REWORK_STATUS,
  PENDING_REPAIR,
  PENDING_INSPECT,
  RELEASED,
  findActiveRecall,
  reworkCount
};

let seqSeed = 0;
function recallId() {
  seqSeed += 1;
  return "RC-" + Date.now().toString(36).toUpperCase() + "-" + seqSeed;
}

function appendLog(item, step, note) {
  item.logs ||= [];
  item.logs.push({ at: new Date().toISOString(), step, note });
}

// 登记召回：模型转入返修中、占住原船台（记录召回前状态），同索位沿用历史。
export function openRecall(item, input) {
  const verdict = assertCanOpenRecall(item, input);
  const now = new Date().toISOString();
  const recall = {
    id: recallId(),
    position: verdict.position,
    reason: verdict.reason,
    receiver: verdict.receiver,
    status: PENDING_REPAIR,
    seq: verdict.seq,
    repeat: verdict.repeat,
    history: verdict.history,
    heldStatus: item.status,
    openedAt: now,
    repairer: null,
    repairNote: "",
    repairedAt: null,
    inspector: null,
    inspectNote: "",
    inspectionPassed: false,
    inspectedAt: null,
    releasedBy: null,
    releasedAt: null,
    releaseNote: "",
    events: [{ at: now, action: "登记召回", by: verdict.receiver, note: verdict.reason }]
  };
  item.recalls ||= [];
  item.recalls.push(recall);
  item.status = REWORK_STATUS;
  appendLog(item, "返修召回", `${recall.position} · ${verdict.repeat ? `同索位第 ${recall.seq} 次返修 · ` : ""}${verdict.reason} · 接回人 ${verdict.receiver}`);
  return recall;
}

export function completeRepair(item, recallId, input = {}) {
  const recall = listRecalls(item).find((r) => r.id === recallId);
  if (!recall) return null;
  const verdict = assertCanRepair(recall, input);
  const now = new Date().toISOString();
  recall.repairer = verdict.repairer;
  recall.repairNote = verdict.note;
  recall.repairedAt = now;
  recall.status = PENDING_INSPECT;
  recall.events.push({ at: now, action: "完成返修", by: verdict.repairer, note: verdict.note });
  appendLog(item, "完成返修", `${recall.position} · 返修人 ${verdict.repairer}`);
  return recall;
}

export function passInspection(item, recallId, input = {}) {
  const recall = listRecalls(item).find((r) => r.id === recallId);
  if (!recall) return null;
  const verdict = assertCanInspect(recall, input);
  const now = new Date().toISOString();
  recall.inspector = verdict.inspector;
  recall.inspectNote = verdict.note;
  recall.inspectionPassed = true;
  recall.inspectedAt = now;
  recall.events.push({ at: now, action: "复验通过", by: verdict.inspector, note: verdict.note });
  appendLog(item, "复验", `${recall.position} · 复验人 ${verdict.inspector}（与返修人非同一人）`);

  // 首次返修该索位：复验通过即放行，退出原船台回到召回前状态；
  // 同一索位再次返修：沿用历史且继续挡住交付，等待显式放行。
  if (!needsExplicitRelease(recall)) {
    return releaseRecall(item, recallId, { releasedBy: verdict.inspector, note: "复验通过，自动放行" });
  }
  return recall;
}

export function releaseRecall(item, recallId, input = {}) {
  const recall = listRecalls(item).find((r) => r.id === recallId);
  if (!recall) return null;
  const verdict = assertCanRelease(recall, input);
  const now = new Date().toISOString();
  recall.releasedBy = verdict.releasedBy;
  recall.releasedAt = now;
  recall.releaseNote = verdict.note;
  recall.status = RELEASED;
  recall.events.push({ at: now, action: "放行", by: verdict.releasedBy, note: verdict.note });
  // 离开原船台：恢复召回前状态（历史遗留数据没有 heldStatus 时回到待复核）
  item.status = recall.heldStatus || "待复核";
  appendLog(item, "召回放行", `${recall.position} · 放行人 ${verdict.releasedBy} · 恢复为 ${item.status}`);
  return recall;
}

// 页面可见：待返修、待复验、已放行、累计返修次数。
export function recallBoard(items) {
  const board = {
    [PENDING_REPAIR]: 0,
    [PENDING_INSPECT]: 0,
    [RELEASED]: 0,
    totalReworks: 0
  };
  for (const item of items) {
    for (const recall of listRecalls(item)) {
      if (recall.status === PENDING_REPAIR) board[PENDING_REPAIR] += 1;
      else if (recall.status === PENDING_INSPECT) board[PENDING_INSPECT] += 1;
      else if (recall.status === RELEASED) board[RELEASED] += 1;
    }
    board.totalReworks += reworkCount(item);
  }
  return board;
}
