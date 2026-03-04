import type { PropsWithChildren } from "react";

export function SummaryCard(props: PropsWithChildren<{ title: string }>): JSX.Element {
  return (
    <section className="card">
      <h3>{props.title}</h3>
      <div>{props.children}</div>
    </section>
  );
}
