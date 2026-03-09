import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import type { ProfileSummary, TokenPoolEntry, TokenPoolSnapshot } from "../api/types";

const ROW_HEIGHT = 52;
const VIEWPORT_MAX_HEIGHT = 360;
const OVERSCAN = 6;
const TABLE_HEAD_HEIGHT = 36;

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
  onActivateEntry(entryId: string): void;
  onDeleteEntry(entryId: string): void;
  onMoveEntry(entryId: string, direction: "up" | "down"): void;
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
  return entry.status === "exhausted";
}

export function TokenPoolPanel(props: Props): JSX.Element {
  const [scrollTop, setScrollTop] = useState(0);
  const [openActionEntryId, setOpenActionEntryId] = useState<string>();
  const [actionAnchorRect, setActionAnchorRect] = useState<DOMRect | undefined>();
  const [pendingDeleteEntryId, setPendingDeleteEntryId] = useState<string>();
  const entries = props.tokenPool.entries;
  const isPoolRunnerActive = props.activeProfileId === props.poolRunnerProfile?.id;
  const canSyncCurrentToPoolRunner = !isPoolRunnerActive && !!props.activeProfileId;
  const viewportHeight = useMemo(() => {
    if (entries.length === 0) {
      return 120;
    }
    return Math.min(VIEWPORT_MAX_HEIGHT, Math.max(ROW_HEIGHT + 1, entries.length * ROW_HEIGHT + 1));
  }, [entries.length]);
  const totalHeight = entries.length * ROW_HEIGHT;
  const contentScrollTop = Math.max(0, scrollTop - TABLE_HEAD_HEIGHT);
  const visibleCount = Math.ceil(Math.max(ROW_HEIGHT, viewportHeight - TABLE_HEAD_HEIGHT) / ROW_HEIGHT) + OVERSCAN * 2;
  const startIndex = Math.max(0, Math.floor(contentScrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(entries.length, startIndex + visibleCount);
  const visibleEntries = useMemo(() => entries.slice(startIndex, endIndex), [entries, startIndex, endIndex]);

  useEffect(() => {
    if (!openActionEntryId) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const inside = target.closest(`[data-token-pool-menu-id="${openActionEntryId}"]`);
      if (inside) {
        return;
      }
      setOpenActionEntryId(undefined);
      setPendingDeleteEntryId(undefined);
    };

    const handleScrollOrResize = () => {
      setOpenActionEntryId(undefined);
      setPendingDeleteEntryId(undefined);
      setActionAnchorRect(undefined);
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [openActionEntryId]);

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
          <span className="check-text">开启账号池自动切换</span>
          <input
            type="checkbox"
            checked={props.tokenPool.settings.autoSwitchEnabled}
            onChange={(e) => props.onUpdateSettings({ autoSwitchEnabled: e.target.checked })}
          />
        </label>
        <label className="token-pool-interval">
          <span className="check-text">检测间隔</span>
          <select
            value={props.tokenPool.settings.pollIntervalMs}
            onChange={(e) => props.onUpdateSettings({ pollIntervalMs: Number(e.target.value) })}
          >
            <option value={0}>禁用</option>
            <option value={1 * 60 * 1000}>每 1 分钟</option>
            <option value={3 * 60 * 1000}>每 3 分钟</option>
            <option value={5 * 60 * 1000}>每 5 分钟</option>
            <option value={15 * 60 * 1000}>每 15 分钟</option>
            <option value={30 * 60 * 1000}>每 30 分钟</option>
          </select>
        </label>
        <label className="check-row">
          <span className="check-text">切换后自动重启 Codex</span>
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
          最近自动切换：{props.tokenPool.lastAutoSwitchMessage}
          {props.tokenPool.lastAutoSwitchAt ? ` · ${formatTime(props.tokenPool.lastAutoSwitchAt)}` : ""}
        </p>
      ) : null}

      <div className="token-pool-legend">
        <span>当前 Codex 目录：{props.codexHome || "-"}</span>
        <span>池内账号数：{entries.length}</span>
      </div>

      <div className="token-pool-table-wrap">
        <div
          className="token-pool-viewport"
          style={{ height: viewportHeight }}
          onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        >
          <div className="token-pool-table-head token-pool-table-head-sticky">
            <span>账号</span>
            <span>套餐</span>
            <span>5小时</span>
            <span>7天</span>
            <span>状态</span>
            <span>最近刷新</span>
            <span className="token-pool-actions-col">操作</span>
          </div>
          <div className="token-pool-spacer" style={{ height: totalHeight }}>
            {visibleEntries.map((entry, offset) => {
              const index = startIndex + offset;
              const top = index * ROW_HEIGHT;
              const isActionOpen = openActionEntryId === entry.id;
              const confirmDelete = pendingDeleteEntryId === entry.id;
              const isSwitchBlocked = isManualSwitchBlocked(entry);
              return (
                <div className={`token-pool-row ${entry.current ? "current" : ""}`} key={entry.id} style={{ top, height: ROW_HEIGHT }}>
                  <span className="token-pool-account-cell">
                    <strong title={`${entry.email || entry.accountId}${entry.expired ? `\n过期时间: ${formatTime(entry.expired)}` : ""}`}>
                      {entry.email || entry.accountId}
                    </strong>
                  </span>
                  <span>{entry.usage?.planType || entry.planTypeHint || "-"}</span>
                  <span>{formatPercent(entry.usage?.fiveHour?.remainingPercent)}</span>
                  <span>{formatPercent(entry.usage?.oneWeek?.remainingPercent)}</span>
                  <span>{statusLabel(entry)}</span>
                  <span>{entry.usage ? formatTime(entry.usage.fetchedAt) : "-"}</span>
                  <span className="token-pool-actions-col">
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
                                    ? "该账号当前额度已用尽，已禁止手动切换。"
                                    : !isPoolRunnerActive
                                      ? "请先切换到 pool-runner。"
                                      : undefined
                                }
                              >
                                {entry.current ? "当前" : isSwitchBlocked ? "已用尽" : "切换"}
                              </button>
                              <button
                                onClick={() => {
                                  props.onMoveEntry(entry.id, "up");
                                  setOpenActionEntryId(undefined);
                                }}
                                disabled={index === 0}
                              >
                                上移
                              </button>
                              <button
                                onClick={() => {
                                  props.onMoveEntry(entry.id, "down");
                                  setOpenActionEntryId(undefined);
                                }}
                                disabled={index === entries.length - 1}
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
                  </span>
                </div>
              );
            })}
            {entries.length === 0 ? <div className="token-pool-empty">暂未导入 token JSON。</div> : null}
          </div>
        </div>
      </div>

      <p className="token-pool-help">说明：账号池不支持全量查额度。自动检测只检查当前激活账号，其它账号只支持单条手动刷新。</p>
    </section>
  );
}
