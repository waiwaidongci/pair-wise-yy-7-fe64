// 返修召回判定：纯领域规则，不碰存储、不碰 HTTP。
// 台账（ledger.js）落库前调用这里的断言，页面/接口不得绕过这些规则。

export const REWORK_STATUS = "返修中";
export const PENDING_REPAIR = "待返修";
export const PENDING_INSPECT = "待复验";
export const RELEASED = "已放行";
export const ACTIVE_STATUSES = [PENDING_REPAIR, PENDING_INSPECT];

export class RecallError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RecallError";
    this.code = code;
  }
}

const clean = (value) => String(value ?? "").trim();

export function listRecalls(item) {
  return Array.isArray(item.recalls) ? item.recalls : [];
}

export function findActiveRecall(item) {
  return listRecalls(item).find((r) => ACTIVE_STATUSES.includes(r.status)) || null;
}

export function reworkCount(item) {
  return listRecalls(item).length;
}

// 召回登记判定：每艘模型只留一条进行中的召回；缺陷索位、原因、接回人必填；
// 同一索位再次返修时沿用历史台账。
export function assertCanOpenRecall(item, input = {}) {
  const position = clean(input.position);
  const reason = clean(input.reason);
  const receiver = clean(input.receiver);
  if (!position) throw new RecallError("position_required", "请登记缺陷索位");
  if (!reason) throw new RecallError("reason_required", "请登记返修原因");
  if (!receiver) throw new RecallError("receiver_required", "请登记接回人");

  const active = findActiveRecall(item);
  if (active) {
    throw new RecallError(
      "active_recall_exists",
      `该模型已有进行中的召回（${active.position}·${active.status}），放行前不能再登记`
    );
  }

  const prior = listRecalls(item).filter(
    (r) => r.position === position && r.status === RELEASED
  );
  // 沿用历史：把该索位历次返修快照带进新召回
  const history = prior.map((r) => ({
    id: r.id,
    seq: r.seq,
    reason: r.reason,
    repairer: r.repairer,
    inspector: r.inspector,
    openedAt: r.openedAt,
    releasedAt: r.releasedAt
  }));

  return {
    position,
    reason,
    receiver,
    repeat: prior.length > 0,
    seq: prior.length + 1,
    history
  };
}

export function assertCanRepair(recall, input = {}) {
  if (!recall || recall.status !== PENDING_REPAIR) {
    throw new RecallError("status_not_pending_repair", "该召回不在待返修状态");
  }
  const repairer = clean(input.repairer);
  if (!repairer) throw new RecallError("repairer_required", "请登记返修人");
  return { repairer, note: clean(input.note) };
}

// 复验判定：必须先完成返修；复验人不能与返修人相同。
export function assertCanInspect(recall, input = {}) {
  if (!recall || recall.status !== PENDING_INSPECT) {
    throw new RecallError("status_not_pending_inspect", "该召回不在待复验状态");
  }
  const inspector = clean(input.inspector);
  if (!inspector) throw new RecallError("inspector_required", "请登记复验人");
  if (recall.repairer && inspector === recall.repairer) {
    throw new RecallError("inspector_same_as_repairer", "复验人不能与返修人相同");
  }
  return { inspector, note: clean(input.note) };
}

// 同一索位再次返修：复验通过后仍挡住交付，必须另行放行。
export function needsExplicitRelease(recall) {
  return recall.repeat === true;
}

export function assertCanRelease(recall, input = {}) {
  if (!recall || recall.status !== PENDING_INSPECT || !recall.inspectionPassed) {
    throw new RecallError("inspection_not_passed", "复验通过后才能放行");
  }
  const releasedBy = clean(input.releasedBy);
  if (!releasedBy) throw new RecallError("released_by_required", "请登记放行人");
  return { releasedBy, note: clean(input.note) };
}

// 占着原船台：返修召回未放行前，模型状态不能变更，更不能交付。
export function assertCanChangeStatus(item, nextStatus) {
  const active = findActiveRecall(item);
  if (active && clean(nextStatus) !== REWORK_STATUS) {
    throw new RecallError(
      "recall_blocks_status",
      `返修召回未放行（${active.position}·${active.status}），模型仍占着原船台，不能变更状态或交付`
    );
  }
}
