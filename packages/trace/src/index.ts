import type { TrajectoryEvent } from "@canary/core";
export class TraceBuffer {
  readonly events: TrajectoryEvent[] = [];
  emit(event: TrajectoryEvent): void { this.events.push(event); }
}
