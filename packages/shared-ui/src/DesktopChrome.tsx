import type { ReactNode } from "react";
import type { DesktopTab } from "@codex-migration/shared-contracts";

const TAB_LABELS: Record<DesktopTab, string> = {
  overview: "总览",
  accounts: "账号",
  tokenPool: "账号池",
  migration: "迁移",
  cleanup: "对话清理",
  settings: "设置"
};

export function DesktopChrome(props: {
  title: string;
  subtitle: string;
  activeTab: DesktopTab;
  onSelectTab(tab: DesktopTab): void;
  children: ReactNode;
  status?: ReactNode;
}): JSX.Element {
  return (
    <div className="desktop-shell">
      <header className="desktop-toolbar">
        <div className="desktop-toolbar-copy">
          <h1>{props.title}</h1>
          <p>{props.subtitle}</p>
        </div>
        <div className="desktop-toolbar-status">{props.status}</div>
      </header>

      <nav className="desktop-tabs" aria-label="主导航">
        {(Object.keys(TAB_LABELS) as DesktopTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            className={`desktop-tab ${props.activeTab === tab ? "active" : ""}`}
            onClick={() => props.onSelectTab(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </nav>

      <section className="desktop-content">{props.children}</section>
    </div>
  );
}
