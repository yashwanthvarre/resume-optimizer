# Resume Optimizer

Paste a job link, point at your resume, and get a tailored `.docx`. You approve every change first.

1. **Job description:** paste a link and the app reads the posting.
   - It has built-in support for Workday, Greenhouse, Lever and LinkedIn, and for any site that publishes standard job data.
   - If a site blocks it, paste the JD text instead.
2. **Resume:** type or paste the path to your resume on the computer you're using, or click **Browse…** to use your system's file picker. `.docx`, `.pdf` and `.txt` are supported.
3. **Analyze:** Claude (through your Claude subscription or an API key) pulls the JD's keywords and repeated themes, then proposes small edits, one paragraph each.
4. **Review:** each change shows a before/after diff and the reason for it. Tick or untick it (✓) and the live preview and match score update right away. You can also edit any suggestion yourself.
5. **Download:** you get a `.docx` that contains only the changes you ticked.
   - If you started from a `.docx`, your original formatting (fonts, bold, bullets, tabs, links) is kept. Only the changed words are rewritten.
   - Your original file is never modified.

## Setup (any computer)

You need **Python 3.10+** ([python.org](https://www.python.org/downloads/)) plus one of the following:

- **Your Claude subscription (recommended, no API key needed):**
  1. Install **Claude Code**. The steps are at [claude.com/product/claude-code](https://claude.com/product/claude-code). On Mac/Linux:
     `curl -fsSL https://claude.ai/install.sh | bash`
  2. In Terminal, run `claude` once and sign in with your Claude account.

  The app finds Claude Code automatically and uses your plan. Each analysis makes two requests, which count toward your plan's usage limits.
- **An Anthropic API key** (pay-as-you-go, billed separately from Claude plans): create one at platform.claude.com, choose "Anthropic API key" in **Settings (⚙)**, and paste it there.

| OS | Start the app |
|---|---|
| macOS | Double-click `run.command`, or run `./run.sh` in Terminal |
| Linux | `./run.sh` |
| Windows | Double-click `run.bat` |

The first run creates a private `.venv` and installs dependencies. After that the app opens in your browser at `http://127.0.0.1:8765`.

Manual alternative:

```bash
python -m venv .venv
# macOS/Linux: source .venv/bin/activate    Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py            # options: --port 9000  --no-browser
```

**Optional:** to read job sites that need JavaScript and have no public API, install a headless browser:

```bash
pip install playwright && python -m playwright install chromium
```

## Resume paths

Paths are resolved on the machine the app runs on, so the same app works anywhere. All of these work:

- `~/Documents/Resume.docx`
- `/Users/varre/Desktop/Resume.pdf`
- `C:\Users\Varre\Documents\Resume.docx`
- `"C:\Users\Varre\My Resume.docx"` (Windows "Copy as path", quotes included)
- `%USERPROFILE%\Documents\Resume.docx` and `$HOME/Resume.docx`
- `file:///Users/varre/Resume.docx`

The last path you used, your output folder, API key and model are stored per user in `~/.resume-optimizer/`, which is `C:\Users\<you>\.resume-optimizer\` on Windows.

## Honesty guardrails

- Claude is instructed to never invent employers, titles, dates, tools, skills or metrics. It only rewords what your resume already supports.
- A skill that your resume doesn't show is listed under **"Worth adding — only if true"**. It is never inserted automatically.
- A change is flagged ⚠ if it introduces a number that doesn't appear anywhere in your resume, or if it makes a line noticeably longer.
- The match score is a transparent keyword-coverage measure: required keywords count ×3, preferred ×2 and nice-to-have ×1. It is recalculated live as you tick and untick changes.

## Files

```
app.py              web server + API
ro/paths.py         cross-platform path handling, native file pickers
ro/jd_fetch.py      JD fetching (ATS APIs → JSON-LD → page text → headless browser)
ro/resume_io.py     resume parsing + formatting-preserving .docx export
ro/analyzer.py      Claude prompts, structured output, guardrails
ro/claude_code.py   runs Claude via the Claude Code CLI (uses your subscription)
static/             UI (HTML/CSS/JS, no build step)
tests/              offline tests; tests/mock_server.py runs the UI with canned AI output
```

Run the tests with `python tests/test_e2e.py && python tests/test_jd_fetch.py && python tests/test_fuzz_docx_edit.py && python tests/test_claude_code.py`.

## Troubleshooting

- **"Couldn't read the job description"**: the site blocks automated access (common for LinkedIn search pages or pages behind a login). Paste the JD text.
- **Browse… does nothing**: some Python installs lack a GUI toolkit. Type the path or use *upload a file*.
- **"Claude Code isn't signed in"**: open Terminal, run `claude`, sign in, then click Analyze again.
- **"Claude Code not found"**: install it (see Setup), then restart the app. If you installed it somewhere unusual, make sure `claude` works in Terminal.
- **"Model not available"**: change the model in Settings. `sonnet` is the default for Claude Code and `claude-sonnet-5` for the API.
- **PDF resumes**: the text is extracted, and the output is a clean ATS-friendly `.docx`, because PDF layout can't be edited. Start from a `.docx` to keep your exact design.
