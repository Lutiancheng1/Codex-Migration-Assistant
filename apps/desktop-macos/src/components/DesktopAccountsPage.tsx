import { useEffect, useMemo, useState } from "react";
import type { ProfileSummary } from "@codex-migration/shared-contracts";
import { formatRemainingPercent, formatTime, summarizeUsageErrors, useStableSelection } from "./desktopUi";

type Props = {
  codexHome: string;
  profilesRoot: string;
  profiles: ProfileSummary[];
  activeProfileId?: string;
  backupBeforeSwitch: boolean;
  newProfileName: string;
  onChange(field: string, value: string | boolean): void;
  onRefresh(): void;
  onRefreshUsage(profileId?: string): void;
  onCreate(): void;
  onExportProfile(profileId: string): void;
  onImportProfileToTokenPool(profileId: string): void;
  onActivate(profileId: string): void;
  onActivateAndMerge(profileId: string): void;
  onActivateAndOverwrite(profileId: string): void;
  onDelete(profileId: string): void;
  onMoveProfile(profileId: string, direction: "up" | "down"): void;
};

function profileStateLabel(profile: ProfileSummary): string {
  if (profile.usageError) {
    return "刷新失败";
  }
  if (!profile.hasAuth) {
    return "缺少登录态";
  }
  if (!profile.hasState) {
    return "缺少 State";
  }
  return "就绪";
}

