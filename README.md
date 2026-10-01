# Resume Optimizer

Paste a job link, point at your resume, and get a tailored `.docx`. You approve every change first.

1. **Job description:** paste or type a link. The app starts reading the posting straight away: on paste, a moment after you stop typing, or when you leave the field. Changing the link cancels the fetch in progress, and **Retry** appears if a fetch fails.
   - It has built-in support for Workday, Greenhouse, Lever and LinkedIn, and for any site that publishes standard job data.
   - If a site blocks it, paste the JD text instead.
2. **Resume:** type or paste the path to your resume on the computer you're using, or click **Browse…** to use your system's file picker. `.docx`, `.pdf` and `.txt` are supported.
3. **Analyze:** Claude (through your Claude subscription or an API key) pulls the JD's keywords and repeated themes, then proposes small edits, one paragraph each.
4. **Review:** your resume appears as a page, set exactly as it will download: EB Garamond, body text justified, and the job's keywords in **bold** with no other highlighting. Edited paragraphs carry a thin rule at the left edge (a dotted underline if you skipped the edit). These marks appear on screen only and never in the download. Click (or tap) an edit to see why it was made, a Before / After view, the keywords it adds and any warnings, then **Accept**, **Skip** or **Edit** it. `j` / `k` move between edits. One line above the page shows your keyword progress (e.g. "7 of 10 keywords · +3 · 3 missing"), the All / Accepted / Skipped filter, a **⋯** menu (accept or skip all, show or hide changes, popover view), **Download** and **Cover letter →**. Instructions in the posting about the application itself (e.g. "no AI-generated content") show as a banner you can dismiss.
5. **Cover letter (optional):** click **Cover letter →**. You can add the hiring manager's name, pick a tone (formal, warm or concise) and say why you want this company. Claude then writes a 250–400 word letter from the job analysis and the resume edits you accepted.
   - Every paragraph is editable in place, and **Regenerate** writes a new version.
   - "Why each point was made" lists each JD requirement the letter addresses and the line from your resume that backs it up.
   - The letter is flagged ⚠ if it mentions a number that isn't in your resume, falls well outside the target length, or uses a stock phrase.
