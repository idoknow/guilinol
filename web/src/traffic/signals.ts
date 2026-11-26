// IDOK-399 — single source of truth for intersection signals.
//
// Every consumer (street traffic sim, duty-zone sim, signal-head visuals, gameplay rules,
// verify probes) resolves a light from the same two things:
//   1. a compiled `SignalPlan` built from `graph.signals` (fixed-time phases per node), and
//   2. the one `citySignalClock`, in seconds.
// Nothing else may keep its own cycle arithmetic or its own signal timer.
//
// The module is pure TypeScript with no three.js or DOM dependency, so node tests import it directly.

export type SignalColor = 'green' | 'yellow' | 'red'
export type SignalPhaseSpec = {lanes: number[], green: number, yellow: number}
export type SignalSpec = {node: number, group: number, offset: number, phases: SignalPhaseSpec[]}

/** Which phase a signal node is serving, and for how long. */
export type SignalState = {
  /** Index into `spec.phases` of the phase that currently has right of way. */
  phase: number
  /** Colour shown to the lanes of that phase; every other lane at the node is red. */
  color: 'green' | 'yellow'
  /** Seconds until `color` changes. */
  remaining: number
  /** Full cycle length in seconds. */
  cycle: number
}

type Compiled = {
  spec: SignalSpec
  cycle: number
  /** Cumulative phase end times within one cycle, seconds. */
  ends: number[]
  /** laneId -> bitmask of phase indexes that serve it. */
  lanes: Map<number, number>
}

function compile(spec: SignalSpec): Compiled {
  const ends: number[] = []
  const lanes = new Map<number, number>()
  let cycle = 0
  spec.phases.forEach((phase, index) => {
    cycle += phase.green + phase.yellow
    ends.push(cycle)
    for (const lane of phase.lanes) lanes.set(lane, (lanes.get(lane) ?? 0) | (1 << index))
  })
  return {spec, cycle, ends, lanes}
}

/** Fixed-time signal programme for a set of nodes. Lookups allocate nothing. */
export class SignalPlan {
  private readonly nodes = new Map<number, Compiled>()
  private readonly scratch: SignalState = {phase: 0, color: 'green', remaining: 0, cycle: 0}

  constructor(specs?: Iterable<SignalSpec>) {
    if (specs) this.add(specs)
  }

  /** Registers signals; a node already present keeps its first programme. Returns how many were new. */
  add(specs: Iterable<SignalSpec>): number {
    let added = 0
    for (const spec of specs) {
      if (this.nodes.has(spec.node) || !spec.phases.length) continue
      const compiled = compile(spec)
      if (!(compiled.cycle > 0)) continue
      this.nodes.set(spec.node, compiled)
      added++
    }
    return added
  }

  get size(): number {
    return this.nodes.size
  }

  has(node: number): boolean {
    return this.nodes.has(node)
  }

  spec(node: number): SignalSpec | undefined {
    return this.nodes.get(node)?.spec
  }

  nodeIds(): IterableIterator<number> {
    return this.nodes.keys()
  }

  /**
   * Active phase at `time`. Returns a shared scratch object unless `out` is given:
   * read it before the next call, or pass your own `out` to keep it.
   */
  state(node: number, time: number, out: SignalState = this.scratch): SignalState | null {
    const compiled = this.nodes.get(node)
    if (!compiled) return null
    const {spec, cycle, ends} = compiled
    // Not `((t % c) + c) % c`: adding `c` rounds away the last ulp just before a boundary.
    let local = (time + spec.offset) % cycle
    if (local < 0) local += cycle
    let index = 0
    while (index < ends.length - 1 && local >= ends[index]) index++
    const phase = spec.phases[index]
    const into = local - (index ? ends[index - 1] : 0)
    out.phase = index
    out.cycle = cycle
    if (into < phase.green) {
      out.color = 'green'
      out.remaining = phase.green - into
    } else {
      out.color = 'yellow'
      out.remaining = phase.green + phase.yellow - into
    }
    return out
  }

  /** Colour a lane arriving at `node` sees at `time`; `null` when the node has no signal. */
  color(node: number, lane: number, time: number): SignalColor | null {
    const compiled = this.nodes.get(node)
    if (!compiled) return null
    const state = this.state(node, time)!
    return (compiled.lanes.get(lane) ?? 0) & (1 << state.phase) ? state.color : 'red'
  }
}

/**
 * The one signal clock, in seconds.
 *
 * Several systems tick at their own pace (street sim, duty-zone sim, signal visuals when no sim
 * is loaded). Each takes a `SignalDriver` with a rank and offers its frame `dt` once per frame;
 * the clock accepts time only from the highest-ranked driver that is still ticking, so it never
 * runs fast and never stops while anything is on screen. Arbitration is by call order alone
 * (no wall clock), so tests and headless fast-forward stay deterministic.
 */
export class SignalClock {
  /** Seconds. Signal offsets from the world data are added on top of this. */
  now = 0
  /** Bumped on every accepted advance. */
  revision = 0
  /** Rank of the driver that last moved the clock. */
  lastRank = Infinity

  driver(rank: number): SignalDriver {
    return new SignalDriver(this, rank)
  }

  reset(now = 0): void {
    this.now = now
    this.revision = 0
    this.lastRank = Infinity
  }
}

/** Lower rank wins. A driver yields on any frame where a better-ranked driver moved the clock. */
export const SIGNAL_DRIVER_RANK = {street: 0, duty: 1, visual: 2} as const

export class SignalDriver {
  readonly rank: number
  private readonly clock: SignalClock
  private seen: number

  constructor(clock: SignalClock, rank: number) {
    this.clock = clock
    this.rank = rank
    this.seen = clock.revision
  }

  /**
   * Offers `dt` seconds; call once per frame. Returns whether the clock moved. It does not when a
   * better-ranked driver advanced the clock since this driver's previous call.
   */
  advance(dt: number): boolean {
    const {clock} = this
    const yielded = clock.revision !== this.seen && clock.lastRank < this.rank
    if (!yielded && dt > 0 && Number.isFinite(dt)) {
      clock.now += dt
      clock.revision++
      clock.lastRank = this.rank
    }
    this.seen = clock.revision
    return !yielded
  }
}

export const citySignalClock = new SignalClock()

/** Every signal seen in loaded road cells. Visuals and gameplay read lights from here. */
export const citySignals = new SignalPlan()

/** Colour for a lane at a signalised node right now; `null` when the node is not loaded. */
export function citySignalColor(node: number, lane: number): SignalColor | null {
  return citySignals.color(node, lane, citySignalClock.now)
}

/** Active phase at a signalised node right now; `null` when the node is not loaded. */
export function citySignalState(node: number, out?: SignalState): SignalState | null {
  return citySignals.state(node, citySignalClock.now, out)
}
