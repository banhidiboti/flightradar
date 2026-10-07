/**
 * Edge-triggered zone membership tracking. Keeps a Map of ICAO24 -> last
 * known plane data for aircraft currently inside the configured zone, so
 * the caller can tell "just entered" apart from "still here" and avoid
 * sending a notification on every poll cycle.
 */
export class ZoneTracker {
  constructor() {
    this.active = new Map();
  }

  /**
   * @param {Array<{icao24: string} & Record<string, unknown>>} planesInZone
   * @returns {{ entered: object[], left: object[], current: object[] }}
   */
  update(planesInZone) {
    const nowIds = new Set(planesInZone.map((p) => p.icao24));
    const entered = [];
    const left = [];

    for (const plane of planesInZone) {
      const existing = this.active.get(plane.icao24);
      if (!existing) {
        const record = { ...plane, enteredAt: Date.now() };
        this.active.set(plane.icao24, record);
        entered.push(record);
      } else {
        this.active.set(plane.icao24, { ...existing, ...plane });
      }
    }

    for (const [icao24, record] of Array.from(this.active.entries())) {
      if (!nowIds.has(icao24)) {
        this.active.delete(icao24);
        left.push(record);
      }
    }

    return { entered, left, current: Array.from(this.active.values()) };
  }

  clear() {
    this.active.clear();
  }
}
