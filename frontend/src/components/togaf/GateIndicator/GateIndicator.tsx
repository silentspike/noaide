// ============================================================
// GateIndicator — Gate status badge (template design)
// ============================================================

import { type Component, createMemo } from "solid-js";
import type { GateStatus } from "../types/plan";

interface Props {
  gateNumber: number;
  status: GateStatus;
}

const GATE_CLASS: Record<GateStatus, string> = {
  pass: "gate-badge",
  pending: "gate-badge pending",
  fail: "gate-badge fail",
};

const GATE_LABELS: Record<GateStatus, string> = {
  pass: "bestanden",
  pending: "ausstehend",
  fail: "nicht bestanden",
};

const GATE_ICONS: Record<GateStatus, string> = {
  pass: "\u2713",
  pending: "\u2026",
  fail: "\u2717",
};

const GateIndicator: Component<Props> = (props) => {
  const cls = createMemo(() => GATE_CLASS[props.status]);

  return (
    <span class={cls()}>
      GATE {props.gateNumber} {GATE_LABELS[props.status]} {GATE_ICONS[props.status]}
    </span>
  );
};

export { GateIndicator };
export default GateIndicator;
