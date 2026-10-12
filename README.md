# Storyshot

Ask your coding agent for a video of your web app, and get a polished 1080p
MP4: a promo clip, a narrated tutorial, a lesson, or step-by-step GIFs for your
docs.

> *"make a 15 s promo video of https://myapp.com"*

Storyshot gives Cursor, Claude Code and other coding agents what they need to
do this well. A real browser clicks through your site, and the recording gets
a smooth cursor, automatic zoom, captions, an optional AI voiceover, music
and an end card. Loading time is squeezed out, so a 30-second AI job takes a
second or two on screen.

The agent plans, writes and fixes the storyboard. Storyshot does the
recording and editing, and the same storyboard always renders the same video.

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

Open your project in Cursor or Claude Code and paste this into the agent chat:

> Set up Storyshot in this project: run `npx -y storyshot setup cursor` (use
> `setup claude` in Claude Code) and do everything it says. Then make a 15 s
> promo video of https://myapp.com

The agent does the rest:
- `setup` writes the MCP server config and the Storyshot skill, adds
  `.storyshot/` to `.gitignore`, and downloads the browser it needs.
- If ffmpeg is missing, setup prints the exact install command for your OS
  (`brew install ffmpeg`, `winget install --id Gyan.FFmpeg -e`,
  `sudo apt-get install -y ffmpeg`). The agent runs it after you approve.
- The agent reads the skill and starts on your video in the same chat, using
  the CLI.

Reload Cursor (or restart Claude Code) when convenient. From the next chat on,
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
   1. Type: pitch: a 15–30 s promo
   2. Length: about 15 s, 6 shots
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
| a promo / launch / landing-page clip | `pitch` | 15–30 s, music, captions, tightly cut |
| a how-to or onboarding video | `tutorial` | narrated, a spotlight on each click, numbered steps, soft music, `.srt` + chapters |
| a lesson or explainer | `course` | narrated and explains the *why*, no music, `.srt` + chapters |
| help-center snippets | `docs` | silent, one GIF per step |

Any type can also be vertical (9:16) or in another language.

## Voice and cost

Rendering is free and runs locally. Only the voiceover can cost money:

| voice | cost | notes |
|---|---|---|
| none | free | captions only |
| `kokoro` | free | local, English only; downloads a ~90 MB model on first use |
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

Other MCP clients: run `npx -y storyshot mcp` (stdio). When run from a git
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
| `storyshot setup cursor\|claude` | Set up the MCP server and the skill in this project, and install or check what Storyshot needs. |
| `storyshot doctor` | Check Node, ffmpeg, Chromium and voices; install Chromium if it's missing. |
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
sfx: true                                       # click / whoosh / riser sounds
voice: { provider: elevenlabs, voice: hpp4J3VqNfWAUOO0d1Us }   # optional voiceover, see below
storageState: auth.json                         # optional Playwright login state
ignoreHTTPSErrors: true                         # internal site with a self-signed HTTPS certificate (plain http:// needs nothing)
captionPosition: bottom                         # or top; can also be set per step. A caption that would cover a step's click target or zoom subject moves to the other side automatically
purpose: pitch                                  # pitch | tutorial | course | docs (sets the defaults below)
highlight: false                                # spotlight targets before click/type (per step or per action too)
stepNumbers: false                              # numbered caption badges
subtitles: false                                # write <out>.srt (narration, else captions); `burn` also burns the narration into the video, each word lighting up as it is spoken (captions move to the top)
pace: slow                                      # fast (pitch) | normal (docs) | slow (tutorial, course): cursor and typing speed, a beat after each click, hold after narration, voice speed, how much of a wait is shown
follow: true                                    # tutorial/course default: the camera zooms in on what each step touches and pans between steps (a step's own zoom wins; follow: false on a step skips it); or { scale: 1.8 }
frame: true                                     # pitch default: the recording sits in a browser window on a backdrop; false = full frame, or { background: <css> }
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
  cta: Start free at acme.com
  duration: 1.0
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
| `move` / `hover` | `move: { text: "$0" }` or `move: { x: 0.5, y: 0.4, ms: 1200 }` |
| `type` | `type: { target: { label: Email }, text: hi@acme.com, delay: 60 }`, or `type: hello` to type into whatever has focus |
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
| `mark` | `mark: "automatic zoom, captions"` sweeps a highlighter over that phrase, even inside a paragraph (scrolling to it if needed). `mark: { css: "table tr:nth-child(3)" }` marks any target with a box. Options: `ms` (sweep time, default 700), `color` (default: theme accent), `box: true/false`. Marks stay until the step ends. |
| `unmark` | `unmark: true` clears the marks (and notes) earlier |
| `note` | `note: { target: { label: Database }, text: Curated proteins only }` puts a short label with an arrow next to the element, on the side with the most room (or `side: left/right/top/bottom`). It stays until the step ends and gets reading time (about 3 words a second, or `ms`). |
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
| `kokoro` (default) | none | Local and free; English voices only (`af_heart`, `am_michael`, `bf_emma`, …). Needs `npm i kokoro-js`; the first run downloads an ~90 MB model. |
| `elevenlabs` | `ELEVENLABS_API_KEY` | Most natural, many languages including Chinese. `voice` is a voice ID; `model` defaults to `eleven_multilingual_v2`. The key needs Text to Speech access, plus Voices → Read to list voices. |
| `openai` | `OPENAI_API_KEY` | `voice: alloy`, `model: gpt-4o-mini-tts`; optional `instructions` for tone. |
| `say` | none | macOS built-in voices, robotic; fine for drafts. |

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

## License

MIT
