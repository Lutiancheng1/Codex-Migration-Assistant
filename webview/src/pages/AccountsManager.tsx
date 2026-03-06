import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ProfileSummary,
  ProfileUsageWindow,
  ThreadCleanupApplyMode,
  ThreadCleanupPreviewResult,
  ThreadCleanupResult,
  ThreadCleanupScope
} from "../api/types";
import { InfoHint } from "../components/InfoHint";

type Props = {
  profilesRoot: string;
  profiles: ProfileSummary[];
  activeProfileId?: string;
  backupBeforeSwitch: boolean;
  newProfileName: string;
  threadCleanupInput: string;
  threadCleanupScope: ThreadCleanupScope;
  threadCleanupProfileId: string;
  threadCleanupBackupEnabled: boolean;
  threadCleanupPreview?: ThreadCleanupPreviewResult;
  threadCleanupResult?: ThreadCleanupResult;
  onChange(field: string, value: string | boolean): void;
  onRefresh(): void;
  onRefreshUsage(profileId?: string): void;
  onExportProfile(profileId: string): void;
  onCreate(): void;
  onActivate(profileId: string): void;
  onActivateAndMerge(profileId: string): void;
  onActivateAndOverwrite(profileId: string): void;
  onDelete(profileId: string): void;
  onPreviewThreadCleanup(): void;
  onStartThreadCleanup(applyMode: ThreadCleanupApplyMode): void;
};

function formatTime(value?: string): string {
  if (!value) {
    return "-";
  }
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) {
    return value;
  }
  return new Date(ts).toLocaleString();
}

function formatUsagePercent(window?: ProfileUsageWindow): string {
  if (!window) {
    return "-";
  }
  return `${Math.max(0, Math.min(100, window.remainingPercent)).toFixed(0)}%`;
}

function computeCleanupSummary(preview?: ThreadCleanupPreviewResult): {
  matchedProfiles: number;
  matchedThreads: number;
  matchedFiles: number;
} {
  if (!preview) {
    return { matchedProfiles: 0, matchedThreads: 0, matchedFiles: 0 };
  }
  const matchedProfiles = preview.profiles.filter((profile) => profile.matches.length > 0).length;
  return {
    matchedProfiles,
    matchedThreads: preview.totalMatchedThreads,
    matchedFiles: preview.totalMatchedFiles
  };
}

