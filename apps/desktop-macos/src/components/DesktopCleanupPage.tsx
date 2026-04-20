import type {
  ProfileSummary,
  ThreadCleanupApplyMode,
  ThreadCleanupPreviewResult,
  ThreadCleanupResult,
  ThreadCleanupScope
} from "@codex-migration/shared-contracts";
import { formatTime } from "./desktopUi";

type Props = {
  profiles: ProfileSummary[];
  threadCleanupInput: string;
  threadCleanupScope: ThreadCleanupScope;
  threadCleanupProfileId: string;
  threadCleanupBackupEnabled: boolean;
  preview?: ThreadCleanupPreviewResult;
  result?: ThreadCleanupResult;
  errorMessage?: string;
  onChange(field: string, value: string | boolean): void;
  onPreview(): void;
  onStart(applyMode: ThreadCleanupApplyMode): void;
};

function parsePreviewSummary(preview?: ThreadCleanupPreviewResult): { profiles: number; threads: number; files: number } {
  if (!preview) {
    return { profiles: 0, threads: 0, files: 0 };
  }
  return {
    profiles: preview.profiles.filter((item) => item.matches.length > 0).length,
    threads: preview.totalMatchedThreads,
    files: preview.totalMatchedFiles
  };
}

export function DesktopCleanupPage(props: Props): JSX.Element {
  const summary = parsePreviewSummary(props.preview);
  const canPreview =
    props.threadCleanupInput.trim().length > 0 &&
    (props.threadCleanupScope !== "single" || props.threadCleanupProfileId.trim().length > 0);
  const canExecute = !!props.preview && summary.threads > 0;

  return (
    <div className="desktop-panel-stack">
      {props.errorMessage ? <div className="error">{props.errorMessage}</div> : null}
      <div className="desktop-dual-grid desktop-dual-grid-wide">
        <section className="desktop-form-card">
          <header className="desktop-subsection-header">
            <div>
              <h3>输入与范围</h3>
              <p>支持多个会话 ID，先预览后执行。</p>
            </div>
          </header>

          <div className="desktop-form-grid">
            <label className="desktop-field">
              <span>会话 ID 列表</span>
              <textarea
                rows={6}
                placeholder={"示例：\n019cbe6b-6140-7a62-9ce7-ed24424e4864\n019cbe6b-6140-7a62-9ce7-ed24424e4865"}
                value={props.threadCleanupInput}
                onChange={(event) => props.onChange("threadCleanupInput", event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canPreview) {
                    event.preventDefault();
                    props.onPreview();
                  }
                }}
              />
            </label>

            <div className="desktop-dual-grid">
              <label className="desktop-field">
                <span>清理范围</span>
                <select
                  value={props.threadCleanupScope}
                  onChange={(event) => props.onChange("threadCleanupScope", event.target.value as ThreadCleanupScope)}
                >
                  <option value="all">全部账号</option>
                  <option value="active">当前账号</option>
                  <option value="single">指定单个账号</option>
                </select>
              </label>

              {props.threadCleanupScope === "single" ? (
                <label className="desktop-field">
                  <span>指定账号</span>
                  <select
                    value={props.threadCleanupProfileId}
                    onChange={(event) => props.onChange("threadCleanupProfileId", event.target.value)}
                  >
                    <option value="">请选择账号</option>
                    {props.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name} ({profile.id})
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="desktop-info-card desktop-inline-note">
                  <h4>范围说明</h4>
                  <p>{props.threadCleanupScope === "all" ? "会在所有账号里查找目标会话。" : "只在当前活动账号里查找目标会话。"}</p>
                </div>
              )}
            </div>

            <label className="desktop-toggle desktop-toggle-card">
              <span>删除前备份（默认关闭）</span>
              <input
                type="checkbox"
                checked={props.threadCleanupBackupEnabled}
                onChange={(event) => props.onChange("threadCleanupBackupEnabled", event.target.checked)}
              />
            </label>
          </div>

          <div className="desktop-inline-actions">
            <button className="primary" onClick={props.onPreview} disabled={!canPreview}>查找匹配</button>
            <button onClick={() => props.onStart("restartLater")} disabled={!canExecute}>确认删除（下次重启生效）</button>
            <button className="danger" onClick={() => props.onStart("killNow")} disabled={!canExecute}>确认删除并结束相关进程</button>
          </div>

          {!canPreview ? <p className="warning">请先输入至少一个会话 ID；若范围为指定账号，还需要先选择账号。</p> : null}
        </section>

        <section className="desktop-form-card">
          <header className="desktop-subsection-header">
            <div>
              <h3>预览摘要</h3>
              <p>先看命中范围，再决定是否立即结束占用进程。</p>
            </div>
          </header>

          {!props.preview ? (
            <div className="desktop-empty-state compact">
              <h3>还没有预览结果</h3>
              <p>输入会话 ID 后点击“查找匹配”，这里会显示命中账号、线程和文件。</p>
            </div>
          ) : (
            <>
              <div className="desktop-mini-stat-grid">
                <div className="desktop-mini-stat"><span>命中账号</span><strong>{summary.profiles}</strong></div>
                <div className="desktop-mini-stat"><span>命中线程</span><strong>{summary.threads}</strong></div>
                <div className="desktop-mini-stat"><span>命中文件</span><strong>{summary.files}</strong></div>
                <div className="desktop-mini-stat"><span>未命中会话</span><strong>{props.preview.notFoundThreadIds.length}</strong></div>
              </div>

              {props.preview.notFoundThreadIds.length > 0 ? (
                <p className="warning">未命中会话 ID：{props.preview.notFoundThreadIds.join("、")}</p>
              ) : null}

              <div className="desktop-card-list">
                {props.preview.profiles.map((profile) => (
                  <article key={profile.profileId} className="desktop-summary-card">
                    <div className="desktop-summary-card-header">
                      <strong>{profile.profileName}</strong>
                      <span>{profile.profileId}</span>
                    </div>
                    <p>命中线程 {profile.matches.length} · 命中文件 {profile.matchedFileCount}</p>
                    {profile.potentialBusyProcesses.length > 0 ? (
                      <p className="warning">可能占用进程：{profile.potentialBusyProcesses.map((item) => `${item.command} (${item.pid})`).join("、")}</p>
                    ) : null}
                    {profile.matches.length > 0 ? (
                      <ul className="desktop-compact-list">
                        {profile.matches.map((match) => (
                          <li key={`${profile.profileId}-${match.id}`}>
                            <code>{match.id}</code>
                            {match.title ? ` · ${match.title}` : ""}
                            {match.archived ? " · archived" : ""}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>当前账号没有命中项。</p>
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      <section className="desktop-info-card desktop-result-surface">
        <h4>最近执行结果</h4>
        {!props.result ? (
          <p>还没有执行过删除。</p>
        ) : (
          <>
            <p className="desktop-result-headline">
              应用方式 {props.result.applyMode} · 触发 kill {props.result.killTriggered ? "是" : "否"} · 结束数量 {props.result.killedCount}
            </p>
            {props.result.backupPath ? <p>备份路径：{props.result.backupPath}</p> : null}
            {props.result.relaunchedClients.length > 0 ? <p>恢复启动：{props.result.relaunchedClients.join("、")}</p> : null}
            {props.result.scheduledProfiles.length > 0 ? <p className="warning">待重启继续执行：{props.result.scheduledProfiles.join("、")}</p> : null}

            <div className="desktop-card-list">
              {props.result.profiles.map((profile) => (
                <article key={profile.profileId} className="desktop-summary-card">
                  <div className="desktop-summary-card-header">
                    <strong>{profile.profileName}</strong>
                    <span>{profile.profileId}</span>
                  </div>
                  <p>
                    删除: threads {profile.deleted.threads} / logs {profile.deleted.logs} / tools {profile.deleted.dynamicTools} / files {profile.deleted.files}
                  </p>
                  <p>
                    校验残留: DB {profile.verification.dbResidual} / 文件 {profile.verification.fileResidual} / 状态 {profile.verification.globalStateResidual}
                  </p>
                  {!profile.verification.clean ? <p className="warning">该账号仍存在未清理干净的项。</p> : null}
                  {profile.busyProcesses.length > 0 ? (
                    <p className="warning">相关进程：{profile.busyProcesses.map((item) => `${item.command} (${item.pid})`).join("、")}</p>
                  ) : null}
                  {profile.warnings.length > 0 ? profile.warnings.map((warning) => <p key={warning} className="warning">{warning}</p>) : null}
                  {profile.errors.length > 0 ? profile.errors.map((error) => <p key={error} className="warning">{error}</p>) : null}
                </article>
              ))}
            </div>
            <p className="desktop-result-footnote">结果刷新时间：{formatTime(new Date().toISOString())}</p>
          </>
        )}
      </section>
    </div>
  );
}
