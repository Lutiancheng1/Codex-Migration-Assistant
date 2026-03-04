import React from "react";
import { createPortal } from "react-dom";

export type BusyProcess = {
    pid: number;
    command: string;
};

type Props = {
    isOpen: boolean;
    busy?: BusyProcess[];
    onConfirmKill: () => void;
    onCancel: () => void;
};

export function ProcessLockDialog(props: Props): JSX.Element | null {
    if (!props.isOpen) {
        return null;
    }

    const hasPids = props.busy && props.busy.length > 0;

    return createPortal(
        <div className="modal-overlay">
            <div className="modal-content">
                <h2 className="modal-title warning-text">迁移被阻挠：目录陷入死锁 (EPERM)</h2>
                <p>我们检测到您的底层 <code>.codex</code> 文件夹正被其他应用读取。由于系统锁机制，扩展被拒绝执行目录迁移和初始化操作。</p>

                {hasPids ? (
                    <div className="busy-process-list">
                        {props.busy!.map((item) => (
                            <div key={item.pid} className="busy-process-item">
                                <span className="process-name">{item.command}</span>
                                <span className="process-pid">(PID: {item.pid})</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="busy-process-list" style={{ justifyContent: 'center', alignItems: 'center', color: 'var(--vscode-descriptionForeground)' }}>
                        未在系统中精准抓取到占用该目录的相关进程 PID。
                    </div>
                )}

                <p className="modal-tip">
                    请您暂时手动关闭原始的 Codex 扩展或者 macOS/Windows 上的 Codex 桌面级独立 App 再重试。
                    {hasPids && <><br />或者授权我们<b>强制干掉上面检测到的这几个相关进程</b>并立即继续挂起的迁移任务。</>}
                </p>

                <div className="modal-actions">
                    {hasPids ? (
                        <>
                            <button onClick={props.onCancel} className="secondary">取消，我自己去关</button>
                            <button onClick={props.onConfirmKill} className="danger">强制结束它们并继续</button>
                        </>
                    ) : (
                        <button onClick={props.onCancel} className="secondary">我知道了</button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}
