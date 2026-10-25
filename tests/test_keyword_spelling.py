"""The resume must use the JD's exact spelling of every keyword: EXACT vs LOOSE matching, the automatic
"Match JD spelling" edits, and the Python and TypeScript matchers agreeing on every case."""
import json, os, shutil, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from ro import analyzer
from ro.resume_io import keyword_spans, kw_regex, loose_only

# (JD term, resume text, EXACT matches, LOOSE-only matches, text after the fix)
CASES = [
    ("ReactJS", "Built the UI in Reactjs.", [], ["Reactjs"], "Built the UI in ReactJS."),
    ("ReactJS", "React.js, React JS and react-js apps", [], ["React.js", "React JS", "react-js"], "ReactJS, ReactJS and ReactJS apps"),
    ("Java", "Wrote java services.", [], ["java"], "Wrote Java services."),
    ("Java", "Wrote JavaScript and Javas.", ["Javas"], [], "Wrote JavaScript and Javas."),
    ("Java", "Built JavaScript apps.", [], [], "Built JavaScript apps."),
    ("React", "Reactive streams; react to incidents.", [], [], "Reactive streams; react to incidents."),
    ("Node.js", "NodeJS and node js services", [], ["NodeJS", "node js"], "Node.js and Node.js services"),
    ("CI/CD", "Set up ci/cd pipelines.", [], ["ci/cd"], "Set up CI/CD pipelines."),
    ("APIs", "Designed a REST API.", ["API"], [], "Designed a REST API."),
    ("API", "Designed REST APIs and apis.", ["APIs"], ["apis"], "Designed REST APIs and APIs."),
    ("Java", "See github.com/me/java-app, me@java.dev, https://x.io/java and ~/src/java/Main.kt",
     [], [], "See github.com/me/java-app, me@java.dev, https://x.io/java and ~/src/java/Main.kt"),
    ("Java", "java at github.com/me/java-app", [], ["java"], "Java at github.com/me/java-app"),
    ("Spring Boot", "Spring-Boot and spring boot", [], ["Spring-Boot", "spring boot"], "Spring Boot and Spring Boot"),
    ("unit testing", "Unit testing first; UNIT TESTING", ["Unit testing"], ["UNIT TESTING"], "Unit testing first; Unit testing"),
]
VARIANTS = {"Kubernetes": ["k8s"]}
CASES.append(("Kubernetes", "Ran k8s and kubernetes clusters, Kubernetes", ["Kubernetes"], ["k8s", "kubernetes"],
              "Ran Kubernetes and Kubernetes clusters, Kubernetes"))


def py_result(term, text, v=None):
    v = VARIANTS.get(term, []) if v is None else v
    return {"exact": [m["k"] for m in kw_regex(term).finditer(text)],
            "loose": [m["k"] for m, _ in loose_only(text, term, v)],
            "loose_any": [m["k"] for f in [term, *v] for m in kw_regex(f, loose=True).finditer(text)]}


def test_exact_and_loose():
    for term, text, exact, loose, _ in CASES:
        r = py_result(term, text)
        assert r["exact"] == exact, (term, text, r)
        assert r["loose"] == loose, (term, text, r)
    assert not kw_regex("Java", loose=True).search("JavaScript")
    assert not kw_regex("React", loose=True).search("Reactive")
    assert not kw_regex("Kubernetes").search("k8s"), "a variant is never an EXACT match"


def test_fix_then_present():
    for term, text, _, loose, fixed in CASES:
        kws = [{"term": term, "variants": VARIANTS.get(term, [])}]
        new, hits = analyzer.fix_spelling(text, kws)
        assert new == fixed, (term, text, new)
        assert [f for f, _ in hits] == list(dict.fromkeys(loose)), (term, hits)
        if loose:
            assert analyzer.mentions(new, term) and not loose_only(new, term, VARIANTS.get(term, [])), (term, new)


