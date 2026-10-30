# Storyshot

Ask your coding agent for a video of your web app, and get a polished 1080p
MP4: a promo clip, a narrated tutorial, a lesson, or step-by-step GIFs for your
docs.

> *"make a 15 s promo video of https://myapp.com"*

Storyshot gives coding agents (Cursor, Claude Code, Codex, Gemini CLI, Copilot in VS Code, Windsurf, Cline) what they need to
do this well. A real browser clicks through your site, and the recording gets
a smooth cursor, automatic zoom, captions, an optional AI voiceover, music
and an end card. Loading time is squeezed out, so a 30-second AI job takes a
second or two on screen.

The agent plans, writes and fixes the storyboard. Storyshot does the
recording and editing, and the same storyboard always renders the same video.

## Gallery

**[boheling.github.io/storyshot-gallery](https://boheling.github.io/storyshot-gallery/)**: promos,
tutorials, lessons and help-center docs of real web apps (Squoosh, Excalidraw, NCBI BLAST, Desmos,
regex101, RCSB PDB, Datasette and more, two of them in Chinese). Each one was made by an agent from a
one-paragraph request, and comes with its storyboard and notes on how it went.

## Next to similar tools

Storyshot, [promo-video-recorder](https://github.com/palamut62/promo-video-recorder)
and [demo-dev](https://www.npmjs.com/package/demo-dev) each made a promo of this
repo's page, with the same storyline and free local voices only. The grid
below is muted; open the full videos to hear them.

https://github.com/user-attachments/assets/3d8175ab-ba15-4b61-961d-481e57566e7a

<details>
<summary>The three full videos, with sound</summary>

**Storyshot**

https://github.com/user-attachments/assets/22987356-2a74-4e28-9a14-a1b01d04f932

**promo-video-recorder**

https://github.com/user-attachments/assets/e5eb86e5-e69c-403b-ad6c-c4499592307a

**demo-dev**

https://github.com/user-attachments/assets/8d3370ca-7a90-48af-b1c9-88189763e95d

</details>

How each one was made, what we saw, and the caveats:
[docs/comparison](docs/comparison/README.md).

## Quick start

Open your project in your coding agent and paste this into its chat, with your
agent's name (`cursor`, `claude`, `codex`, `gemini`, `vscode`, `windsurf` or `cline`):

> Set up Storyshot in this project: run `npx -y storyshot setup cursor` and do
> everything it says. Then make a short promo video of https://myapp.com

| agent | what `setup` writes |
|---|---|
| Cursor | `.cursor/mcp.json` and the skill in `.cursor/skills/storyshot/` |
| Claude Code | `.mcp.json` and the skill in `.claude/skills/storyshot/` |
| Codex | the skill in `.agents/skills/storyshot/`, a short section in `AGENTS.md` pointing to it, and the MCP server through `codex mcp add` (in `~/.codex/config.toml`, for your user). Storyshot launches a browser, which Codex's sandbox blocks: approve it when Codex asks, or run Codex with `--sandbox danger-full-access` |
| Gemini CLI | `.gemini/settings.json`, a section in `GEMINI.md`, the skill in `.agents/skills/storyshot/` (trust the folder when Gemini asks, or it ignores project settings) |
| Copilot in VS Code (`vscode`) | `.vscode/mcp.json`, a section in `.github/copilot-instructions.md`, the skill in `.agents/skills/storyshot/` |
| Windsurf | `.windsurf/rules/storyshot.md`, the skill in `.agents/skills/storyshot/`, and the MCP server in `~/.codeium/windsurf/mcp_config.json` (for your user) |
| Cline | `.clinerules/storyshot.md`, the skill in `.agents/skills/storyshot/`, and the MCP server in Cline's own settings in each editor it is installed in (for your user) |

Existing files are merged, not replaced: other MCP servers stay, and instruction files get one marked
Storyshot section that a second `setup` updates instead of duplicating.

**Tested end to end** (setup, then an agent making a real video from a plain request): **Claude Code,
Cursor and Codex**. Gemini CLI, Copilot in VS Code, Windsurf and Cline get the configuration their docs
describe, but haven't been tested with a real session yet; reports are welcome.

The agent does the rest:
- `setup` writes the MCP server config and the Storyshot skill, adds
  `.storyshot/` to `.gitignore`, and downloads the browser it needs.
- If ffmpeg is missing, setup prints the exact install command for your OS
  (`brew install ffmpeg`, `winget install --id Gyan.FFmpeg -e`,
  `sudo apt-get install -y ffmpeg`). The agent runs it after you approve.
- The agent reads the skill and starts on your video in the same chat, using
  the CLI.

Restart or reload your agent when convenient (`setup` says how for each one). From the next chat on,
the agent uses the Storyshot MCP tools automatically, and you can just ask:

- *"make a 15 s promo video of https://myapp.com"*, or type `/storyshot`
- *"make a narrated tutorial showing how to export a report"*
- *"make a lesson video explaining how the AI editor works"*
- *"make docs GIFs for the onboarding flow"*

`npx storyshot doctor` re-checks everything at any time. Storyshot runs on
macOS, Linux and Windows.

## What happens when you ask

1. **The agent looks at your site** (about 5 s). It reads the page, and checks
   whether the flow is behind a login and whether you have a voice API key.
2. **It confirms the plan with you, once, before spending anything:**

   ```
   Here's the plan. Reply "ok", or change any line:
   1. Type: pitch: a promo for the landing page
   2. Length: about 20 s, 6 shots
   3. Flow: hero → Examples → Try It → AI result → pricing → end card
   4. Voice: none (other options: free local English voice; ElevenLabs, key found in .env)
   5. Music: upbeat · Captions: English · Subtitle file (.srt): no
   6. Format: 16:9, 1080p
   7. Login: not needed
   ```

3. **If you need to log in**, a browser window opens and you log in there.
   The agent never sees or types your password. See
   [Logged-in apps](#logged-in-apps).
4. **It writes `videos/<site>-<kind>.yaml`** (kind is promo, tutorial, lesson or docs, plus a topic for tutorials, e.g. `videos/acme-tutorial-export-pdf.yaml` → `.mp4`), using only click targets verified on
   your live pages.
5. **It renders, looks at the result, and fixes it.** Every render returns a
   contact sheet with one frame per step, plus warnings: a step that is rushed
   or slow, narration that doesn't fit, a caption covering what's being
   clicked, a page still loading. The agent fixes these and re-renders. When
   only text or timing changed, it re-renders in seconds without re-recording.
6. **It hands you the MP4**, a shot list, and what was sped up. Depending on
   the type, you also get `.srt` subtitles, YouTube chapters, or per-step
   GIFs.

The storyboard is a plain file in your repo. Commit it, edit it, and ask the
agent for changes later ("make step 3 slower", "add a Chinese voiceover").
After your next release, re-render it and you have an up-to-date video.

## What you can make

| ask for | type (`purpose`) | you get |
|---|---|---|
| a promo / launch / landing-page clip | `pitch` | short and tightly cut: intro card, the app in a browser frame, music, captions |
| a how-to or onboarding video | `tutorial` | paced to follow along: one narrated action per step, the camera following each click, part cards, a second example, a recap; `.srt` + chapters |
| a lesson or explainer | `course` | explains the *why*: concept cards, the idea shown in the app, question cards, a recap, no music; `.srt` + chapters |
| help-center snippets | `docs` | silent per-step GIFs and PNGs cropped to the action, plus a ready-to-paste Markdown article |

Length follows the purpose and the content, not a target: a promo is as short as
its message, a tutorial as long as the workflow takes to explain.

Any type can also be vertical (9:16) or in another language.

## Voice and cost

Rendering is free and runs locally. Only the voiceover can cost money:

| voice | cost | notes |
|---|---|---|
| none | free | captions only |
| `kokoro` | free | local, English and Mandarin Chinese (`zf_001`); downloads a ~90 MB model on first use (Chinese: ~130 MB, and needs Python 3.10–3.12) |
| ElevenLabs | your credits | the most natural voice; many languages including Chinese. Put `ELEVENLABS_API_KEY` in `.env`. |
| OpenAI | your credits | `OPENAI_API_KEY` |

With a paid voice, the agent iterates with the free voice (draft mode) and
only renders the paid voice once the video looks right. Each line is cached,
so a change only pays for the lines that changed.

## Logged-in apps

When the flow is behind a login, the agent says so in its plan. Then:

1. A normal Chrome window opens (the `login` tool, or `storyshot login <url>`).
   No script is attached to it while you log in, so "Sign in with Google" and
   2FA work as usual.
2. You log in there. When you see the app logged in, tell the agent "done"
   (or press Enter in the terminal). You can also just close the window.
3. The session is saved to `videos/<site>-login.json`. It includes cookies,
   localStorage, IndexedDB and sessionStorage, and the file is added to `.gitignore` because
   it holds your session. The temporary browser profile is deleted.
4. Every recording starts logged in, so the video never shows a login screen.

If the session expires, Storyshot says so ("the saved login has expired, run
login again") instead of failing in a confusing way. Use a demo account: the
video shows whatever is on screen.

## For agents: tools and playbook

The playbook is [`skills/storyshot/SKILL.md`](skills/storyshot/SKILL.md). Agents
without skill support get the same text from the `storyboard_guide` tool or
from `storyshot guide`.

| MCP tool | what it does |
|---|---|
| `storyboard_guide` | The playbook and the full YAML reference. |
| `inspect_page` | Verified click targets and a screenshot, for a URL or for the state after step N of a storyboard. Reports login walls. |
| `login` | Opens a browser window where the **user** logs in, and saves the session. |
| `init_storyboard` | Writes a starter storyboard with verified targets. |
| `check_storyboard` | Validates in about a second: typos with "did you mean", action and target shapes, `TODO`s, keys, the session file. |
| `render_video` / `render_status` | Renders in the background and returns the MP4 path, warnings, a per-step speed log and the preview image. If the render isn't done within 45 s, it returns a `job_id`, so client tool timeouts never kill a render. |

Any other MCP client: run `npx -y storyshot mcp` (stdio), and point the agent at the playbook (`storyshot guide`). When run from a git
checkout, `setup` points to `node /path/to/checkout/bin/storyshot.mjs mcp` instead.

When a step fails, the error names the step and action, and says whether the
target matched nothing or only hidden elements. It also includes a screenshot
and the clickable targets on the page at that moment, so the agent can fix the
storyboard in one round.

## CLI (scripts, CI, or by hand)

Everything the agent does is also a command:

| command | what it does |
|---|---|
| `storyshot init <url> [--purpose tutorial] [--topic export-pdf] [--storage videos/<site>-login.json]` | Write `videos/<site>-<kind>[-<topic>].yaml` with verified targets; the video gets the same name. |
| `storyshot login <url> [--save videos/<site>-login.json]` | Log in once in a browser window and save the session. |
| `storyshot inspect <url> [--storage auth.json]` | List verified targets and save screenshots. |
| `storyshot inspect videos/acme-promo.yaml --after 3` | The same, for the page after steps 1–3. |
| `storyshot check videos/acme-promo.yaml` | Validate without opening a browser. |
| `storyshot render videos/acme-promo.yaml [--draft]` | Record, then compose the video and soundtrack. |
| `storyshot compose videos/acme-promo.yaml [--draft]` | Rebuild from the last recording, in seconds. |
| `storyshot record videos/acme-promo.yaml` | Only record. |
| `storyshot guide` | Print the playbook and the reference. |
| `storyshot setup <agent>` (`cursor`, `claude`, `codex`, `gemini`, `vscode`, `windsurf`, `cline`) | Set up the MCP server and the skill in this project, and install or check what Storyshot needs. |
| `storyshot doctor` | Check Node, ffmpeg (and the filters and encoders Storyshot uses), Chromium and voices; install Chromium if it's missing. |
| `storyshot mcp` | Run the MCP server. |

Recordings, previews and voice lines are cached in `.storyshot/` next to the
YAML. Add it to `.gitignore`. `--draft` swaps a paid voice for the free one and
writes `<out>.draft.mp4`.

To avoid installing anything, use Docker (handy for CI). The image bundles
Chromium, ffmpeg and CJK fonts:

```bash
docker build -t storyshot .
docker run --rm -v "$PWD:/work" -v storyshot-cache:/root/.cache --env-file .env storyshot render videos/acme-promo.yaml
```

The examples in [`examples/`](examples/) are a 15 s pitch, a narrated tutorial
and a course lesson for the same app.

## Storyboard reference

The agent writes this file for you; this reference is for reading or editing it
by hand.

```yaml
url: https://example.com
out: acme-promo.mp4                             # relative to this file; default: <file name>.mp4
viewport: { width: 1600, height: 900 }          # CSS px the site is laid out at
output: { width: 1920, height: 1080, fps: 30 }  # same aspect ratio; use 1080x1920 with a 900x1600 viewport for vertical
theme: { accent: "#d9f75b", ink: "#0f172a", font: Inter }
music: { bpm: 120, volume: 1 }                  # or { file: track.mp3 }, or false
sfx: true                                       # click / whoosh / riser sounds; clicks = no whooshes on cards and page changes (tutorial and course default); false = none
voice: { provider: elevenlabs, voice: hpp4J3VqNfWAUOO0d1Us }   # optional voiceover, see below
storageState: auth.json                         # optional Playwright login state
ignoreHTTPSErrors: true                         # internal site with a self-signed HTTPS certificate (plain http:// needs nothing)
captionPosition: bottom                         # or top; can also be set per step. A caption that would cover a step's click target or zoom subject moves to the other side automatically
captions: true                                  # false keeps caption pills off the video (chapters and SRT still use them), e.g. with subtitles: burn
purpose: pitch                                  # pitch | tutorial | course | docs (sets the defaults below)
highlight: false                                # spotlight targets before click/type (per step or per action too)
stepNumbers: false                              # numbered caption badges
subtitles: false                                # write <out>.srt (narration, else captions); `burn` also burns the narration into the video, each word lighting up as it is spoken (captions move to the top); uses ffmpeg's libass when it has it, else draws the words itself
pace: slow                                      # fast (pitch) | normal (docs) | slow (tutorial, course): cursor and typing speed, a beat after each click, hold after narration, voice speed, how much of a wait is shown
follow: true                                    # tutorial/course default: the camera zooms in on what each step touches and pans between steps (a step's own zoom wins; follow: false on a step skips it); or { scale: 1.8 }
article: { title: Export a drawing, intro: … }  # docs: heading and first paragraph of <out>-steps/README.md
lang: es                                        # language of built-in labels ("Pause and think", chapter "Introduction", "Downloaded"): en, zh, es, pt, fr, de, ja; default: zh if the steps contain Chinese, else en
cards: auto                                     # intro/section/end cards: auto follows the frame (dark frames get dark cards), or light | dark
frame: aurora                                   # the recording sits in a browser window on a backdrop: aurora (dark, grain; pitch default), studio (light, grain; tutorial and course default), dark, pastel, blur (the page itself, blurred); false = full frame; or { style, background: <css>, window, title, icon }
                                                # window: app draws an installed app's window (its icon and name in the title bar, no address bar) for a PWA or desktop web app; title and icon come from the page's web app manifest unless given
chapters: false                                 # write <out>.chapters.txt for YouTube
clips: null                                     # gif | webm | mp4 | png, or a list (docs default: [gif, png]): one file per step in <out>-steps/, cropped to what the step touches, plus README.md, a ready-to-paste article (step captions, `doc:` text, images)
maxWait: 1.0                                    # with duration: auto, the longest a wait is shown

intro:                                          # optional title card before the recording (same fields as end_card)
  title: Acme
  subtitle: Ship **faster**
  say: Meet Acme.

setup:                                          # runs before recording starts
  - dismiss: { role: button, name: Accept cookies }

steps:
  - caption: Turn PDFs into **editable PowerPoint**   # **bold** uses the accent color
    say: Turn any PDF into an editable PowerPoint.    # voiceover line (needs `voice`)
    duration: 2.4                                     # seconds in the final video, or `auto` (fit the narration)
    zoom: { target: h1, scale: 1.2, start: 0.2, end: 2.4, ramp: [1.0, 0.4], offset: { y: 40 } }
    actions:
      - move: { x: 0.5, y: 0.4 }                      # numbers ≤ 1 are viewport fractions
      - click: { role: button, name: Try it }
  - caption: AI does the work
    duration: 1.3
    sfx: riser                                        # rising sound + chime (or `chime`)
    actions:
      - waitFor: { text: Done, timeout: 120000 }      # waiting is compressed automatically
  - card: { kicker: Part 2, title: Read the results }  # a section card before this step (tutorials); becomes a chapter
    caption: The hits table
    say: Each row is a protein similar to yours.
    actions:
      - mark: { css: "tbody tr:nth-child(1)" }
  - hidden: true                                      # cut, not shown in the video
    actions:
      - goto: /

end_card:
  logo: { alt: Company logo }                         # captured from the page, or a path to an image
  title: Acme
  subtitle: Ship **faster**
  cta: Start free at acme.com                         # duration: auto (default) fits the say line, bullets and cta, at least 2.5 s
```

Steps that share a caption keep it on screen across both steps.

### Targets

A target is either a CSS / Playwright selector string (`h1`, `nav a[href="#pricing"]`)
or an object with one of these fields:

`role` + `name` · `text` · `label` · `placeholder` · `alt` · `testId` · `css`

You can add `exact: true`, `last: true` or `nth: 2` to any of them.

### Actions

| action | example |
|---|---|
| `click` | `click: { role: button, name: Convert, ms: 800, offset: { x: 0.3, y: 0.5 } }` |
| `dblclick` | `dblclick: { text: Start }` double-clicks (e.g. to edit a label in place) |
| `move` / `hover` | `move: { text: "$0" }` or `move: { x: 0.5, y: 0.4, ms: 1200 }` |
| `type` | `type: { target: { label: Email }, text: hi@acme.com, delay: 60 }`, or `type: hello` to type into whatever has focus. `clear: true` empties a pre-filled field first |
| `drag` | `drag: { from: { css: ".slider" }, by: [{ x: -300 }, { x: 450 }] }` (several moves while held), or `to: <target or point>` |
| `press` | `press: Enter`, `press: "^"`, `press: { key: Meta+K, show: true }`. When highlighting, shortcuts and special keys show an on-screen badge; plain characters don't. `show: false` hides it. |
| `pause` | `pause: 700` (ms) |
| `waitFor` | `waitFor: { role: button, name: Done, timeout: 120000 }` |
| `waitForUrl` | `waitForUrl: "**/dashboard"` |
| `networkIdle` | `networkIdle: true` |
| `goto` | `goto: /pricing` |
| `scrollTo` | `scrollTo: { css: "#pricing", ms: 1200 }` |
| `scroll` | `scroll: 600` |
| `dismiss` | `dismiss: { role: button, name: Close }` (clicks only if visible) |
| `hide` | `hide: '[id*="QSI"], .chat-widget'` hides pop-ups, survey prompts, feedback tabs and chat widgets for the whole video, including ones that appear late (use it in `setup`) |
| `mark` | `mark: "automatic zoom, captions"` sweeps a highlighter over that phrase, even inside a paragraph (scrolling to it if needed). `mark: { css: "table tr:nth-child(3)" }` marks any target with a box. Options: `ms` (sweep time, default 700), `color` (default: theme accent), `box: true/false`. Marks stay until the step ends. |
| `unmark` | `unmark: true` clears the marks (and notes) earlier |
| `note` | `note: { target: { label: Database }, text: Curated proteins only }` puts a short label with an arrow next to the element, on the side with the most room (or `side: left/right/top/bottom`). It stays until the step ends and gets reading time (about 3 words a second, or `ms`). |
| `paste` | `paste: { target: { label: JSON }, text: '{"a": 1}' }` pastes text in one go through the real clipboard (with a ⌘V badge), so editors react as to a real paste; `paste: "..."` pastes into whatever has focus |
| `slide` | `slide: { target: { label: Quality }, to: 0.2 }` drags a slider to a position along its track (0 = start, 1 = end), found from the element, not pixels |
| `select` | `select: { target: { label: Database }, option: "UniProtKB/Swiss-Prot" }` picks an option in a dropdown (by its visible text, or part of it). `inspect` lists each dropdown's options. |

`ms` sets how long the cursor takes to travel to the target (`dragMs` for each
drag move). `highlight: true/false` on `click`, `type` or `move` overrides the
step's spotlight setting.

After each `click`, `goto`, `waitFor`, `waitForUrl`, `networkIdle` and
`press: Enter`, Storyshot waits up to 5 s for the images on screen to load and
decode. That time counts as waiting, so it is compressed in the video. Compose
warns when a step shows near-blank frames, such as an empty page with a
loading spinner.

### `duration: auto`

The cursor moves in real time. Waits are shown for at most `maxWait` seconds.
If the step's narration needs more time, the wait is first shown longer
(slower), and then the last frame is held until the line finishes. Nothing is
ever rushed, and the voice is never cut off. Use it for tutorials; for tightly
cut promos, use fixed durations.

Targets only ever match **visible** elements, so hidden copies (closed menus,
`<option>`s, mobile duplicates) are ignored. Elements below the fold are
scrolled into view automatically, including in apps that scroll an inner
container instead of the window. `dismiss` is a no-op when the element isn't
there, so it's safe for banners that only sometimes appear.

In-page anchor links (`href="#..."`) scroll smoothly instead of jumping.

### Zoom

| field | meaning |
|---|---|
| `target` | What to center on: a target, or a point `{ x: 0.5, y: 0.3 }`. If a step action used the same target, its position at that moment is used (so you can zoom on a button that disappears after the click). Otherwise it is measured at the start of the step when the zoom begins in the first half, or at the end of the step otherwise. |
| `scale` | Zoom factor (default 1.3). 1.2–1.5 works well. |
| `start`, `end` | Seconds from the start of the step. The camera eases in from 1× at `start` and is back at 1× at `end` (default: the step's end). `end` may run past the step, e.g. to hold the zoom through a click. |
| `ramp` | Ease-in / ease-out seconds: `0.5` or `[in, out]`. |
| `offset` | Moves the camera center from the target's center, in viewport CSS px. `{ y: -120 }` centers 120 px above the target. |

The camera never shows anything outside the frame. When a target sits near an
edge, the zoomed view is clamped to that edge, so the target is off-center
rather than cut off.

### Voiceover

Add a `voice` block, then give steps a `say:` line (and optionally
`end_card.say`). Each line starts as its step begins (`sayAt` shifts it) and may
run until the next line. A line that is up to 20% too long is sped up slightly.
A line longer than that is queued after the previous line, and you get a
warning telling you to shorten it. Music ducks under the voice, and the final
mix is normalized to -14 LUFS.

| provider | key (env or `.env`) | notes |
|---|---|---|
| `kokoro` (default) | none | Local and free. English voices (`af_heart`, `am_michael`, `bf_emma`, …) and Mandarin Chinese ones (`zf_001`, see below). Needs `npm i kokoro-js`; the first run downloads an ~90 MB model. |
| `qwen` | none | Local and free, Apple Silicon Macs only: Qwen3-TTS, the most natural free Chinese voice here (`serena`, see below). |
| `elevenlabs` | `ELEVENLABS_API_KEY` | Most natural, many languages including Chinese. `voice` is a voice ID; `model` defaults to `eleven_multilingual_v2`. The key needs Text to Speech access, plus Voices → Read to list voices. |
| `openai` | `OPENAI_API_KEY` | `voice: alloy`, `model: gpt-4o-mini-tts`; optional `instructions` for tone. |
| `say` | none | macOS built-in voices, robotic; fine for drafts. For Chinese, use `kokoro` with `zf_001` rather than `Tingting`. |

**Chinese narration.** `voice: { provider: kokoro, voice: zf_001 }` speaks Mandarin with Kokoro
v1.1-zh, free and local, and is what `kokoro` uses when the `say:` lines are Chinese and no voice is
named. It sounds far more natural than macOS `say -v Tingting`. Other voices: `zf_002` (female),
`zm_010`, `zm_011` (male), and others between `zf_001`…`zf_099` and `zm_009`…`zm_100` (not every
number exists). Its text-to-phoneme step (misaki) needs Python 3.10–3.12: on first use Storyshot
creates its own venv in `~/.cache/storyshot/zh-venv` (about 250 MB, under a minute; nothing is installed globally;
`STORYSHOT_PYTHON` picks the interpreter) and downloads a ~130 MB model. `storyshot doctor` says
whether it's ready. English words and letters in a line (`GeoGebra`, `y 等于 m x 加 b`) are spoken in
English, a 2 before a measure word is read 两 (`2 个单位`), and `=`, `+`, `×`, `÷`, `²` are spoken;
subtitles keep the line as written. Known issue: with every Kokoro voice, 逗号 can sound like 度号.

**Chinese on an Apple Silicon Mac: Qwen3-TTS.** `voice: { provider: qwen, voice: serena }` speaks with
[Qwen3-TTS 0.6B CustomVoice](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice) (Apache-2.0)
through [mlx-audio](https://github.com/Blaizzy/mlx-audio). It reads English words, letters and numbers
in a Chinese line more reliably than `zf_001`. Voices: `serena` (female, warm; the default for Chinese
lines), `vivian` (female, bright), `uncle_fu` (male, mellow), `dylan` (male, Beijing accent), `eric`
(male, Sichuan accent), and `ryan`, `aiden` (English), `ono_anna` (Japanese), `sohee` (Korean). On
first use Storyshot creates a venv in `~/.cache/storyshot/qwen-venv` (Python 3.10–3.12, about 400 MB)
and downloads the ~2.3 GB model into the Hugging Face cache. It speaks at about 2x real time on an M4 Pro
and peaks at about 8 GB of memory. The model samples its speech, so a line now and then runs on into
invented words or stops short. Storyshot regenerates such a take (it judges by length) and warns if
one still looks off. A scientific number like `2e-105` is spelled out in Chinese, because it sets the
model babbling. On other machines the same storyboard renders with `kokoro` (`zf_001`, or `draftVoice`),
with a note.

Other fields: `speed` (default 1), `volume` (default 1), and `pronounce`, a
map of word → spoken form used only for TTS, e.g.
`pronounce: { pxGenius: P X Genius, PPTX: P P T X }`. Subtitles keep the real
spelling. Synthesized lines
are cached in `.storyshot/tts-cache/`, so `compose` only pays for lines you
changed. Write names the way they should be pronounced (`say: P X Genius.`),
and spell out prices (`eleven ninety-nine`) in `pronounce` or in the line itself. At normal pace that comes to
about 2.5 words per second, or roughly 35 words for a 15 s video.

### Intro and end card

Every field is optional; leave out `intro` / `end_card` for none. A step's
`card` takes the same fields and plays before that step (section titles in
tutorials). Both are short
animations: the logo pops in, the title rises, the `**bold**` highlight sweeps,
and a `cta` that is a command (`npx …`, `npm …`, `pip …`, `brew …`, `curl …`)
types itself out in a terminal pill. `init` writes an `intro` for promos;
tutorials and lessons can add one (e.g. "How to export a report"), docs GIFs
usually shouldn't.

| field | meaning |
|---|---|
| `logo` | A target on the page (captured as an image, e.g. `{ alt: Acme logo }`) or a path to an image file. If the logo image already contains the wordmark, leave out `title`. |
| `title` | Large product name next to the logo. |
| `kicker` | Small label above the title, e.g. `Part 2`. |
| `subtitle` | One line; `**bold**` gets an accent highlight. |
| `image` | A picture or diagram file (png, jpg, svg) under the title: concept cards in lessons. |
| `think` | Seconds to pause after the card's `say` (a question card), with a "Pause and think" countdown. The next step shows the answer. |
| `bullets` | A numbered list that appears one item at a time: "what you'll learn" on an intro, a recap on the end card. The card stays up long enough to read it. |
| `cta` | Dark call-to-action pill, e.g. `Start free at acme.com`. |
| `duration` | Seconds. Default: fits the `say` line, else 1.0 (end card) or 2.2 (intro). |
| `say` | Voiceover line played over the end card. |
| `emblem` | With `hyperframes`: one to three short monospace lines over the title (an alignment, a formula, a line of code); `false` for none. |

### HyperFrames cards (optional)

`hyperframes: true` renders the intro, section and end cards with
[HyperFrames](https://hyperframes.heygen.com) (HeyGen's open-source HTML-to-video
renderer, Apache-2.0) for more motion. Two templates, picked by `purpose`:

- **lesson** (tutorials, courses, docs): the title lands word by word over a
  slowly drifting, blurred view of the page the section leads into; section
  cards show a progress bar of the parts; the intro's steps and the end card's
  recap points light up as the narration names them.
- **launch** (promos): hand-drawn accents (a box round the logo, an underlined
  highlight, an arrow to the call to action). The intro's paper turns into the
  browser window and its logo lands on the app's own logo in the first frame;
  the outro zooms from the last frame into the page and draws the call to
  action over it.

```yaml
hyperframes:
  template: lesson        # or launch (default: launch for pitch, lesson otherwise)
  band: MVHLTPEEKSAVTALWGKV…  # optional: text drifting behind the titles (a sequence, a formula)
  bandColors: aminoacid   # aminoacid | nucleotide | accent (default)
  emblem: [LHCDKLHVDPENFRLL, "||||||||||||+|||", LHCDKLHVDPENFKLL]  # optional, over the titles
  hand: true              # launch: hand lettering (Virgil) for the subtitle and call to action
  backdrop: false         # lesson: plain background instead of the blurred page
```

It needs Node 22 or newer. On first use storyshot installs the pinned
HyperFrames version into `~/.cache/storyshot/hyperframes/` (a local install
of the `hyperframes` package wins); its telemetry is switched off. Cards are
cached, so `compose` only re-renders the ones that changed (about 10–25 s
each). Any card that can't be rendered falls back to the built-in one with a
warning. The Virgil font is © Ellinor Rapp, SIL Open Font License 1.1
(`src/fonts/Virgil-LICENSE.md`).

## License

MIT
