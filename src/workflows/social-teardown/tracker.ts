// The teardown's calls go through the harness's Session (one budget, max_pages on every
// walk, every response in responses.jsonl). The Tracker adds what each call was for (the
// post, the launch, the month) so the analysis can join a reply page to its post, and it
// keeps the lines that say where a stage stopped for its share of the budget.
import { rateOf } from "../../engine/rates.ts";
import type { Params } from "../../kit/kit.ts";
import type { CallRecord, Session } from "../../kit/record.ts";

export type Tags = Record<string, string>;

/** A Session record with the tags of the call that made it. */
export interface TaggedRecord extends CallRecord {
  meta: Tags;
}

export interface PlannedCall {
  endpoint: string;
  params: Params;
  meta?: Tags;
}

export interface Limit {
  stage: string;
  endpoint: string;
  reason: string;
}

export class Tracker {
  readonly session: Session;
  readonly records: TaggedRecord[] = [];
  readonly limits: Limit[] = [];

  constructor(session: Session) {
    this.session = session;
  }

  get spent(): number {
    return this.records.reduce((s, r) => s + (r.creditsUsed || 0), 0);
  }

  get left(): number {
    return this.session.budget.left;
  }

  /**
   * One call through the Session. Returns the tagged record on success and null otherwise;
   * an error answer is still kept, tagged, so the report can say what failed and why.
   */
  async call(stage: string, endpoint: string, params: Params, meta: Tags = {}, stageMax = Infinity): Promise<TaggedRecord | null> {
    const before = this.session.records.length;
    const rec = await this.session.call(stage, endpoint, params, stageMax);
    const made = this.session.records.slice(before);
    for (const r of made) this.records.push({ ...r, meta });
    return rec ? (this.records[this.records.length - 1] ?? null) : null;
  }

  /**
   * A stage's calls inside its share: each call may spend an even part of what is left of
   * the share (never less than one page), and the stage stops, saying why, once nothing fits.
   */
  async withinShare(stage: string, share: number, calls: PlannedCall[]): Promise<TaggedRecord[]> {
    let left = share;
    const out: TaggedRecord[] = [];
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i];
      const even = Math.floor(left / (calls.length - i));
      // An even part of what is left, but never less than one page when the share still pays for one.
      const r = rateOf(c.endpoint);
      const onePage = r.walks ? Math.max(r.page, r.minMaxCredits ?? 0) : r.page;
      const cap = Math.max(even, Math.min(left, onePage));
      const refusedBefore = this.session.notRead.length;
      const rec = cap > 0 ? await this.call(stage, c.endpoint, c.params, c.meta, cap) : null;
      if (cap <= 0 || this.session.notRead.length > refusedBefore) {
        const why = this.left < 1 ? "the run's budget is spent" : `the stage's share of ${share} credits is spent`;
        this.limits.push({ stage, endpoint: c.endpoint, reason: `${calls.length - i} of ${calls.length} calls not made: ${why}` });
        return out;
      }
      if (rec) {
        out.push(rec);
        left -= rec.creditsUsed;
      }
    }
    return out;
  }
}