def test_spelling_changes():
    jd = {"keywords": [{"term": "ReactJS"}, {"term": "Java"}, {"term": "CI/CD"}, {"term": "Python"}]}
    paras = [{"id": "p0", "section": "Header", "kind": "text", "text": "Alex Sample · github.com/alex/java-app"},
             {"id": "p1", "section": "Experience", "kind": "bullet", "text": "• Built Reactjs dashboards backed by java services."},
             {"id": "p2", "section": "Experience", "kind": "bullet", "text": "• Ran ci/cd for Python jobs."},
             {"id": "p3", "section": "Skills", "kind": "text", "text": "Java, ReactJS"},
             {"id": "p4", "section": "Projects", "kind": "text", "text": "Source: github.com/alex/java-app"}]
    proposed = [{"id": "c0", "target_id": "p2", "original_text": paras[2]["text"],
                 "new_text": "• Owned ci/cd for Python and java jobs.", "jd_keywords": ["Python"], "warnings": []}]
    out = analyzer.spelling_changes(proposed, paras, jd)
    assert [c["target_id"] for c in out] == ["p1", "p2"], out
    s = out[0]
    assert s["new_text"] == "• Built ReactJS dashboards backed by Java services.", s
    assert s["type"] == "spelling" and s["jd_keywords"] == ["ReactJS", "Java"], s
    assert s["reason"] == "Match JD spelling: Reactjs → ReactJS, java → Java", s
    # a proposed edit to a paragraph gets the JD's spelling too, instead of a second edit to the same paragraph
    assert out[1]["new_text"] == "• Owned CI/CD for Python and Java jobs." and out[1]["jd_keywords"] == ["Python", "CI/CD", "Java"], out[1]


def test_tags_and_bold_exact_only():
    jd = {"keywords": [{"term": "Java"}, {"term": "Kubernetes", "variants": ["k8s"]}]}
    ch = [{"original_text": "Wrote code.", "new_text": "Wrote java code on k8s."},
          {"original_text": "Wrote code.", "new_text": "Wrote Java code on Kubernetes."}]
    analyzer.tag_changes(ch, jd)
    assert ch[0]["jd_keywords"] == [] and ch[1]["jd_keywords"] == ["Java", "Kubernetes"], ch
    text = "java, Java and JavaScript"
    assert keyword_spans(text, ["Java"]) == [(6, 10)]


def test_ground_to_jd_spelling():
    jd_text = ("We use ReactJS on the front end and NodeJS behind it. Requirements: ReactJS, Node.js, java 17 is a plus "
               "but Java is a must, Java 21 ideally. Unit testing and code review. Good communication skills. Kubernetes nice to have.")
    kw = lambda t, **k: {"term": t, "importance": "preferred", "category": "hard_skill", **k}
    out = analyzer.ground_keywords({"keywords": [
        kw("React.js"), kw("Node.js"), kw("Java"), kw("unit testing"), kw("Communication skills", category="soft_skill"),
        kw("k8s", variants=["Kubernetes"])]}, jd_text)
    by = {k["term"]: k for k in out["keywords"]}
    assert list(by) == ["ReactJS", "NodeJS", "Java", "unit testing", "communication skills", "Kubernetes"], list(by)
    assert by["NodeJS"]["variants"] == ["Node.js"], by["NodeJS"]   # a tie: the JD's first spelling, the other kept
    assert by["Java"]["variants"] == ["java"], by["Java"]
    assert by["Kubernetes"]["variants"] == ["k8s"], by["Kubernetes"]


def _node():
    n = shutil.which("node")
    if n:
        return n
    for p in [ROOT / ".venv", Path(sys.prefix)]:
        for c in p.glob("lib/python*/site-packages/playwright/driver/node"):
            return str(c)
    return None


def test_python_and_ts_agree():
    node = _node()
    if not node:
        print("SKIP TS parity: no node"); return
    cases = [[t, x, VARIANTS.get(t, [])] for t, x, *_ in CASES] + [
        ["CI/CD pipelines", "ci/cd-pipeline and CI/CD pipeline", []], ["C#", "c# and C#", []],
        ["Node.js", "node.JS, Node-js, node.jsx", []], ["Go", "go-to-market in Go and GO", []]]
    script = """
import { kwRegex, looseOnly } from %s;
const cases = JSON.parse(process.argv[1]);
console.log(JSON.stringify(cases.map(([t, x, v]) => ({
  exact: [...x.matchAll(kwRegex(t))].map((m) => m.groups.k),
  loose: looseOnly(x, t, v).map((m) => m.found),
  loose_any: [t, ...v].flatMap((f) => [...x.matchAll(kwRegex(f, true))].map((m) => m.groups.k)),
}))));
""" % json.dumps((ROOT / "frontend/src/lib/keywords.ts").as_uri())
    r = subprocess.run([node, "--input-type=module", "--experimental-strip-types", "--no-warnings", "-e", script,
                        json.dumps(cases)], capture_output=True, text=True, cwd=ROOT / "frontend")
    assert r.returncode == 0, r.stderr
    ts = json.loads(r.stdout)
    for (t, x, v), got in zip(cases, ts):
        assert py_result(t, x, v) == got, (t, x, py_result(t, x, v), got)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn(); print("ok", name)
    print("ALL KEYWORD SPELLING TESTS PASSED")