6. **Download:** you get a **PDF** that contains only the edits you accepted. A copy is also saved to your downloads folder, which you can change in **Settings (⚙)**.
   - **File names:** `First_Last_Role_Resume.pdf` and `First_Last_Cover_Letter.pdf`, e.g. `Yashwanth_Varre_Software_Engineer_Resume.pdf`.
     - The name comes from the top of your resume. You can set it in **Settings → Your name for file names** if it isn't detected well.
     - The role is the posting's job title, cleaned up: no brackets, requisition IDs or "Remote", at most 6 words. If the posting has no title, the role is left out.
     - Names use letters, digits, hyphens and underscores only (accents become plain letters), and stay within 80 characters.
     - A file never overwrites another; `_2`, `_3` and so on are added.
     - The review page and the cover letter screen show the name Download will use.
     - Each file's document title and author are set too ("Yashwanth Varre Software Engineer Resume", "Yashwanth Varre").
   - **File format** (Settings): PDF (default), Word `.docx`, or both. "Both" downloads the PDF and saves the `.docx` next to it.
   - **How the PDF is made:** the app builds the `.docx` first, then converts it, so the PDF matches the Word layout exactly. It uses **LibreOffice** (free, [download](https://www.libreoffice.org/download/)) if installed, otherwise **Microsoft Word** on macOS or Windows (`pip install docx2pdf`).
     - Settings shows which converter was found.
     - With neither installed, or if a conversion fails, you get the `.docx` and a note explaining why. Nothing fails silently.
     - The intermediate `.docx` is deleted unless you chose "both".
   - If you started from a `.docx`, your layout (bold, italics, bullets, tabs, links) is kept. Only the changed words are rewritten.
   - **Typography:** the resume and the cover letter use **EB Garamond** by default.
     - The font ships with the app (`ro/fonts`, SIL Open Font License). Every PDF embeds it, so it looks the same on any computer.
     - Body paragraphs and bullets are justified, with hyphenation on so justified lines don't open wide gaps. An English hyphenation dictionary ships in `ro/hyphen`. The name and contact block, section headings, tab-aligned rows (company · title · dates) and one-line entries keep their alignment.
     - Every job keyword in the final text is bold, split at the run level, so the words around it and any links are untouched. Keywords are never hyphenated across a line.
     - In **Settings (⚙)** you can switch to "Keep my resume's font" or turn bold keywords off.
     - Cover letter keywords are bolded only if you tick **Bold keywords** next to Download.
     - A `.docx` download shows EB Garamond only where it's installed ([free from Google Fonts](https://fonts.google.com/specimen/EB+Garamond)). Elsewhere Word substitutes a similar font.
   - **ATS:**
     - The PDF holds real, selectable text (never an image of the page). It is tagged, so reading order is explicit, and fonts are embedded.
     - Your name and contact details are body text on page 1, not a running header.
     - A test extracts the PDF's text and checks it matches the preview word for word, in order.
     - Some older ATS systems still parse `.docx` more reliably. If an application portal asks for Word, switch the format in Settings.
     - The `.docx` uses plain paragraphs: no text boxes, images or layout tables are added.
   - If the resume PDF runs past one page, the save message says so.
   - The cover letter downloads as its own file (`First_Last_Cover_Letter.pdf`), with your name and contact line from the resume as the letterhead. **Download both (.zip)** bundles the resume and the cover letter as `First_Last_Role_Application.zip`.
   - Your original file is never modified.

**Print / Save as PDF** (Ctrl/Cmd+P) on the review screen gives a clean copy: the job, any notice from the posting, and your resume with the accepted edits and no editing marks. On the cover-letter screen it prints just the letter.

**Resumes converted from PDF:** the app finds your name as the line just above your contact details, even when the file stores a section title such as "SUMMARY" first, so sections and the cover-letter letterhead come out right.

**Works on any screen:** phones, tablets and desktops, in portrait or landscape. On phones the edit popover and keyword explanations open as sheets at the bottom of the screen, and the page runs edge to edge.

**Activity:** a small status pill in the top bar always shows what the app is doing (e.g. "Draft resume edits · 3/4", then "Done"). Click it to open the full timeline: each job's steps, how long each took, what was found, and a Cancel button for anything running.

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
- A skill that your resume doesn't show appears under **Not added** in the Keywords panel and in **Fill gaps**, with the reason. It is never inserted automatically; other advice from Claude is listed at the bottom of Fill gaps.
- A change is flagged ⚠ if it introduces a number that doesn't appear anywhere in your resume, or if it makes a line noticeably longer.
- Keyword coverage is shown as plain counts: how many keywords the job lists, how many your resume had, and how many it has **now** with the edits you've accepted. Click the keyword line above the page to open the **Keywords** panel. A keyword counts if its exact term, a listed variant or a simple plural appears in the text.
- Keywords are split into **In your resume** (a **new** tag marks the ones your accepted edits added) and **Not added**. Hover over or tap a "Not added" keyword to see why it's missing:
  - A suggested edit adds it but you skipped that edit. The tooltip offers to include it.
  - Claude's reason for that keyword, for example that your resume doesn't show that experience.
- **Fill the keyword gaps:** click **Fill gaps (N)** above the page. The same panel also opens from the Keywords panel or a missing keyword's tooltip. Every missing keyword is listed with the reason it's missing, and each one has three options:
  - **Skip** (the default).
  - **Describe it:** a few words on where and how you used it (at least 3 words), and optionally the role.
  - **Write it from my resume:** no typing. Claude looks for work your resume already shows that the keyword truthfully describes (e.g. JSX components → React), writes it in, and names the line it's based on. It never invents a project or tool to fit. If nothing supports it, the row switches to **Describe it** and shows Claude's question.

  One keyword is enough to send, and whatever mix you choose goes to Claude in a **single request**:
  - Edits are planned together: each paragraph is edited at most once, with at most 2 paragraphs per keyword, building on your current text.
  - Edits based on your note arrive **accepted**, with a **From your input** tag. Edits Claude drafted from your resume arrive **skipped**, with a **Drafted by Claude** tag and a "confirm it's accurate" warning, and they only count once you accept them.
  - A note that's too vague keeps your text and shows Claude's follow-up question. **Ask again** resends only the rows you've changed. If a newer edit to the same line replaces a draft you haven't accepted, that keyword becomes a gap again, ready to redraft.
  - Numbers from your own notes aren't flagged as invented, but any other new number is. An edit that removes a job keyword a line already had is flagged too. Only your own notes (not Claude's drafts) are passed to the cover letter as evidence.

## Files

```
app.py              web server + API
ro/paths.py         cross-platform path handling, native file pickers
ro/jd_fetch.py      JD fetching (ATS APIs → JSON-LD → page text → headless browser)
ro/pdf_export.py    .docx → PDF (LibreOffice, or Word via docx2pdf), with the bundled fonts and hyphenation
ro/resume_io.py     resume parsing + formatting-preserving .docx export
ro/analyzer.py      Claude prompts, structured output, guardrails (resume edits + cover letter)
ro/jobs.py          background jobs + live progress events (streamed to the UI over SSE)
ro/claude_code.py   runs Claude via the Claude Code CLI (uses your subscription)
static/             UI (HTML/CSS/JS, no build step)
tests/              offline tests; tests/mock_server.py runs the UI with canned AI output
```

Run the tests with `python tests/test_e2e.py && python tests/test_jobs_cover.py && python tests/test_justify.py && python tests/test_parse_layout.py && python tests/test_typography.py && python tests/test_pdf.py && python tests/test_file_names.py && python tests/test_jd_fetch.py && python tests/test_fuzz_docx_edit.py && python tests/test_claude_code.py`. `python tests/test_autofetch_ui.py` checks auto-fetch in a real browser against the mock server; it needs Playwright and skips without it. With `tests/mock_server.py`, links on a `.test` host (e.g. `https://jobs.example.test/1`) return a canned posting.

`python tests/mock_server.py` runs the UI with canned AI output. Set `MOCK_DELAY=3` to slow the fake AI calls down so the progress UI is easier to watch.

### API

The UI runs long operations as background jobs. `POST /api/jobs/{jd_fetch|analyze|cover_letter|justify_keywords|export}` returns a `job_id` straight away. `GET /api/jobs/{id}/events` then streams progress as Server-Sent Events, each shaped `{seq, step, status, message, detail?, ts}`, and ends with an `end` event that carries the result or the error. `GET /api/jobs/{id}?since=N` is a polling fallback, and `POST /api/jobs/{id}/cancel` stops a job at its next checkpoint (a running Claude Code call is killed). The older synchronous endpoints (`/api/jd/fetch`, `/api/analyze`, `/api/cover_letter`, `/api/justify_keywords`, `/api/export`) still work for scripts.

## Troubleshooting

- **"Couldn't read the job description"**: the site blocks automated access (common for LinkedIn search pages or pages behind a login). Paste the JD text.
- **Browse… does nothing**: some Python installs lack a GUI toolkit. Type the path or use *upload a file*.
- **"Claude Code isn't signed in"**: open Terminal, run `claude`, sign in, then click Analyze again.
- **"Claude Code not found"**: install it (see Setup), then restart the app. If you installed it somewhere unusual, make sure `claude` works in Terminal.
- **"Model not available"**: change the model in Settings. `sonnet` is the default for Claude Code and `claude-sonnet-5` for the API.
- **PDF resumes**: the text is extracted, and the output is a clean ATS-friendly `.docx`, because PDF layout can't be edited. Start from a `.docx` to keep your exact design.