export function DesktopAccountsPage(props: Props): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | undefined>(props.activeProfileId ?? props.profiles[0]?.id);
  const selectedProfile = useStableSelection(props.profiles, selectedId ?? props.activeProfileId);
  const usageErrorSummary = useMemo(
    () => summarizeUsageErrors(props.profiles.map((profile) => ({ name: profile.name, usageError: profile.usageError }))),
    [props.profiles]
  );

  useEffect(() => {
    if (!selectedProfile) {
      setSelectedId(undefined);
      return;
    }
    setSelectedId(selectedProfile.id);
  }, [selectedProfile]);

  function selectRelative(direction: "up" | "down"): void {
    if (props.profiles.length === 0) {
      return;
    }
    const currentIndex = props.profiles.findIndex((profile) => profile.id === (selectedProfile?.id ?? selectedId));
    const safeIndex = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex = direction === "up" ? Math.max(0, safeIndex - 1) : Math.min(props.profiles.length - 1, safeIndex + 1);
    setSelectedId(props.profiles[nextIndex]?.id);
  }

  return (
    <div className="desktop-panel-stack">
      <section className="desktop-inline-panel">
        <div className="desktop-inline-panel-main">
          <label className="desktop-field">
            <span>新增账号槽位</span>
            <input
              value={props.newProfileName}
              placeholder="例如：工作账号 / 个人账号"
              onChange={(event) => props.onChange("newProfileName", event.target.value)}
            />
          </label>
          <div className="desktop-inline-actions">
            <button className="primary" onClick={props.onCreate} disabled={props.newProfileName.trim().length === 0}>新增账号</button>
            <button onClick={props.onRefresh}>刷新列表</button>
            <button onClick={() => props.onRefreshUsage()}>刷新全部用量</button>
          </div>
        </div>
        <label className="desktop-toggle">
          <span>切换前自动备份当前账号</span>
          <input
            type="checkbox"
            checked={props.backupBeforeSwitch}
            onChange={(event) => props.onChange("backupBeforeSwitch", event.target.checked)}
          />
        </label>
      </section>

      <section className="desktop-master-detail">
        <aside className="desktop-master-list">
          <header className="desktop-subsection-header">
            <div>
              <h3>账号槽位</h3>
              <p>{props.profiles.length} 个槽位 · 当前 Codex 目录 {props.codexHome || "-"}</p>
            </div>
          </header>

          <div className="desktop-list-stack">
            {props.profiles.map((profile, index) => {
              const isActive = profile.id === props.activeProfileId;
              const isSelected = profile.id === selectedProfile?.id;
              return (
                <div
                  key={profile.id}
                  className={`desktop-list-item ${isSelected ? "selected" : ""} ${isActive ? "current" : ""}`.trim()}
                  onClick={() => setSelectedId(profile.id)}
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
                      setSelectedId(profile.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="desktop-list-item-copy">
                    <div className="desktop-list-item-title-row">
                      <strong>{profile.name}</strong>
                      {isActive ? <span className="desktop-badge desktop-badge-good">当前</span> : null}
                    </div>
                    <span className="desktop-list-item-meta">{profile.id}</span>
                    <span className="desktop-list-item-meta">
                      5h {formatRemainingPercent(profile.usage?.fiveHour)} · 7d {formatRemainingPercent(profile.usage?.oneWeek)}
                    </span>
                  </div>
                  <div className="desktop-list-item-side">
                    <span className={`desktop-badge ${profile.usageError ? "desktop-badge-danger" : "desktop-badge-neutral"}`}>
                      {profileStateLabel(profile)}
                    </span>
                    <div className="desktop-mini-actions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onMoveProfile(profile.id, "up");
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
                          props.onMoveProfile(profile.id, "down");
                        }}
                        disabled={index === props.profiles.length - 1}
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
          {selectedProfile ? (
            <>
              <header className="desktop-subsection-header">
                <div>
                  <h3>{selectedProfile.name}</h3>
                  <p>{selectedProfile.id}</p>
                </div>
                <div className="desktop-inline-actions">
                  <button onClick={() => props.onRefreshUsage(selectedProfile.id)}>刷新用量</button>
                  <button onClick={() => props.onExportProfile(selectedProfile.id)}>单独导出</button>
                  <button onClick={() => props.onImportProfileToTokenPool(selectedProfile.id)} disabled={!selectedProfile.hasAuth}>
                    导入到账号池
                  </button>
                </div>
              </header>

              <div className="desktop-detail-grid">
                <div className="desktop-info-card">
                  <h4>状态</h4>
                  <dl>
                    <div><dt>登录态</dt><dd>{selectedProfile.hasAuth ? "已检测" : "未检测"}</dd></div>
                    <div><dt>State</dt><dd>{selectedProfile.hasState ? "已检测" : "未检测"}</dd></div>
                    <div><dt>套餐</dt><dd>{selectedProfile.usage?.planType || "-"}</dd></div>
                    <div><dt>5小时剩余</dt><dd>{formatRemainingPercent(selectedProfile.usage?.fiveHour)}</dd></div>
                    <div><dt>7天剩余</dt><dd>{formatRemainingPercent(selectedProfile.usage?.oneWeek)}</dd></div>
                    <div><dt>用量刷新</dt><dd>{selectedProfile.usage ? formatTime(selectedProfile.usage.fetchedAt) : "-"}</dd></div>
                    <div><dt>最后激活</dt><dd>{formatTime(selectedProfile.lastActivatedAt)}</dd></div>
                    <div><dt>目录</dt><dd>{selectedProfile.path}</dd></div>
                    <div><dt>Profiles 根目录</dt><dd>{props.profilesRoot}</dd></div>
                  </dl>
                </div>

                <div className="desktop-info-card">
                  <h4>切换与维护</h4>
                  <div className="desktop-detail-actions">
                    <button className="primary" onClick={() => props.onActivate(selectedProfile.id)} disabled={selectedProfile.id === props.activeProfileId || !selectedProfile.exists}>
                      切换到该账号
                    </button>
                    <button onClick={() => props.onActivateAndMerge(selectedProfile.id)} disabled={selectedProfile.id === props.activeProfileId || !selectedProfile.exists}>
                      切换并合并
                    </button>
                    <button onClick={() => props.onActivateAndOverwrite(selectedProfile.id)} disabled={selectedProfile.id === props.activeProfileId || !selectedProfile.exists}>
                      切换并覆盖
                    </button>
                    <button className="danger" onClick={() => props.onDelete(selectedProfile.id)} disabled={selectedProfile.id === props.activeProfileId}>
                      删除该账号
                    </button>
                  </div>

                  {selectedProfile.usageError ? <p className="warning">最近一次用量刷新失败：{selectedProfile.usageError}</p> : null}
                  {!selectedProfile.hasAuth ? <p className="warning">该账号当前没有检测到 auth 登录态，切换后需要重新登录。</p> : null}
                </div>
              </div>
            </>
          ) : (
            <div className="desktop-empty-state">
              <h3>还没有账号槽位</h3>
              <p>先创建一个账号槽位，或者从当前环境刷新现有槽位列表。</p>
            </div>
          )}
        </section>
      </section>

      {usageErrorSummary ? <div className="warning">最近一次账号列表用量刷新存在失败项：{usageErrorSummary}</div> : null}
    </div>
  );
}
