import { useEffect, useMemo, useState } from "react";
import type { ProfileSummary, TokenPoolEntry, TokenPoolSnapshot } from "@codex-migration/shared-contracts";
import { formatPercent, formatTime, getPlanBadge, summarizeUsageErrors, useStableSelection } from "./desktopUi";

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

function statusLabel(entry: TokenPoolEntry): string {
  switch (entry.status) {
    case "available":
      return "可切换";
    case "exhausted":
      return "已用尽";
    case "authInvalid":
      return "登录失效";
    case "incomplete":
      return "状态不完整";
    default:
      return "待检测";
  }
}

function statusTone(entry: TokenPoolEntry): "neutral" | "good" | "caution" | "danger" {
  switch (entry.status) {
    case "available":
      return "good";
    case "exhausted":
      return "caution";
    case "authInvalid":
      return "danger";
    case "incomplete":
      return "caution";
    default:
      return "neutral";
  }
}

function isManualSwitchBlocked(entry: TokenPoolEntry): boolean {
  return entry.status === "exhausted" || entry.status === "authInvalid" || entry.status === "incomplete" || entry.status === "neverChecked";
}

export function DesktopTokenPoolPage(props: Props): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | undefined>(props.tokenPool.activeEntryId ?? props.tokenPool.entries[0]?.id);
  const selectedEntry = useStableSelection(props.tokenPool.entries, selectedId ?? props.tokenPool.activeEntryId);
  const selectedPlanBadge = getPlanBadge(selectedEntry?.usage?.planType || selectedEntry?.planTypeHint);
  const isPoolRunnerActive = props.activeProfileId === props.poolRunnerProfile?.id;
  const usageErrorSummary = useMemo(
    () =>
      summarizeUsageErrors(
        props.tokenPool.entries.map((entry) => ({
          name: entry.email || entry.accountId,
          usageError: entry.usageError
        }))
      ),
    [props.tokenPool.entries]
  );

  useEffect(() => {
    if (!selectedEntry) {
      setSelectedId(undefined);
      return;
    }
    setSelectedId(selectedEntry.id);
  }, [selectedEntry]);

  function selectRelative(direction: "up" | "down"): void {
    if (props.tokenPool.entries.length === 0) {
      return;
    }
    const currentIndex = props.tokenPool.entries.findIndex((entry) => entry.id === (selectedEntry?.id ?? selectedId));
    const safeIndex = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex = direction === "up" ? Math.max(0, safeIndex - 1) : Math.min(props.tokenPool.entries.length - 1, safeIndex + 1);
    setSelectedId(props.tokenPool.entries[nextIndex]?.id);
  }

  return (
    <div className="desktop-panel-stack">
      <section className="desktop-inline-panel">
        <div className="desktop-inline-actions">
          <button className="primary" onClick={props.onImportSingle}>导入单个 JSON</button>
          <button onClick={props.onImportMultiple}>导入多个 JSON</button>
          <button onClick={props.onImportDirectory}>导入目录</button>
          <button onClick={props.onSyncCurrentToPoolRunner} disabled={!props.activeProfileId || isPoolRunnerActive}>
            同步当前记录到 pool-runner
          </button>
          <button onClick={props.onSwitchToPoolRunner} disabled={isPoolRunnerActive}>
            {props.poolRunnerProfile ? "切换到 pool-runner" : "创建并切换到 pool-runner"}
          </button>
        </div>

        <div className="desktop-settings-inline">
          <label className="desktop-toggle">
            <span>自动切换</span>
            <input
              type="checkbox"
              checked={props.tokenPool.settings.autoSwitchEnabled}
              onChange={(event) => props.onUpdateSettings({ autoSwitchEnabled: event.target.checked })}
            />
          </label>
          <label className="desktop-field desktop-field-inline">
            <span>检测间隔</span>
            <select
              value={props.tokenPool.settings.pollIntervalMs}
              onChange={(event) => props.onUpdateSettings({ pollIntervalMs: Number(event.target.value) })}
            >
              <option value={0}>禁用</option>
              <option value={1 * 60 * 1000}>每 1 分钟</option>
              <option value={3 * 60 * 1000}>每 3 分钟</option>
              <option value={5 * 60 * 1000}>每 5 分钟</option>
              <option value={15 * 60 * 1000}>每 15 分钟</option>
              <option value={30 * 60 * 1000}>每 30 分钟</option>
            </select>
          </label>
          <label className="desktop-toggle">
            <span>切换后自动重启 Codex</span>
            <input
              type="checkbox"
              checked={props.tokenPool.settings.autoRelaunchAfterSwitch}
              onChange={(event) => props.onUpdateSettings({ autoRelaunchAfterSwitch: event.target.checked })}
            />
          </label>
        </div>
      </section>

      {!isPoolRunnerActive ? (
        <p className="warning">
          当前未切到 pool-runner。你仍然可以导入账号池和单条刷新额度，但执行切换前请先同步当前记录并切到 pool-runner。
        </p>
      ) : null}

      <section className="desktop-master-detail">
        <aside className="desktop-master-list">
          <header className="desktop-subsection-header">
            <div>
              <h3>账号池条目</h3>
              <p>
                当前活动槽位 {props.activeProfileName ? `${props.activeProfileName} (${props.activeProfileId})` : "未识别"} · 池内账号 {props.tokenPool.entries.length}
              </p>
            </div>
          </header>

          <div className="desktop-list-stack">
            {props.tokenPool.entries.length === 0 ? (
              <div className="desktop-empty-state compact">
                <h3>账号池为空</h3>
                <p>导入 JSON 后，这里会展示 pool-runner 可切换的账号条目。</p>
              </div>
            ) : null}

            {props.tokenPool.entries.map((entry, index) => {
              const planBadge = getPlanBadge(entry.usage?.planType || entry.planTypeHint);
              return (
                <div
                  key={entry.id}
                  className={`desktop-list-item ${entry.id === selectedEntry?.id ? "selected" : ""} ${entry.current ? "current" : ""}`.trim()}
                  onClick={() => setSelectedId(entry.id)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      selectRelative("up");
                      return;
                    }
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      selectRelative("down");
                      return;
                    }
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId(entry.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="desktop-list-item-copy">
                    <div className="desktop-list-item-title-row">
                      <strong>{entry.email || entry.accountId}</strong>
                      {planBadge ? <span className={`desktop-badge desktop-badge-${planBadge.tone}`}>{planBadge.label}</span> : null}
                      {entry.current ? <span className="desktop-badge desktop-badge-good">当前</span> : null}
                    </div>
                    <span className="desktop-list-item-meta">{entry.planTypeHint || entry.usage?.planType || "-"}</span>
                    <span className="desktop-list-item-meta">
                      5h {formatPercent(entry.usage?.fiveHour?.remainingPercent)} · 7d {formatPercent(entry.usage?.oneWeek?.remainingPercent)}
                    </span>
                  </div>
                  <div className="desktop-list-item-side">
                    <span className={`desktop-badge desktop-badge-${statusTone(entry)}`}>{statusLabel(entry)}</span>
                    <div className="desktop-mini-actions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onMoveEntry(entry.id, "up");
                        }}
                        disabled={index === 0}
                      >
                        上移
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onMoveEntry(entry.id, "down");
                        }}
                        disabled={index === props.tokenPool.entries.length - 1}
                      >
                        下移
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="desktop-detail-panel">
          {selectedEntry ? (
            <>
              <header className="desktop-subsection-header">
                <div>
                  <div className="desktop-heading-with-badge">
                    <h3>{selectedEntry.email || selectedEntry.accountId}</h3>
                    {selectedPlanBadge ? <span className={`desktop-badge desktop-badge-${selectedPlanBadge.tone}`}>{selectedPlanBadge.label}</span> : null}
                  </div>
                  <p>{selectedEntry.accountId}</p>
                </div>
                <div className="desktop-inline-actions">
                  <button onClick={() => props.onRefreshEntry(selectedEntry.id)}>刷新额度</button>
                  <button
                    className="primary"
                    onClick={() => props.onActivateEntry(selectedEntry.id)}
                    disabled={selectedEntry.current || !isPoolRunnerActive || isManualSwitchBlocked(selectedEntry)}
                  >
                    {selectedEntry.current ? "当前条目" : "切换到该条目"}
                  </button>
                  <button className="danger" onClick={() => props.onDeleteEntry(selectedEntry.id)}>删除条目</button>
                </div>
              </header>

              <div className="desktop-detail-grid">
                <div className="desktop-info-card">
                  <h4>额度与状态</h4>
                  <dl>
                    <div><dt>状态</dt><dd>{statusLabel(selectedEntry)}</dd></div>
                    <div><dt>套餐</dt><dd>{selectedEntry.usage?.planType || selectedEntry.planTypeHint || "-"}</dd></div>
                    <div><dt>5小时剩余</dt><dd>{formatPercent(selectedEntry.usage?.fiveHour?.remainingPercent)}</dd></div>
                    <div><dt>7天剩余</dt><dd>{formatPercent(selectedEntry.usage?.oneWeek?.remainingPercent)}</dd></div>
                    <div><dt>最近刷新</dt><dd>{selectedEntry.usage ? formatTime(selectedEntry.usage.fetchedAt) : formatTime(selectedEntry.lastRefresh)}</dd></div>
                    <div><dt>导入时间</dt><dd>{formatTime(selectedEntry.importedAt)}</dd></div>
                    <div><dt>过期时间</dt><dd>{formatTime(selectedEntry.expired)}</dd></div>
                  </dl>
                </div>

                <div className="desktop-info-card">
                  <h4>运行约束</h4>
                  <dl>
                    <div><dt>当前活动槽位</dt><dd>{props.activeProfileName ? `${props.activeProfileName} (${props.activeProfileId})` : "未识别"}</dd></div>
                    <div><dt>pool-runner</dt><dd>{props.poolRunnerProfile ? `${props.poolRunnerProfile.name} (${props.poolRunnerProfile.id})` : "未创建"}</dd></div>
                    <div><dt>自动切换</dt><dd>{props.tokenPool.settings.autoSwitchEnabled ? "已启用" : "未启用"}</dd></div>
                    <div><dt>切换后重启</dt><dd>{props.tokenPool.settings.autoRelaunchAfterSwitch ? "已启用" : "未启用"}</dd></div>
                    <div><dt>最近自动切换</dt><dd>{props.tokenPool.lastAutoSwitchAt ? `${formatTime(props.tokenPool.lastAutoSwitchAt)} · ${props.tokenPool.lastAutoSwitchMessage || ""}` : "暂无"}</dd></div>
                    <div><dt>Codex 目录</dt><dd>{props.codexHome || "-"}</dd></div>
                  </dl>
                  {selectedEntry.usageError ? <p className="warning">最近一次额度刷新失败：{selectedEntry.usageError}</p> : null}
                  {isManualSwitchBlocked(selectedEntry) ? (
                    <p className="warning">该条目当前不可手动切换。请先刷新额度并确认状态恢复为“可切换”。</p>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <div className="desktop-empty-state">
              <h3>先导入账号池条目</h3>
              <p>导入后这里会展示条目详情、额度状态和切换动作。</p>
            </div>
          )}
        </section>
      </section>

      {usageErrorSummary ? <div className="warning">最近一次账号池用量刷新存在失败项：{usageErrorSummary}</div> : null}
    </div>
  );
}
