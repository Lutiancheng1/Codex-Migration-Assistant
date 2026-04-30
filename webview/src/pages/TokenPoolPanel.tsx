import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProfileSummary, TokenPoolEntry, TokenPoolRefreshCategory, TokenPoolSnapshot } from "../api/types";
import { summarizeUsageErrors } from "./usageErrorSummary";

type TokenPoolPlanFilter = TokenPoolRefreshCategory;
type TokenPoolSortMode = "manual" | "plan" | "available" | "remaining" | "refreshed";

type Props = {
  codexHome: string;
  tokenPool: TokenPoolSnapshot;
  activeProfileId?: string;
  activeProfileName?: string;
  poolRunnerProfile?: ProfileSummary;
  onImportSingle(): void;
  onImportMultiple(): void;
  onImportDirectory(): void;
  onSyncCurrentToPoolRunner(): void;
  onSwitchToPoolRunner(): void;
  onRefreshEntry(entryId: string): void;
  onRefreshGroup(category: TokenPoolRefreshCategory): void;
  onActivateEntry(entryId: string): void;
  onDeleteEntry(entryId: string): void;
  onMoveEntry(entryId: string, direction: "up" | "down"): void;
  onReorderEntries(entryIds: string[]): void;
  onUpdateSettings(next: { autoSwitchEnabled?: boolean; pollIntervalMs?: number; autoRelaunchAfterSwitch?: boolean }): void;
};

function formatTime(value?: string): string {
  if (!value) {
    return "-";
  }
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? value : new Date(ts).toLocaleString();
}

function formatPercent(value?: number): string {
  if (typeof value !== "number") {
    return "-";
  }
  return `${Math.max(0, Math.min(100, value)).toFixed(0)}%`;
}

function buildUsageTooltip(entry: TokenPoolEntry): string {
  if (!entry.usage) {
    return "最近刷新：-\n5h 重置时间：-\n7d 重置时间：-";
  }
  return [
    `最近刷新：${formatTime(entry.usage.fetchedAt)}`,
    `5h 重置时间：${formatTime(entry.usage.fiveHour?.resetAt)}`,
    `7d 重置时间：${formatTime(entry.usage.oneWeek?.resetAt)}`
  ].join("\n");
}

function getPlanBadge(plan?: string): { label: string; tone: "neutral" | "good" | "caution" } | undefined {
  const normalized = plan?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized.includes("team")) {
    return { label: "TEAM", tone: "good" };
  }
  if (normalized.includes("free")) {
    return { label: "FREE", tone: "neutral" };
  }
  return { label: plan!.trim().toUpperCase(), tone: "caution" };
}

function getPlanCategory(entry: TokenPoolEntry): Exclude<TokenPoolRefreshCategory, "all"> | undefined {
  const normalized = (entry.usage?.planType || entry.planTypeHint || "").trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized.includes("team")) {
    return "team";
  }
  if (normalized.includes("plus")) {
    return "plus";
  }
  if (normalized.includes("pro")) {
    return "pro";
  }
  if (normalized.includes("free")) {
    return "free";
  }
  return undefined;
}

function getPlanSortRank(entry: TokenPoolEntry): number {
  const category = getPlanCategory(entry);
  switch (category) {
    case "pro":
      return 0;
    case "team":
      return 1;
    case "plus":
      return 2;
    case "free":
      return 3;
    default:
      return 4;
  }
}

function getRemainingScore(entry: TokenPoolEntry): number {
  const fiveHour = entry.usage?.fiveHour?.remainingPercent;
  const oneWeek = entry.usage?.oneWeek?.remainingPercent;
  const values = [fiveHour, oneWeek].filter((value): value is number => typeof value === "number");
  if (values.length === 0) {
    return -1;
  }
  return Math.min(...values);
}

function getFetchedAtMs(entry: TokenPoolEntry): number {
  const value = entry.usage?.fetchedAt;
  if (!value) {
    return -1;
  }
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? -1 : ts;
}

