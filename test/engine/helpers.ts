// Shared test helpers: synthetic rows with hand-checked numbers, and the recorded
// responses of the study (anonymised: every handle and channel id is an alias, text is
// cut and masked; built from the study's raw/18 and raw/21 on 26/11/2026).
import { readFileSync } from "node:fs";

import type { ResponseRecord, Row } from "../../src/engine/rows.ts";
import { fixturePath } from "../fixture-path.ts";

export interface FixtureRecord extends ResponseRecord {
  seq: number;
  study_req: string;
  params: Record<string, any>;
}

/** The recorded calls of study files 18 and 21 (the /social-viral run of 26/11/2026 and the code study). */
export const records: FixtureRecord[] = JSON.parse(readFileSync(fixturePath("engine-records.json"), "utf8"));
/**
 * Reader 25's calls (study file 25, 26/11/2026): the X originals search ending at each post,
 * and the deeper walks that gave every break-out its earlier posts. Kept apart so that a
 * replay of file 18's run never answers with them. The aliases are shared with `records`.
 */
export const records25: FixtureRecord[] = JSON.parse(readFileSync(fixturePath("engine-records-25.json"), "utf8"));

/** A recorded call by its study request number, for example "18-77" or "25-12". */
export function rec(studyReq: string): FixtureRecord {
  const r = records.find((x) => x.study_req === studyReq) ?? records25.find((x) => x.study_req === studyReq);
  if (!r) throw new Error(`no fixture record ${studyReq}`);
  return r;
}

/** The time the /social-viral run of study file 18 was made. */
export const RUN_AT = new Date("2026-11-26T12:30:00Z");

export function row(over: Partial<Row>): Row {
  return {
    platform: "x",
    id: "1",
    url: null,
    author: "acme",
    authorFollowers: 1000,
    authorUrl: null,
    channelId: null,
    community: null,
    text: "",
    publishedAt: "2026-10-01T11:00:00.000Z",
    views: 100,
    likes: 10,
    comments: 1,
    shares: 0,
    saves: 0,
    durationSeconds: null,
    video: false,
    pinned: false,
    kind: "original",
    requestId: "req-test",
    ...over,
  };
}

/** `n` daily originals by one author, views from `views(i)`, oldest first, ending the day before `end`. */
export function series(n: number, views: (i: number) => number, over: Partial<Row> = {}, end = "2026-11-01T12:00:00.000Z"): Row[] {
  const last = Date.parse(end) - 86_400_000;
  return Array.from({ length: n }, (_, i) =>
    row({ id: `p${i}`, publishedAt: new Date(last - (n - 1 - i) * 86_400_000).toISOString(), views: views(i), ...over }),
  );
}
