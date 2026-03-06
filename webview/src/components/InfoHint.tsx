import { useCallback, useState } from "react";

type Props = {
  label: string;
  tip: string;
};

export function InfoHint(props: Props): JSX.Element {
  const [side, setSide] = useState<"left" | "right">("left");

  const updateSide = useCallback((element: HTMLSpanElement | null) => {
    if (!element) {
      return;
    }
    const rect = element.getBoundingClientRect();
    const estimatedWidth = Math.min(360, window.innerWidth - 56);
    const leftSpace = rect.left;
    const rightSpace = window.innerWidth - rect.right;
    setSide(leftSpace >= estimatedWidth || leftSpace >= rightSpace ? "left" : "right");
  }, []);

  return (
    <span
      className="info-hint"
      data-side={side}
      role="img"
      aria-label={props.label}
      tabIndex={0}
      ref={updateSide}
      onMouseEnter={(e) => updateSide(e.currentTarget)}
      onFocus={(e) => updateSide(e.currentTarget)}
    >
      <span className="info-hint-icon">i</span>
      <span className="info-hint-tip">{props.tip}</span>
    </span>
  );
}
