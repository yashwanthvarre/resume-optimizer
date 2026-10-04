import { create } from "zustand";
import type { Analysis, Config, CoverLetter, FindResult, Job, JdMeta, KeywordDecision, Resume } from "../api/types";
import type { Kw } from "../lib/keywords";

export type Kind = "info" | "ok" | "err";
export interface Status {
  msg: string;
  kind: Kind;
  busy?: boolean;
}
export const st = (msg = "", kind: Kind = "info", busy = false): Status => ({ msg, kind, busy });

export type View = "setup" | "review" | "cover";
export type Filter = "all" | "on" | "off";
export type DiffMode = "auto" | "inline" | "stacked";
export type Tone = "formal" | "warm" | "concise";

/** One "Not added" keyword in the Add-keywords panel.
 *  add = Claude researches the keyword and writes it in from the resume · note = the user's quick idea
 *  skip = not for this job: never sent · added = an edit carrying it is on the page · missed = no line could take it */
export interface Gap {
  choice: "add" | "note" | "skip";
  note: string;
  role: string;
  status: "draft" | "added" | "missed";
  reply?: KeywordDecision;
  changeId?: string | null;
}

export interface Letter {
  greeting: string;
  closing: string;
  signature: string;
  paragraphs: string[];
}

export interface AppState {
  cfg: Config | null;
  view: View;
  settingsOpen: boolean;

  // resume
  resume: Resume | null;
  resumePath: string;
  resumeStatus: Status;

  // the job
  jdUrl: string;
  jdText: string;
  jdMeta: Partial<JdMeta>;
  jdBox: boolean;
  jdTitle: string;
  jdMethod: string;
  jdStatus: Status;
  fetching: boolean;
  fetchRetry: boolean;

  // job finder
  finderTab: boolean; // this tab was opened from the job list: no search, straight to its one job
  findRunning: boolean;
  findJob: Job | null;
  hasSearched: boolean;
  findStatus: Status;
  found: FindResult | null;
  foundAt: number;
  opened: number[];
  searchedFor: string;

  // analyze
  analyzing: boolean;
  analyzeJob: Job | null;
  analyzeStatus: Status;
  progressShown: boolean;

  // review
  analysis: Analysis | null;
  kws: Kw[];
  kwAll: RegExp[];
  selected: Set<string>;
  edits: Record<string, string>;
  filter: Filter;
  kwFilter: string | null;
  pop: string | null;
  editorOpen: boolean;
  exported: boolean;
  showMarks: boolean;
  diffMode: DiffMode;
  noticeOpen: boolean;
  menuOpen: boolean;
  addedNow: { ids: string[]; at: number };
  exportStatus: Status;
  exporting: "" | "resume" | "cover" | "both";

  // keyword sheets
  sheet: null | "keywords" | "gaps";
  gapFocus: { terms: string[]; at: number };
  gaps: Record<string, Gap>;
  gapExtra: string[];
  gapsSummary: string;
  gapsJob: Job | null;
  gapsStatus: Status;

  // cover letter
  cover: CoverLetter | null;
  letter: Letter;
  coverEdited: boolean;
  tone: Tone;
  manager: string;
  why: string;
  coverJob: Job | null;
  coverStatus: Status;
  coverFormOpen: boolean;
  boldLetterKw: boolean;
  cvExportStatus: Status;
}

function storedDiffMode(): DiffMode {
  try {
    return (localStorage.getItem("ro.diffMode") as DiffMode) || "auto";
  } catch {
    return "auto"; // storage blocked
  }
}

export const emptyLetter: Letter = { greeting: "", closing: "", signature: "", paragraphs: [] };

export const initialState: AppState = {
  cfg: null, view: "setup", settingsOpen: false,
  resume: null, resumePath: "", resumeStatus: st(),
  jdUrl: "", jdText: "", jdMeta: {}, jdBox: false, jdTitle: "", jdMethod: "", jdStatus: st(), fetching: false, fetchRetry: false,
  finderTab: false, findRunning: false, findJob: null, hasSearched: false,
  findStatus: st("Load your resume and the search starts by itself."), found: null, foundAt: 0, opened: [], searchedFor: "",
  analyzing: false, analyzeJob: null, analyzeStatus: st(), progressShown: false,
  analysis: null, kws: [], kwAll: [], selected: new Set(), edits: {}, filter: "all", kwFilter: null, pop: null, editorOpen: false,
  exported: false, showMarks: true, diffMode: storedDiffMode(), noticeOpen: true, menuOpen: false, addedNow: { ids: [], at: 0 },
  exportStatus: st(), exporting: "",
  sheet: null, gapFocus: { terms: [], at: 0 }, gaps: {}, gapExtra: [], gapsSummary: "", gapsJob: null, gapsStatus: st(),
  cover: null, letter: emptyLetter, coverEdited: false, tone: "warm", manager: "", why: "", coverJob: null, coverStatus: st(),
  coverFormOpen: true, boldLetterKw: false, cvExportStatus: st(),
};

export const useApp = create<AppState>(() => initialState);
export const set = useApp.setState;
export const get = useApp.getState;
