// The Session every workflow calls through. Each call is sent under the run's one budget
// (a walk always carries max_pages and max_credits), its response is appended to
// responses.jsonl with its request id, and its credits are booked in the ledger, so every
// claim in a report can point at the response behind it.
//
// call() returns the record on success. It returns null when the budget cannot pay for the
// call (kept in notRead) or when the API answers an error (kept in errors, body included).
// Out of credits is rethrown: the harness shows the offer and never retries.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { Budget, BudgetSpent, CostLedger, metaBlock, postCost } from "../engine/rates.ts";
import type { Meta } from "../engine/rates.ts";
import { ApiError, OutOfCredits } from "./kit.ts";
import type { ApiBody, Params } from "./kit.ts";

export interface CallRecord {
  seq: number;
  stage: string;
  endpoint: string;
  params: Params;
  /** The body of a POST batch. */
  json?: unknown;
  status: number;
  requestId: string | null;
  /** The request ids of the pages a walk read, when the API lists them. */
  walkRequestIds: string[];
  creditsUsed: number;
  at: string;
  body: ApiBody;
}

/** The slice of the kit a Session needs (createKit's return fits). */
export interface Caller {
  call(path: string, params?: Params): Promise<ApiBody>;
  post?(path: string, json: unknown, params?: Params): Promise<ApiBody>;
}

export interface SessionOptions {
  dir: string;
  kit: Caller;
  budget: Budget;
  skill: string;
  version: string;
  /** One line each time a stage ends: "search: 6 calls, 14 credits". */
  progress?: (line: string) => void;
  now?: () => Date;
}

export const RESPONSES_FILE = "responses.jsonl";

/** The group a stage's progress line is printed under: "search:x" is "search". */
const stageGroup = (stage: string) => stage.split(":")[0];

export class Session {
  readonly dir: string;
  readonly budget: Budget;
  readonly ledger = new CostLedger();
  readonly records: CallRecord[] = [];
  readonly notRead: { stage: string; endpoint: string; reason: string; /** Which limit stopped it: the run's budget, or the stage's own share. */ limit?: "run" | "stage" }[] = [];
  readonly errors: { stage: string; endpoint: string; status: number | null; message: string; requestId: string | null; body: unknown }[] = [];
  readonly startedAt: Date;
  private readonly kit: Caller;
  private readonly skill: string;
  private readonly version: string;
  private readonly progress: (line: string) => void;
  private readonly now: () => Date;
  private group: { name: string; calls: number; credits: number } | null = null;

  constructor(o: SessionOptions) {
    this.dir = o.dir;
    this.kit = o.kit;
    this.budget = o.budget;
    this.skill = o.skill;
    this.version = o.version;
    this.progress = o.progress ?? (() => {});
    this.now = o.now ?? (() => new Date());
    this.startedAt = this.now();
    mkdirSync(o.dir, { recursive: true });
  }

  async call(stage: string, endpoint: string, paramsIn: Params, stageMax = Infinity): Promise<CallRecord | null> {
    let params: Params;
    try {
      params = this.budget.allow(endpoint, paramsIn, stageMax) as Params;
    } catch (e) {
      if (e instanceof BudgetSpent) {
        this.notRead.push({ stage, endpoint, reason: "budget", limit: stageMax < this.budget.left ? "stage" : "run" });
        return null;
      }
      throw e;
    }
    return this.send(stage, endpoint, params, undefined, () => this.kit.call(endpoint, params));
  }

  /** A POST batch (youtube/videos, youtube/channels, youtube/transcripts), priced by its ids. */
  async post(stage: string, endpoint: string, json: unknown, stageMax = Infinity): Promise<CallRecord | null> {
    const cost = postCost(endpoint, json);
    if (cost > Math.min(stageMax, this.budget.left)) {
      this.notRead.push({ stage, endpoint, reason: "budget", limit: stageMax < this.budget.left ? "stage" : "run" });
      return null;
    }
    const post = this.kit.post;
    if (!post) throw new Error("This kit cannot POST.");
    return this.send(stage, endpoint, {}, json, () => post.call(this.kit, endpoint, json));
  }

  private async send(stage: string, endpoint: string, params: Params, json: unknown, request: () => Promise<ApiBody>): Promise<CallRecord | null> {
    let body: ApiBody;
    let status = 200;
    try {
      body = await request();
    } catch (e) {
      if (e instanceof OutOfCredits) throw e;
      if (!(e instanceof ApiError)) throw e;
      body = e.body;
      status = e.status;
      this.errors.push({ stage, endpoint, status, message: e.message, requestId: e.requestId, body });
    }
    const data = body.data as { walk?: { request_ids?: unknown } } | undefined;
    const rec: CallRecord = {
      seq: this.records.length + 1,
      stage,
      endpoint,
      params,
      ...(json === undefined ? {} : { json }),
      status,
      requestId: body.request_id ?? null,
      walkRequestIds: Array.isArray(data?.walk?.request_ids) ? (data.walk.request_ids as string[]) : [],
      creditsUsed: status === 200 ? Number(body.credits_used ?? 0) : 0,
      at: this.now().toISOString(),
      body,
    };
    this.records.push(rec);
    appendFileSync(path.join(this.dir, RESPONSES_FILE), JSON.stringify(rec) + "\n");
    this.budget.spend(rec.creditsUsed);
    this.ledger.add({ stage, endpoint, requestId: rec.requestId, credits: rec.creditsUsed, status });
    this.tally(stage, rec.creditsUsed);
    return status === 200 ? rec : null;
  }

  /** Print the line of the stage still open. Call once when the run ends. */
  flush(): void {
    if (!this.group) return;
    const g = this.group;
    this.progress(`${g.name}: ${g.calls} call${g.calls === 1 ? "" : "s"}, ${g.credits} credit${g.credits === 1 ? "" : "s"}`);
    this.group = null;
  }

  meta(): Meta {
    return metaBlock({ skill: this.skill, version: this.version, ledger: this.ledger, startedAt: this.startedAt, now: this.now() });
  }

  private tally(stage: string, credits: number): void {
    const name = stageGroup(stage);
    if (this.group && this.group.name !== name) this.flush();
    this.group ??= { name, calls: 0, credits: 0 };
    this.group.calls++;
    this.group.credits += credits;
  }
}

/** The records a run folder holds, in the order they were made. */
export function loadRecords(dir: string): CallRecord[] {
  const file = path.join(dir, RESPONSES_FILE);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as CallRecord);
}