export function AccountsManager(props: Props): JSX.Element {
  const activeProfile = props.profiles.find((item) => item.id === props.activeProfileId);
  const canCreate = props.newProfileName.trim().length > 0;
  const [pendingDeleteProfileId, setPendingDeleteProfileId] = useState<string>();
  const [pendingMergeProfileId, setPendingMergeProfileId] = useState<string>();
  const [pendingOverwriteProfileId, setPendingOverwriteProfileId] = useState<string>();
  const [openActionProfileId, setOpenActionProfileId] = useState<string>();
  const [actionAnchorRect, setActionAnchorRect] = useState<DOMRect | undefined>();
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(5 * 60 * 1000);
  const [pendingCleanupMode, setPendingCleanupMode] = useState<ThreadCleanupApplyMode>();
  const [isThreadCleanupExpanded, setIsThreadCleanupExpanded] = useState<boolean>(false);
  const [isCleanupPreviewModalOpen, setIsCleanupPreviewModalOpen] = useState<boolean>(false);
  const [isCleanupResultModalOpen, setIsCleanupResultModalOpen] = useState<boolean>(false);
  const lastPreviewRef = React.useRef<ThreadCleanupPreviewResult | undefined>();
  const lastResultRef = React.useRef<ThreadCleanupResult | undefined>();
  const cleanupSummary = useMemo(() => computeCleanupSummary(props.threadCleanupPreview), [props.threadCleanupPreview]);
  const canPreviewCleanup =
    props.threadCleanupInput.trim().length > 0 &&
    (props.threadCleanupScope !== "single" || props.threadCleanupProfileId.trim().length > 0);
  const canExecuteCleanup = !!props.threadCleanupPreview && cleanupSummary.matchedThreads > 0;
  const initialRefreshDone = React.useRef(false);

  useEffect(() => {
    if (props.profiles.length > 0 && !initialRefreshDone.current) {
      initialRefreshDone.current = true;
      props.onRefreshUsage();
    }
  }, [props.profiles, props.onRefreshUsage]);

  useEffect(() => {
    if (autoRefreshInterval <= 0) {
      return;
    }
    const timer = setInterval(() => {
      if (props.profiles.length > 0) {
        props.onRefreshUsage();
      }
    }, autoRefreshInterval);
    return () => clearInterval(timer);
  }, [autoRefreshInterval, props.profiles, props.onRefreshUsage]);

  useEffect(() => {
    if (!openActionProfileId) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const inside = target.closest(`[data-action-menu-id="${openActionProfileId}"]`);
      if (inside) {
        return;
      }
      setOpenActionProfileId(undefined);
      setPendingDeleteProfileId(undefined);
    };

    const handleScrollOrResize = () => {
      setOpenActionProfileId(undefined);
      setPendingDeleteProfileId(undefined);
      setPendingMergeProfileId(undefined);
      setPendingOverwriteProfileId(undefined);
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
  }, [openActionProfileId]);

  useEffect(() => {
    setPendingCleanupMode(undefined);
  }, [props.threadCleanupPreview]);

  useEffect(() => {
    if (props.threadCleanupPreview || props.threadCleanupResult) {
      setIsThreadCleanupExpanded(true);
    }
  }, [props.threadCleanupPreview, props.threadCleanupResult]);

  useEffect(() => {
    if (props.threadCleanupPreview && props.threadCleanupPreview !== lastPreviewRef.current) {
      setIsCleanupPreviewModalOpen(true);
    }
    lastPreviewRef.current = props.threadCleanupPreview;
  }, [props.threadCleanupPreview]);

  useEffect(() => {
    if (props.threadCleanupResult && props.threadCleanupResult !== lastResultRef.current) {
      setIsCleanupResultModalOpen(true);
    }
    lastResultRef.current = props.threadCleanupResult;
  }, [props.threadCleanupResult]);

  return (
    <section>
      <div className="grid">
        <p><strong>账号目录根：</strong> {props.profilesRoot || "未初始化"}</p>
        <p><strong>当前激活：</strong> {activeProfile ? `${activeProfile.name} (${activeProfile.id})` : "未识别"}</p>
        {!activeProfile?.hasAuth ? (
          <p className="warning">当前账号槽位未检测到 auth 登录态。切换到新槽位后，请在 Codex 客户端登录一次。</p>
        ) : null}
      </div>

      <div className="account-create" style={{ marginTop: "16px" }}>
        <input
          className="account-create-input"
          placeholder="输入新账号名称，例如：工作账号 / 个人账号"
          value={props.newProfileName}
          onChange={(e) => props.onChange("newProfileName", e.target.value)}
        />
        <div className="account-create-actions">
          <button onClick={props.onCreate} disabled={!canCreate}>新增账号</button>
          <button onClick={props.onRefresh}>刷新列表</button>
          <button onClick={() => props.onRefreshUsage()}>刷新用量</button>
        </div>
      </div>

      <div className="account-create-tip-line">
        <span className="check-text">
          新增账号步骤说明
          <InfoHint
            label="新增账号步骤说明"
            tip={"1. 输入账号名称并点击“新增账号”。\n2. 在表格操作中点“切换”到新账号槽位。\n3. 客户端重启后，按提示登录该账号一次。\n4. 之后可在此页面随时来回切换账号。"}
          />
        </span>
      </div>

      <div style={{ marginBottom: "12px" }}>
        <label className="check-row">
          <span className="check-text">
            切换前自动备份当前账号（不含 auth）
            <InfoHint
              label="切换前自动备份"
              tip="开启后，每次切换账号前会先把当前账号导出为 ZIP（不含 auth 登录态）。这样切错或合并异常时可快速回滚。"
            />
          </span>
          <input
            type="checkbox"
            checked={props.backupBeforeSwitch}
            onChange={(e) => props.onChange("backupBeforeSwitch", e.target.checked)}
            aria-label="切换前自动备份当前账号"
          />
        </label>
      </div>

      <div style={{ marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
        <span className="check-text">用量自动刷新频率:</span>
        <select value={autoRefreshInterval} onChange={(e) => setAutoRefreshInterval(Number(e.target.value))} style={{ width: "auto" }}>
          <option value={0}>禁用</option>
          <option value={1 * 60 * 1000}>每 1 分钟</option>
          <option value={3 * 60 * 1000}>每 3 分钟</option>
          <option value={5 * 60 * 1000}>每 5 分钟</option>
          <option value={15 * 60 * 1000}>每 15 分钟</option>
          <option value={30 * 60 * 1000}>每 30 分钟</option>
        </select>
      </div>

      <div className="accounts-table-wrap">
        <table className="accounts-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>标识</th>
              <th>登录态</th>
              <th>State</th>
              <th>套餐</th>
              <th>5小时剩余</th>
              <th>7天剩余</th>
              <th>用量更新时间</th>
              <th>最后激活</th>
              <th className="accounts-actions-col">操作</th>
            </tr>
          </thead>
          <tbody>
            {props.profiles.map((profile) => {
              const isActive = profile.id === props.activeProfileId;
              const confirmDelete = pendingDeleteProfileId === profile.id;
              const confirmMerge = pendingMergeProfileId === profile.id;
              const confirmOverwrite = pendingOverwriteProfileId === profile.id;
              const isActionOpen = openActionProfileId === profile.id;
              return (
                <tr key={profile.id}>
                  <td>{profile.name}</td>
                  <td>{profile.id}</td>
                  <td>{profile.hasAuth ? "已检测" : "未检测"}</td>
                  <td>{profile.hasState ? "有" : "无"}</td>
                  <td>{profile.usage?.planType || "-"}</td>
                  <td>{formatUsagePercent(profile.usage?.fiveHour)}</td>
                  <td>{formatUsagePercent(profile.usage?.oneWeek)}</td>
                  <td>{profile.usage ? formatTime(profile.usage.fetchedAt) : "-"}</td>
                  <td>{formatTime(profile.lastActivatedAt)}</td>
                  <td className="accounts-actions-col">
                    <div className="account-actions-menu" data-action-menu-id={profile.id}>
                      <button
                        className="action-trigger"
                        onClick={(e) => {
                          setPendingDeleteProfileId(undefined);
                          setPendingMergeProfileId(undefined);
                          setPendingOverwriteProfileId(undefined);
                          if (openActionProfileId === profile.id) {
                            setOpenActionProfileId(undefined);
                            setActionAnchorRect(undefined);
                          } else {
                            setOpenActionProfileId(profile.id);
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
                              data-action-menu-id={profile.id}
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
                                  props.onRefreshUsage(profile.id);
                                  setOpenActionProfileId(undefined);
                                }}
                                disabled={!profile.exists}
                              >
                                刷新用量
                              </button>
                              <button
                                onClick={() => {
                                  props.onExportProfile(profile.id);
                                  setOpenActionProfileId(undefined);
                                }}
                                disabled={!profile.exists}
                              >
                                单独导出
                              </button>
                              <button
                                onClick={() => {
                                  props.onActivate(profile.id);
                                  setOpenActionProfileId(undefined);
                                }}
                                disabled={isActive || !profile.exists}
                              >
                                {isActive ? "当前" : "切换"}
                              </button>
                              <button
                                onClick={() => {
                                  setPendingDeleteProfileId(undefined);
                                  setPendingOverwriteProfileId(undefined);
                                  setPendingMergeProfileId(profile.id);
                                }}
                                disabled={isActive || !profile.exists}
                              >
                                切换并合并
                              </button>
                              {confirmMerge ? (
                                <div className="action-delete-confirm">
                                  <button
                                    className="danger"
                                    onClick={() => {
                                      setPendingMergeProfileId(undefined);
                                      setOpenActionProfileId(undefined);
                                      props.onActivateAndMerge(profile.id);
                                    }}
                                    disabled={isActive || !profile.exists}
                                  >
                                    确认合并
                                  </button>
                                  <button onClick={() => setPendingMergeProfileId(undefined)}>取消</button>
                                </div>
                              ) : null}
                              <button
                                onClick={() => {
                                  setPendingDeleteProfileId(undefined);
                                  setPendingMergeProfileId(undefined);
                                  setPendingOverwriteProfileId(profile.id);
                                }}
                                disabled={isActive || !profile.exists}
                              >
                                切换并覆盖
                              </button>
                              {confirmOverwrite ? (
                                <div className="action-delete-confirm">
                                  <button
                                    className="danger"
                                    onClick={() => {
                                      setPendingOverwriteProfileId(undefined);
                                      setOpenActionProfileId(undefined);
                                      props.onActivateAndOverwrite(profile.id);
                                    }}
                                    disabled={isActive || !profile.exists}
                                  >
                                    确认覆盖
                                  </button>
                                  <button onClick={() => setPendingOverwriteProfileId(undefined)}>取消</button>
                                </div>
                              ) : null}
                              {!confirmDelete ? (
                                <button onClick={() => setPendingDeleteProfileId(profile.id)} disabled={isActive}>
                                  删除
                                </button>
                              ) : (
                                <div className="action-delete-confirm">
                                  <button
                                    className="danger"
                                    onClick={() => {
                                      setPendingDeleteProfileId(undefined);
                                      setOpenActionProfileId(undefined);
                                      props.onDelete(profile.id);
                                    }}
                                    disabled={isActive}
                                  >
                                    确认删除
                                  </button>
                                  <button onClick={() => setPendingDeleteProfileId(undefined)}>取消</button>
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

      {props.profiles.some((item) => item.usageError)
        ? (
            <div className="warning">
              最近一次用量刷新存在失败项：
              {props.profiles
                .filter((item) => item.usageError)
                .map((item) => `${item.name}: ${item.usageError}`)
                .join("；")}
            </div>
          )
        : null}

      <section className="thread-cleanup-panel">
        <button
          type="button"
          className="thread-cleanup-toggle"
          onClick={() => setIsThreadCleanupExpanded((prev) => !prev)}
          aria-expanded={isThreadCleanupExpanded}
        >
          <h3>对话清理（按会话ID）</h3>
          <span className="thread-cleanup-toggle-icon">{isThreadCleanupExpanded ? "▾" : "▸"}</span>
        </button>

        {isThreadCleanupExpanded ? (
          <>
            <p className="thread-cleanup-help">支持输入多个会话ID（逗号/空格/换行分隔），可直接粘贴 Codex 的会话ID（如：019cbe6b-6140-7a62-9ce7-ed24424e4864），先预览后执行删除。</p>

            <label>
              会话ID 列表
              <textarea
                className="thread-cleanup-input"
                rows={4}
                placeholder={"示例：\n019cbe6b-6140-7a62-9ce7-ed24424e4864\n019cbe6b-6140-7a62-9ce7-ed24424e4865"}
                value={props.threadCleanupInput}
                onChange={(e) => props.onChange("threadCleanupInput", e.target.value)}
              />
            </label>

            <div className="thread-cleanup-controls">
              <label>
                清理范围
                <select
                  value={props.threadCleanupScope}
                  onChange={(e) => props.onChange("threadCleanupScope", e.target.value as ThreadCleanupScope)}
                >
                  <option value="all">全部账号（默认）</option>
                  <option value="active">当前账号</option>
                  <option value="single">指定单个账号</option>
                </select>
              </label>

              {props.threadCleanupScope === "single" ? (
                <label>
                  指定账号
                  <select
                    value={props.threadCleanupProfileId}
                    onChange={(e) => props.onChange("threadCleanupProfileId", e.target.value)}
                  >
                    <option value="">请选择账号</option>
                    {props.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name} ({profile.id})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className="check-row">
                <span className="check-text">删除前备份（默认开启）</span>
                <input
                  type="checkbox"
                  checked={props.threadCleanupBackupEnabled}
                  onChange={(e) => props.onChange("threadCleanupBackupEnabled", e.target.checked)}
                />
              </label>

              <button onClick={props.onPreviewThreadCleanup} disabled={!canPreviewCleanup}>
                查找匹配
              </button>
            </div>

            <div className="thread-cleanup-quick-actions">
              {props.threadCleanupPreview ? (
                <button onClick={() => setIsCleanupPreviewModalOpen(true)}>查看检测结果</button>
              ) : null}
              {props.threadCleanupResult ? (
                <button onClick={() => setIsCleanupResultModalOpen(true)}>查看删除结果</button>
              ) : null}
            </div>

            {props.threadCleanupPreview ? (
              <p className="thread-cleanup-help">
                最近预览: 命中账号 {cleanupSummary.matchedProfiles}，命中线程 {cleanupSummary.matchedThreads}，命中文件 {cleanupSummary.matchedFiles}。
              </p>
            ) : null}
          </>
        ) : null}
      </section>

      {isCleanupPreviewModalOpen && props.threadCleanupPreview
        ? createPortal(
            <div className="modal-overlay">
              <div className="modal-content thread-cleanup-modal-content">
                <h2 className="modal-title">检测结果预览</h2>
                <div className="thread-cleanup-preview-summary">
                  <span>命中账号: {cleanupSummary.matchedProfiles}</span>
                  <span>命中线程: {cleanupSummary.matchedThreads}</span>
                  <span>命中文件: {cleanupSummary.matchedFiles}</span>
                  <span>未命中会话ID: {props.threadCleanupPreview.notFoundThreadIds.length}</span>
                </div>
                {props.threadCleanupPreview.notFoundThreadIds.length > 0 ? (
                  <p className="warning">未命中会话ID: {props.threadCleanupPreview.notFoundThreadIds.join(", ")}</p>
                ) : null}
                {cleanupSummary.matchedThreads === 0 ? (
                  <p className="warning">当前没有可删除的命中项。</p>
                ) : null}
                <div className="thread-cleanup-profile-list">
                  {props.threadCleanupPreview.profiles.map((profile) => (
                    <article key={profile.profileId} className="thread-cleanup-profile-card">
                      <h4>{profile.profileName} ({profile.profileId})</h4>
                      <p>命中线程: {profile.matches.length}，命中文件: {profile.matchedFileCount}</p>
                      {profile.missingThreadIds.length > 0 ? (
                        <p className="warning">该账号未命中会话ID: {profile.missingThreadIds.join(", ")}</p>
                      ) : null}
                      {profile.potentialBusyProcesses.length > 0 ? (
                        <p className="warning">
                          可能占用进程: {profile.potentialBusyProcesses.map((item) => `${item.command}(${item.pid})`).join(", ")}
                        </p>
                      ) : null}
                      {profile.matches.length > 0 ? (
                        <ul>
                          {profile.matches.map((match) => (
                            <li key={`${profile.profileId}-${match.id}`}>
                              <code>{match.id}</code>
                              {match.title ? ` · ${match.title}` : ""}
                              {match.archived ? " · archived" : ""}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>-</p>
                      )}
                    </article>
                  ))}
                </div>
                <div className="modal-actions">
                  <button className="secondary" onClick={() => setIsCleanupPreviewModalOpen(false)}>关闭</button>
                  {canExecuteCleanup ? (
                    <button
                      onClick={() => {
                        setIsCleanupPreviewModalOpen(false);
                        setPendingCleanupMode("restartLater");
                      }}
                    >
                      确认删除（下次重启生效）
                    </button>
                  ) : null}
                  {canExecuteCleanup ? (
                    <button
                      className="danger"
                      onClick={() => {
                        setIsCleanupPreviewModalOpen(false);
                        setPendingCleanupMode("killNow");
                      }}
                    >
                      确认删除并立即结束相关进程
                    </button>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {pendingCleanupMode
        ? createPortal(
            <div className="modal-overlay">
              <div className="modal-content">
                <h2 className="modal-title warning-text">二次确认删除</h2>
                <p>
                  将删除线程 {cleanupSummary.matchedThreads} 条，涉及账号 {cleanupSummary.matchedProfiles} 个，
                  备份 {props.threadCleanupBackupEnabled ? "开启" : "关闭"}。
                </p>
                <p>生效策略: {pendingCleanupMode === "killNow" ? "立即结束相关进程生效" : "下次重启生效"}</p>
                <div className="modal-actions">
                  <button className="secondary" onClick={() => setPendingCleanupMode(undefined)}>取消</button>
                  <button
                    className="danger"
                    onClick={() => {
                      props.onStartThreadCleanup(pendingCleanupMode);
                      setPendingCleanupMode(undefined);
                    }}
                  >
                    确认执行
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {isCleanupResultModalOpen && props.threadCleanupResult
        ? createPortal(
            <div className="modal-overlay">
              <div className="modal-content thread-cleanup-modal-content">
                <h2 className="modal-title">删除结果</h2>
                <p>
                  触发结束进程: {props.threadCleanupResult.killTriggered ? "是" : "否"}
                  ，结束数量: {props.threadCleanupResult.killedCount}
                  {props.threadCleanupResult.backupPath ? `，备份目录: ${props.threadCleanupResult.backupPath}` : ""}
                </p>
                <div className="thread-cleanup-profile-list">
                  {props.threadCleanupResult.profiles.map((profile) => (
                    <article key={`${profile.profileId}-result`} className="thread-cleanup-profile-card">
                      <h4>{profile.profileName} ({profile.profileId})</h4>
                      <p>
                        删除: threads {profile.deleted.threads} / logs {profile.deleted.logs} / tools {profile.deleted.dynamicTools} /
                        files {profile.deleted.files}
                      </p>
                      <p>
                        校验残留: DB {profile.verification.dbResidual} / 文件 {profile.verification.fileResidual} /
                        状态 {profile.verification.globalStateResidual}
                      </p>
                      {profile.locked ? <p className="warning">该账号存在占用，未完成清理。</p> : null}
                      {profile.warnings.map((warning, idx) => (
                        <p key={`${profile.profileId}-w-${idx}`} className="warning">{warning}</p>
                      ))}
                      {profile.errors.map((err, idx) => (
                        <p key={`${profile.profileId}-e-${idx}`} className="error">{err}</p>
                      ))}
                    </article>
                  ))}
                </div>
                <div className="modal-actions">
                  <button className="secondary" onClick={() => setIsCleanupResultModalOpen(false)}>关闭</button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </section>
  );
}