function statusLabel(entry: TokenPoolEntry): string {
  switch (entry.status) {
    case "available":
      return "可用";
    case "exhausted":
      return "已用尽";
    case "authInvalid":
      return "鉴权失效";
    case "incomplete":
      return "状态不完整";
    default:
      return "未刷新";
  }
}

function isManualSwitchBlocked(entry: TokenPoolEntry): boolean {
  return entry.status === "exhausted" || entry.status === "authInvalid" || entry.status === "incomplete" || entry.status === "neverChecked";
}

export function TokenPoolPanel(props: Props): JSX.Element {
  const [openActionEntryId, setOpenActionEntryId] = useState<string>();
  const [actionAnchorRect, setActionAnchorRect] = useState<DOMRect | undefined>();
  const [pendingDeleteEntryId, setPendingDeleteEntryId] = useState<string>();
  const [draggingEntryId, setDraggingEntryId] = useState<string>();
  const [dragOverEntryId, setDragOverEntryId] = useState<string>();
  const [bulkRefreshCategory, setBulkRefreshCategory] = useState<TokenPoolRefreshCategory>("all");
  const [bulkRefreshMenuOpen, setBulkRefreshMenuOpen] = useState(false);
  const [planFilter, setPlanFilter] = useState<TokenPoolPlanFilter>("all");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [sortMode, setSortMode] = useState<TokenPoolSortMode>("manual");
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const currentRowRef = useRef<HTMLTableRowElement | null>(null);
  const entries = props.tokenPool.entries;
  const indexedEntries = useMemo(() => entries.map((entry, index) => ({ entry, index })), [entries]);
  const isPoolRunnerActive = props.activeProfileId === props.poolRunnerProfile?.id;
  const canSyncCurrentToPoolRunner = !isPoolRunnerActive && !!props.activeProfileId;
  const canReorderCurrentView = !availableOnly && planFilter === "all" && sortMode === "manual";
  const visibleEntries = useMemo(() => {
    const filtered = indexedEntries.filter(({ entry }) => {
      if (availableOnly && entry.status !== "available") {
        return false;
      }
      if (planFilter !== "all" && getPlanCategory(entry) !== planFilter) {
        return false;
      }
      return true;
    });
    const sorted = [...filtered];
    sorted.sort((left, right) => {
      if (sortMode === "plan") {
        const rankDelta = getPlanSortRank(left.entry) - getPlanSortRank(right.entry);
        return rankDelta || left.index - right.index;
      }
      if (sortMode === "available") {
        const statusDelta = Number(right.entry.status === "available") - Number(left.entry.status === "available");
        return statusDelta || left.index - right.index;
      }
      if (sortMode === "remaining") {
        const remainingDelta = getRemainingScore(right.entry) - getRemainingScore(left.entry);
        return remainingDelta || left.index - right.index;
      }
      if (sortMode === "refreshed") {
        const refreshDelta = getFetchedAtMs(right.entry) - getFetchedAtMs(left.entry);
        return refreshDelta || left.index - right.index;
      }
      return left.index - right.index;
    });
    return sorted.map(({ entry }) => entry);
  }, [availableOnly, indexedEntries, planFilter, sortMode]);
  const usageErrorSummary = useMemo(
    () =>
      summarizeUsageErrors(
        visibleEntries.map((entry) => ({
          name: entry.email || entry.accountId,
          usageError: entry.usageError
        }))
      ),
    [visibleEntries]
  );
  const refreshCategoryCounts = useMemo(() => {
    const counts: Record<TokenPoolRefreshCategory, number> = {
      all: entries.length,
      free: 0,
      plus: 0,
      team: 0,
      pro: 0
    };
    for (const entry of entries) {
      const category = getPlanCategory(entry);
      if (category) {
        counts[category] += 1;
      }
    }
    return counts;
  }, [entries]);
  const refreshCategoryOptions: Array<{ value: TokenPoolRefreshCategory; label: string; count: number }> = [
    { value: "all", label: "全部账号", count: refreshCategoryCounts.all },
    { value: "free", label: "Free", count: refreshCategoryCounts.free },
    { value: "plus", label: "Plus", count: refreshCategoryCounts.plus },
    { value: "team", label: "Team", count: refreshCategoryCounts.team },
    { value: "pro", label: "Pro", count: refreshCategoryCounts.pro }
  ];
  const filterOptions: Array<{ value: TokenPoolPlanFilter; label: string; count: number }> = [
    { value: "all", label: "全部套餐", count: refreshCategoryCounts.all },
    { value: "pro", label: "Pro", count: refreshCategoryCounts.pro },
    { value: "team", label: "Team", count: refreshCategoryCounts.team },
    { value: "plus", label: "Plus", count: refreshCategoryCounts.plus },
    { value: "free", label: "Free", count: refreshCategoryCounts.free }
  ];

  useEffect(() => {
    if (!openActionEntryId && !bulkRefreshMenuOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (bulkRefreshMenuOpen && target.closest("[data-token-pool-bulk-refresh]")) {
        return;
      }
      const inside = target.closest(`[data-token-pool-menu-id="${openActionEntryId}"]`);
      if (inside) {
        return;
      }
      setOpenActionEntryId(undefined);
      setPendingDeleteEntryId(undefined);
      setBulkRefreshMenuOpen(false);
    };

    const handleScrollOrResize = () => {
      setOpenActionEntryId(undefined);
      setPendingDeleteEntryId(undefined);
      setActionAnchorRect(undefined);
      setBulkRefreshMenuOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [bulkRefreshMenuOpen, openActionEntryId]);

  useEffect(() => {
    const wrap = tableWrapRef.current;
    const currentRow = currentRowRef.current;
    if (!wrap || !currentRow) {
      return;
    }
    requestAnimationFrame(() => {
      currentRow.scrollIntoView({
        block: "nearest",
        inline: "nearest"
      });
    });
  }, [visibleEntries]);

  return (
    <section className="token-pool-panel">
      <p className="token-pool-help">
        账号池只操作 <code>pool-runner</code> 专用槽位，不直接改普通账号槽位。跨设备同步记录请使用上面的导出 / 导入。
      </p>

      <div className="token-pool-runner-summary">
        <span>当前活动槽位：{props.activeProfileName ? `${props.activeProfileName} (${props.activeProfileId})` : "未识别"}</span>
        <span>
          pool-runner：{props.poolRunnerProfile ? `${props.poolRunnerProfile.name} (${props.poolRunnerProfile.id})` : "未创建"}
          {isPoolRunnerActive ? " · 当前已激活" : ""}
        </span>
      </div>

      <div className="token-pool-import-actions">
        <button onClick={props.onImportSingle}>导入单个 JSON</button>
        <button onClick={props.onImportMultiple}>导入多个 JSON</button>
        <button onClick={props.onImportDirectory}>导入目录</button>
        <button onClick={props.onSyncCurrentToPoolRunner} disabled={!canSyncCurrentToPoolRunner}>
          同步当前记录到池槽位
        </button>
        <button onClick={props.onSwitchToPoolRunner} disabled={isPoolRunnerActive}>
          {props.poolRunnerProfile ? "切换到 pool-runner" : "创建并切换到 pool-runner"}
        </button>
      </div>

      <div className="token-pool-settings">
        <label className="check-row">
          <span className="check-text">开启账号池自动检测</span>
          <input
            type="checkbox"
            checked={props.tokenPool.settings.autoSwitchEnabled}
            onChange={(e) => props.onUpdateSettings({ autoSwitchEnabled: e.target.checked })}
          />
        </label>
        <label className="token-pool-interval">
          <span className="check-text">用量自动刷新频率</span>
          <select
            value={props.tokenPool.settings.pollIntervalMs}
            onChange={(e) => props.onUpdateSettings({ pollIntervalMs: Number(e.target.value) })}
          >
            <option value={0}>禁用</option>
            <option value={5 * 60 * 1000}>每 5 分钟</option>
            <option value={15 * 60 * 1000}>每 15 分钟</option>
            <option value={30 * 60 * 1000}>每 30 分钟</option>
            <option value={60 * 60 * 1000}>每 1 小时</option>
          </select>
        </label>
        <label className="check-row">
          <span className="check-text">手动切换后自动重启 Codex</span>
          <input
            type="checkbox"
            checked={props.tokenPool.settings.autoRelaunchAfterSwitch}
            onChange={(e) => props.onUpdateSettings({ autoRelaunchAfterSwitch: e.target.checked })}
          />
        </label>
      </div>

      {!isPoolRunnerActive ? (
        <p className="warning">当前未切到 pool-runner。账号池可以继续导入和单条查额度，但切换 token 前请先同步记录并切到 pool-runner。</p>
      ) : null}

      {props.tokenPool.lastAutoSwitchMessage ? (
        <p className="token-pool-last-status">
          最近自动检测：{props.tokenPool.lastAutoSwitchMessage}
          {props.tokenPool.lastAutoSwitchAt ? ` · ${formatTime(props.tokenPool.lastAutoSwitchAt)}` : ""}
        </p>
      ) : null}

      <div className="token-pool-legend">
        <span>当前 Codex 目录：{props.codexHome || "-"}</span>
        <span>池内账号数：{entries.length}</span>
        <span>当前显示：{visibleEntries.length}</span>
      </div>

      <div ref={tableWrapRef} className="accounts-table-wrap token-pool-table-wrap">
        <table className="accounts-table token-pool-table">
          <colgroup>
            <col className="token-pool-order-col" />
            <col className="token-pool-account-width-col" />
            <col className="token-pool-usage-col" />
            <col className="token-pool-status-col" />
            <col className="token-pool-actions-col" />
          </colgroup>
          <thead>
            <tr>
              <th className="accounts-order-col" aria-label="排序"></th>
              <th>
                <div className="token-pool-th-control token-pool-account-head-controls">
                  <span>账号</span>
                  <select
                    aria-label="套餐筛选"
                    title="套餐筛选"
                    value={planFilter}
                    onChange={(event) => setPlanFilter(event.target.value as TokenPoolPlanFilter)}
                  >
                    {filterOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}（{option.count}）
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="视图排序"
                    title="视图排序"
                    value={sortMode}
                    onChange={(event) => setSortMode(event.target.value as TokenPoolSortMode)}
                  >
                    <option value="manual">手动</option>
                    <option value="plan">套餐</option>
                    <option value="available">可用</option>
                    <option value="remaining">余额</option>
                    <option value="refreshed">刷新</option>
                  </select>
                </div>
              </th>
              <th>
                <div className="token-pool-th-control token-pool-usage-head-controls" data-token-pool-bulk-refresh>
                  <span>5h/7d</span>
                  <button
                    type="button"
                    className="token-pool-icon-button"
                    title="批量刷新用量"
                    aria-label="批量刷新用量"
                    onClick={() => setBulkRefreshMenuOpen((value) => !value)}
                  >
                    ↻
                  </button>
                  {bulkRefreshMenuOpen ? (
                    <div className="token-pool-bulk-refresh-menu">
                      {refreshCategoryOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={option.value === bulkRefreshCategory ? "token-pool-menu-item active" : "token-pool-menu-item"}
                          disabled={option.count === 0}
                          onClick={() => {
                            setBulkRefreshCategory(option.value);
                            props.onRefreshGroup(option.value);
                            setBulkRefreshMenuOpen(false);
                          }}
                        >
                          <span>{option.label}</span>
                          <span>{option.count}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </th>
              <th>
                <label className="token-pool-th-toggle" title="只看可用账号">
                  <span>状态</span>
                  <input
                    type="checkbox"
                    checked={availableOnly}
                    onChange={(event) => setAvailableOnly(event.target.checked)}
                    aria-label="只看可用账号"
                  />
                  <span>可用</span>
                </label>
              </th>
              <th className="accounts-actions-col">操作</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td className="token-pool-empty-row" colSpan={5}>暂未导入 token JSON。</td>
              </tr>
            ) : null}
            {entries.length > 0 && visibleEntries.length === 0 ? (
              <tr>
                <td className="token-pool-empty-row" colSpan={5}>当前筛选条件下没有账号。</td>
              </tr>
            ) : null}

            {visibleEntries.map((entry, index) => {
              const isActionOpen = openActionEntryId === entry.id;
              const confirmDelete = pendingDeleteEntryId === entry.id;
              const isSwitchBlocked = isManualSwitchBlocked(entry);
              const isDragOver = dragOverEntryId === entry.id && draggingEntryId !== entry.id;
              const planBadge = getPlanBadge(entry.usage?.planType || entry.planTypeHint);
              return (
                <tr
                  ref={entry.current ? currentRowRef : undefined}
                  key={entry.id}
                  className={`${entry.current ? "current" : ""} ${draggingEntryId === entry.id ? "dragging" : ""} ${isDragOver ? "drag-over" : ""}`.trim()}
                  onDragOver={(event) => {
                    if (!canReorderCurrentView || !draggingEntryId || draggingEntryId === entry.id) {
                      return;
                    }
                    event.preventDefault();
                    if (dragOverEntryId !== entry.id) {
                      setDragOverEntryId(entry.id);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (!canReorderCurrentView || !draggingEntryId || draggingEntryId === entry.id) {
                      setDraggingEntryId(undefined);
                      setDragOverEntryId(undefined);
                      return;
                    }
                    const orderedIds = entries.map((item) => item.id);
                    const fromIndex = orderedIds.indexOf(draggingEntryId);
                    const toIndex = orderedIds.indexOf(entry.id);
                    if (fromIndex >= 0 && toIndex >= 0 && fromIndex != toIndex) {
                      const nextIds = [...orderedIds];
                      const [moved] = nextIds.splice(fromIndex, 1);
                      nextIds.splice(toIndex, 0, moved);
                      props.onReorderEntries(nextIds);
                    }
                    setDraggingEntryId(undefined);
                    setDragOverEntryId(undefined);
                  }}
                >
                  <td className="accounts-order-col">
                    <button
                      type="button"
                      className="drag-handle-button"
                      draggable
                      onDragStart={(event) => {
                        if (!canReorderCurrentView) {
                          event.preventDefault();
                          return;
                        }
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", entry.id);
                        setDraggingEntryId(entry.id);
                        setDragOverEntryId(entry.id);
                      }}
                      onDragEnd={() => {
                        setDraggingEntryId(undefined);
                        setDragOverEntryId(undefined);
                      }}
                      aria-label={`拖拽排序 ${entry.email || entry.accountId}`}
                      title={canReorderCurrentView ? "拖拽排序" : "筛选/排序视图下不改真实池顺序"}
                      disabled={!canReorderCurrentView}
                    >
                      ⋮⋮
                    </button>
                  </td>
                  <td className="token-pool-account-col">
                    <div className="token-pool-account-title">
                      <strong title={`${entry.email || entry.accountId}${entry.expired ? `\n过期时间: ${formatTime(entry.expired)}` : ""}`}>
                        {entry.email || entry.accountId}
                      </strong>
                      {planBadge ? <span className={`plan-badge plan-badge-${planBadge.tone}`}>{planBadge.label}</span> : null}
                    </div>
                  </td>
                  <td title={buildUsageTooltip(entry)}>
                    {`${formatPercent(entry.usage?.fiveHour?.remainingPercent)}/${formatPercent(entry.usage?.oneWeek?.remainingPercent)}`}
                  </td>
                  <td>{statusLabel(entry)}</td>
                  <td className="accounts-actions-col">
                    <div className="account-actions-menu" data-token-pool-menu-id={entry.id}>
                      <button
                        className="action-trigger"
                        onClick={(e) => {
                          setPendingDeleteEntryId(undefined);
                          if (openActionEntryId === entry.id) {
                            setOpenActionEntryId(undefined);
                            setActionAnchorRect(undefined);
                          } else {
                            setOpenActionEntryId(entry.id);
                            setActionAnchorRect(e.currentTarget.getBoundingClientRect());
                          }
                        }}
                      >
                        ...
                      </button>
                      {isActionOpen && actionAnchorRect
                        ? createPortal(
                            <div
                              className="action-menu-panel"
                              data-token-pool-menu-id={entry.id}
                              style={{
                                position: "fixed",
                                top: actionAnchorRect.top + 180 > window.innerHeight ? "auto" : `${actionAnchorRect.top}px`,
                                bottom:
                                  actionAnchorRect.top + 180 > window.innerHeight
                                    ? `${window.innerHeight - actionAnchorRect.bottom}px`
                                    : "auto",
                                right: `${window.innerWidth - actionAnchorRect.left + 8}px`,
                                left: "auto",
                                margin: 0
                              }}
                            >
                              <button
                                onClick={() => {
                                  props.onRefreshEntry(entry.id);
                                  setOpenActionEntryId(undefined);
                                }}
                              >
                                刷新额度
                              </button>
                              <button
                                onClick={() => {
                                  props.onActivateEntry(entry.id);
                                  setOpenActionEntryId(undefined);
                                }}
                                disabled={entry.current || !isPoolRunnerActive || isSwitchBlocked}
                                title={
                                  isSwitchBlocked
                                    ? "该账号当前额度不可切换，请先刷新并确认状态。"
                                    : !isPoolRunnerActive
                                      ? "请先切换到 pool-runner。"
                                      : undefined
                                }
                              >
                                {entry.current ? "当前" : isSwitchBlocked ? "不可切换" : "切换"}
                              </button>
                              <button
                                onClick={() => {
                                  props.onMoveEntry(entry.id, "up");
                                  setOpenActionEntryId(undefined);
                                }}
                                disabled={!canReorderCurrentView || index === 0}
                                title={!canReorderCurrentView ? "筛选/排序视图下不改真实池顺序" : undefined}
                              >
                                上移
                              </button>
                              <button
                                onClick={() => {
                                  props.onMoveEntry(entry.id, "down");
                                  setOpenActionEntryId(undefined);
                                }}
                                disabled={!canReorderCurrentView || index === visibleEntries.length - 1}
                                title={!canReorderCurrentView ? "筛选/排序视图下不改真实池顺序" : undefined}
                              >
                                下移
                              </button>
                              {!confirmDelete ? (
                                <button onClick={() => setPendingDeleteEntryId(entry.id)}>删除</button>
                              ) : (
                                <div className="action-delete-confirm">
                                  <button
                                    className="danger"
                                    onClick={() => {
                                      setPendingDeleteEntryId(undefined);
                                      setOpenActionEntryId(undefined);
                                      props.onDeleteEntry(entry.id);
                                    }}
                                  >
                                    确认删除
                                  </button>
                                  <button onClick={() => setPendingDeleteEntryId(undefined)}>取消</button>
                                </div>
                              )}
                            </div>,
                            document.body
                          )
                        : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {usageErrorSummary ? (
        <div className="warning">
          最近一次账号池用量刷新存在失败项：{usageErrorSummary}
        </div>
      ) : null}

      {!canReorderCurrentView ? <p className="token-pool-help">当前使用了表头筛选/排序，只影响展示，不会改真实池顺序；拖拽和上移/下移已临时禁用。</p> : null}
      <p className="token-pool-help">说明：筛选和排序只影响当前表格展示，不会改变账号池真实顺序。自动检测会按真实池顺序串行刷新整池账号。</p>
    </section>
  );
}
