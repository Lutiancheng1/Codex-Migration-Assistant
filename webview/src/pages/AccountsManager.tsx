import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ProfileSummary, ProfileUsageWindow } from "../api/types";

type Props = {
  profilesRoot: string;
  profiles: ProfileSummary[];
  activeProfileId?: string;
  backupBeforeSwitch: boolean;
  newProfileName: string;
  onChange(field: string, value: string | boolean): void;
  onRefresh(): void;
  onRefreshUsage(profileId?: string): void;
  onCreate(): void;
  onActivate(profileId: string): void;
  onActivateAndMerge(profileId: string): void;
  onDelete(profileId: string): void;
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

export function AccountsManager(props: Props): JSX.Element {
  const activeProfile = props.profiles.find((item) => item.id === props.activeProfileId);
  const canCreate = props.newProfileName.trim().length > 0;
  const [pendingDeleteProfileId, setPendingDeleteProfileId] = useState<string>();
  const [openActionProfileId, setOpenActionProfileId] = useState<string>();
  const [actionAnchorRect, setActionAnchorRect] = useState<DOMRect | undefined>();
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(5 * 60 * 1000);
  const initialRefreshDone = React.useRef(false);

  // 初次加载有 profile 时，自动查一遍所有人
  useEffect(() => {
    if (props.profiles.length > 0 && !initialRefreshDone.current) {
      initialRefreshDone.current = true;
      props.profiles.forEach((p) => {
        props.onRefreshUsage(p.id);
      });
    }
  }, [props.profiles, props.onRefreshUsage]);

  // 定时轮询
  useEffect(() => {
    if (autoRefreshInterval <= 0) {
      return;
    }
    const timer = setInterval(() => {
      props.profiles.forEach((p) => {
        props.onRefreshUsage(p.id);
      });
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

    // 监听滚动与缩放，关闭弹窗防止错位
    const handleScrollOrResize = () => {
      setOpenActionProfileId(undefined);
      setPendingDeleteProfileId(undefined);
      setActionAnchorRect(undefined);
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("scroll", handleScrollOrResize, true); // 捕获阶段，能拦截内部表格容器滚动
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [openActionProfileId]);

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

      <div style={{ marginBottom: "12px" }}>
        <label className="check-row">
          <span className="check-text">切换前自动备份当前账号（不含 auth）</span>
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
        <select
          value={autoRefreshInterval}
          onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
          style={{ width: "auto" }}
        >
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
                          if (openActionProfileId === profile.id) {
                            setOpenActionProfileId(undefined);
                            setActionAnchorRect(undefined);
                          } else {
                            setOpenActionProfileId(profile.id);
                            setActionAnchorRect(e.currentTarget.getBoundingClientRect());
                          }
                        }}
                      >
                        ⋯
                      </button>
                      {isActionOpen && actionAnchorRect ? createPortal(
                        <div
                          className="action-menu-panel"
                          data-action-menu-id={profile.id}
                          style={{
                            position: "fixed",
                            top: actionAnchorRect.top + 180 > window.innerHeight
                              ? "auto"
                              : `${actionAnchorRect.top}px`,
                            bottom: actionAnchorRect.top + 180 > window.innerHeight
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
                              props.onActivate(profile.id);
                              setOpenActionProfileId(undefined);
                            }}
                            disabled={isActive || !profile.exists}
                          >
                            {isActive ? "当前" : "切换"}
                          </button>
                          <button
                            onClick={() => {
                              props.onActivateAndMerge(profile.id);
                              setOpenActionProfileId(undefined);
                            }}
                            disabled={isActive || !profile.exists}
                          >
                            切换并合并
                          </button>
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
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {props.profiles.some((item) => item.usageError) ? (
        <div className="warning">
          最近一次用量刷新存在失败项：{props.profiles.filter((item) => item.usageError).map((item) => `${item.name}: ${item.usageError}`).join("；")}
        </div>
      ) : null}
    </section>
  );
}
