type Props = {
  label: string;
  tip: string;
};

export function InfoHint(props: Props): JSX.Element {
  return (
    <span className="info-hint" role="img" aria-label={props.label} tabIndex={0}>
      <span className="info-hint-icon">i</span>
      <span className="info-hint-tip">{props.tip}</span>
    </span>
  );
}
