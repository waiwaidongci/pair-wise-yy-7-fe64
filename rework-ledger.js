// 返修台账：召回记录的登记、流转与落库，规则一律走 recall-policy.js。

import {
  itemKey,
  canOpenRecall,
  canRegisterRecall,
  planRecall,
  canCompleteRework,
  canRelease,
  deliveryBlock,
} from "./recall-policy.js";

export class LedgerError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

function now() { return new Date().toISOString(); }

function findItem(db, key) {
  return db.items.find(x => x.id === key || x.code === key) || null;
}

function findRecall(db, id) {
  return (db.recalls || []).find(r => r.id === id) || null;
}

function findRecallItem(db, recall) {
  return db.items.find(x => itemKey(x) === recall.itemId) || null;
}

function itemLog(item, step, note) {
  item.logs ||= [];
  item.logs.push({ at: now(), step, note });
}

// 登记召回：缺陷索位、原因、接回人；每船仅一条进行中；同索位沿用历史
export function openRecall(db, itemRef, input) {
  const item = findItem(db, itemRef);
  if (!item) throw new LedgerError("模型不存在", 404);
  const key = itemKey(item);
  for (const check of [canRegisterRecall(input), canOpenRecall(db.recalls, key)]) {
    if (!check.ok) throw new LedgerError(check.error);
  }
  const plan = planRecall(db.recalls, key, String(input.position).trim());
  const position = String(input.position).trim();
  const reason = String(input.reason).trim();
  const receiver = String(input.receiver).trim();
  const recall = {
    id: "RC-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    itemId: key,
    code: item.code,
    position,
    reason,
    receiver,
    round: plan.round,
    previousRecallIds: plan.previousRecallIds,
    status: "待返修",
    holdStatus: item.status, // 占着原船台：记下召回前状态，放行时恢复
    createdAt: now(),
    history: [{ at: now(), step: "召回", note: `${plan.repeat ? `沿用 ${plan.previousRecallIds.join("、")} 的历史，第 ${plan.round} 次返修；` : ""}接回人 ${receiver}：${reason}` }],
  };
  db.recalls ||= [];
  db.recalls.unshift(recall);
  item.status = "返修中";
  itemLog(item, "召回", `${recall.position} 第 ${recall.round} 次返修，占原船台，接回人 ${recall.receiver}`);
  return recall;
}

// 返修完成：登记返修人，进入待复验，船台仍占用
export function completeRework(db, recallId, input) {
  const recall = findRecall(db, recallId);
  const check = canCompleteRework(recall, input.reworkBy);
  if (!check.ok) throw new LedgerError(check.error, recall ? 409 : 404);
  recall.reworkBy = String(input.reworkBy).trim();
  recall.status = "待复验";
  recall.completedAt = now();
  recall.history.push({ at: now(), step: "返修", note: `返修人 ${recall.reworkBy}${input.note ? "：" + input.note : ""}` });
  const item = findRecallItem(db, recall);
  if (item) itemLog(item, "返修", `${recall.position} 返修完成，待复验（返修人 ${recall.reworkBy}）`);
  return recall;
}

// 复验放行：复验人≠返修人；放行后交还原船台状态
export function releaseRecall(db, recallId, input) {
  const recall = findRecall(db, recallId);
  const check = canRelease(recall, input.recheckBy);
  if (!check.ok) throw new LedgerError(check.error, recall ? 409 : 404);
  recall.recheckBy = String(input.recheckBy).trim();
  recall.status = "已放行";
  recall.releasedAt = now();
  recall.history.push({ at: now(), step: "复验", note: `复验人 ${recall.recheckBy} 放行${input.note ? "：" + input.note : ""}` });
  const item = findRecallItem(db, recall);
  if (item) {
    item.status = recall.holdStatus || "已交付";
    itemLog(item, "放行", `${recall.position} 复验通过（复验人 ${recall.recheckBy}），船台释放`);
  }
  return recall;
}

// 改单守卫：召回未放行时挡住交付/状态变更
export function assertNotHeld(db, item) {
  const block = deliveryBlock(db.recalls, itemKey(item));
  if (block) throw new LedgerError(block);
}
