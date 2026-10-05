// Shapes returned by the FastAPI backend (app.py). Only the fields the UI reads are typed.

export interface Config {
  last_resume_path: string;
  default_resume_path: string; // loaded on start; "" = off
  output_dir: string;
  has_api_key: boolean;
  model: string;
  engine: "auto" | "claude_code" | "api";
  active_engine: "claude_code" | "api";
  claude_code_path: string;
  cc_model: string | null;
  doc_font: string;
  bold_keywords: boolean;
  file_format: "pdf" | "docx" | "both";
  name_override: string;
  pdf_converter: string | null;
  pdf_missing: string;
  playwright: boolean;
  home: string;
  os: string;
}

export interface Paragraph {
  id: string;
  text: string;
  kind: "heading" | "text" | "bullet" | "empty" | string;
  section: string;
}

export interface Resume {
  session_id: string;
  path: string;
  file_name: string;
  count: number;
  sections: number;
  keeps_formatting: boolean;
  default_output_dir: string;
  paragraphs: Paragraph[];
}

export interface JdMeta {
  text: string;
  title?: string;
  company?: string;
  method?: string;
}

export interface Keyword {
  term: string;
  variants?: string[];
  importance?: "required" | "preferred" | "nice" | string;
  category?: string;
}

export interface Change {
  id: string;
  target_id: string;
  original_text: string;
  new_text: string;
  type: string;
  section: string;
  reason: string;
  jd_keywords?: string[];
  warnings?: string[];
  source?: string;
  from_input?: string;
}

export interface Analysis {
  jd: { role?: string; company?: string; summary?: string; keywords?: Keyword[] };
  overall_assessment?: string;
  changes: Change[];
  suggestions?: { text: string; reason: string }[];
  notices?: (string | { text: string })[];
  keyword_gaps?: { term: string; reason: string }[];
}

export interface FoundJob {
  title: string;
  company: string;
  location?: string;
  url: string;
  age_minutes: number;
  match_reason?: string;
  source?: string;
}

export interface FindResult {
  jobs: FoundJob[];
  dropped: string[];
  profile?: string;
}

export interface KeywordDecision {
  term: string;
  evidence?: "strong" | "weak" | string;
  explanation?: string;
  based_on?: string;
}

export interface JustifyResult {
  decisions: KeywordDecision[];
  changes: Change[];
}

export interface CoverLetter {
  greeting: string;
  paragraphs: string[];
  closing: string;
  signature?: string;
  evidence: { jd_requirement: string; resume_evidence: string }[];
  warnings: string[];
  word_count: number;
}

export interface Download {
  download_url: string;
  file_name: string;
  files?: { path: string }[];
}

export interface ExportResult extends Download {
  pages?: number;
  notices?: string[];
  cover?: Download;
  zip?: Download;
}

export interface FileNames {
  resume: string;
  cover: string;
  zip: string;
  name_found: boolean;
  from_settings: boolean;
}

export interface Edit {
  target_id: string;
  new_text: string;
}

// ---- background jobs
export type StepStatus = "pending" | "running" | "done" | "error";
export type JobStatus = "running" | "done" | "error" | "cancelled";

export interface JobEvent {
  seq: number;
  step: string;
  status: StepStatus;
  message: string;
  detail?: unknown;
  ts: number;
}

export interface Job {
  job_id: string;
  title: string;
  plan: { step: string; label: string }[];
  events: JobEvent[];
  status: JobStatus;
  error?: string;
  t0: number;
  t1?: number;
  seen: number;
  local?: boolean;
}
