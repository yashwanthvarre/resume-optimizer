export interface Op {
  t: "=" | "-" | "+";
  s: string;
}

/** Word-level LCS diff of a → b, with runs of the same kind merged. */
export function diffOps(a: string, b: string): Op[] {
  const A = a.split(/(\s+)/).filter((x) => x !== ""), B = b.split(/(\s+)/).filter((x) => x !== "");
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Op[] = [];
  let i = 0, j = 0;
  const push = (t: Op["t"], s: string) => {
    const l = out[out.length - 1];
    if (l && l.t === t) l.s += s;
    else out.push({ t, s });
  };
  while (i < n && j < m) {
    if (A[i] === B[j]) { push("=", A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) push("-", A[i++]);
    else push("+", B[j++]);
  }
  while (i < n) push("-", A[i++]);
  while (j < m) push("+", B[j++]);
  return out;
}

/** One side of the diff (before: drop "+", after: drop "-"), with a space-only gap between two changed words folded
 *  into the run, so "designing Python REST APIs" highlights as one phrase, not four boxes. */
export function diffView(ops: Op[], drop: "+" | "-"): Op[] {
  const v = ops.filter((o) => o.t !== drop), out: Op[] = [];
  v.forEach((o, k) => {
    const t = o.t === "=" && !o.s.trim() && v[k - 1] && v[k + 1] && v[k - 1].t !== "=" && v[k - 1].t === v[k + 1].t ? v[k - 1].t : o.t;
    const l = out[out.length - 1];
    if (l && l.t === t) l.s += o.s;
    else out.push({ t, s: o.s });
  });
  return out;
}

const words = (s: string) => (s.match(/\S+/g) || []).length;
/** Heavy rewrites turn inline marks into word soup; those read better as Before / After. */
export const heavy = (ops: Op[], a: string, b: string) =>
  ops.filter((o) => o.t !== "=").reduce((n, o) => n + words(o.s), 0) / Math.max(1, words(a) + words(b)) > 0.3;
