---
name: storyshot
description: Make videos of a web app with Storyshot — promo/demo clips, narrated how-to tutorials, teaching walkthroughs, or per-step GIFs for docs (smooth cursor, auto zoom, captions, voiceover, music). Use when the user asks for a demo video, promo or launch clip, product walkthrough, tutorial or onboarding video, course/lesson video, or GIFs of their website or web app.
---

# Making videos with Storyshot

Storyshot drives a real browser through a site according to a YAML storyboard,
then retimes, zooms, captions, narrates and scores the recording into an MP4.
Your job: **look → confirm the brief with the user → write the storyboard →
check → render → look at the preview → fix → repeat**, then deliver.

A render takes 1–3 minutes and a paid voice costs credits, so a wrong guess
about what the user wants is the most expensive mistake. Confirm the brief
once, up front, before writing anything.

## Tools

Use the `storyshot` MCP tools if they are available. Otherwise use the CLI:
`npx storyshot <cmd>`, or `node <checkout>/bin/storyshot.mjs <cmd>`.

| step | MCP tool | CLI |
|---|---|---|
| read this playbook + full YAML reference | `storyboard_guide` | `storyshot guide` |
| starter storyboard with verified targets | `init_storyboard` | `storyshot init <url> --purpose tutorial --topic export-pdf` |
| list clickable targets on a page (+ login check) | `inspect_page` (`url`) | `storyshot inspect <url>` |
| …on a page reached by clicking through | `inspect_page` (`storyboard`, `after_step`) | `storyshot inspect videos/<name>.yaml --after 3` |
| user logs in once (apps behind a login) | `login` | `storyshot login <url>` |
| validate after every edit (1 s) | `check_storyboard` | `storyshot check videos/<name>.yaml` |
| record + render (1–3 min) | `render_video` → `render_status` if it returns a `job_id` | `storyshot render videos/<name>.yaml` |
| re-render without re-recording | `render_video` mode `compose` | `storyshot compose videos/<name>.yaml` |
| free draft voice | `render_video` `draft: true` | `--draft` |

Always pass **absolute paths** to MCP tools.

Missing pieces install themselves: Chromium downloads on first use. If ffmpeg
is missing, a tool says so and gives the install command. Run that command
yourself (with the user's approval), then retry. `storyshot doctor` checks
everything.

**Never fake the video.** Storyshot records the real site in a real browser. If
the browser can't start (an agent sandbox that blocks it, a missing Chromium),
or the tools keep failing, stop and tell the user what blocked it and how to
allow it. Never produce a substitute: no mock-ups, redrawn screens, scripted
frames or stock footage presented as a recording of their app.

## 1. Look, then confirm the brief

1. **Look first.** `inspect_page` the start URL (about 5 s). Note what the site
   is, its language, and the login status at the top of the result:
   - `⚠ LOGIN REQUIRED`: the page is behind a login. See step 3.
   - `ℹ Login: the site has a "Log in" button`: the public pages work, but
     anything after logging in needs a session. Ask whether the flow goes there.
   Also check (without printing it) whether `.env` has `ELEVENLABS_API_KEY`.
2. **Ask once, with a pre-filled proposal.** Send ONE message with your best
   guess for every item, so the user can reply "ok" or change one line. In
   Claude Code, use AskUserQuestion (at most 4 questions, the recommended
   option first). In Cursor and other agents, send a short numbered list and
   wait for the reply. Skip this only if the request already settles every
   item, or the user said not to ask.

   ```
   Here's the plan. Reply "ok", or change any line:
   1. Type: pitch: a promo for the landing page (other options: tutorial =
      narrated how-to; course = narrated lesson; docs = silent step-by-step GIFs)
   2. Length: about 20 s, 6 shots (it follows from the flow below)
   3. Flow: hero → Examples → Try It → AI result → pricing → end card
   4. Voice: none (other options: free local voice, English or Chinese;
      ElevenLabs, best quality, key found in .env)
   5. Music: upbeat · Captions: English · Subtitle file (.srt): no
   6. Format: 16:9, 1080p (other option: 9:16 vertical)
   7. Login: not needed (or: Examples needs a login, so I'll open a browser
      window for you to log in once; please use a demo account)
   ```

   Defaults by type (propose these unless the request says otherwise). There
   is no target length: it follows from the purpose and the content. Estimate
   it from the flow and say it in the plan, so the user can react.

   | type | length comes from | voice | music | on screen / files |
   |---|---|---|---|---|
   | `pitch` | where it's shown and its one message: a landing-page loop or social clip is a handful of shots; a launch video can tell a longer story | optional | upbeat | captions, intro, frame |
   | `tutorial` | every step of the workflow, each explained, plus a second example; as long as that takes | yes | soft | step numbers, spotlight, camera follows, part cards, recap, .srt, chapters |
   | `course` | the concepts to teach: each idea, shown in the app, checked with a question | yes | none | spotlight, camera follows, concept and question cards, recap, .srt, chapters |
   | `docs` | one clip per step, each just long enough to see its result | none | none | step numbers, spotlight, cropped GIFs + PNGs, README.md article |

   Captions match the site's language. `kokoro` (free, local) speaks English
   and Mandarin Chinese: for Chinese lines use `voice: { provider: kokoro,
   voice: zf_001 }` (the default for Chinese `say:` lines), not macOS `say -v
   Tingting`, which sounds robotic. It needs Python 3.10–3.12 and sets up its
   own venv on first use (`doctor` reports it). On an Apple Silicon Mac, the
   best free Chinese voice is `voice: { provider: qwen }` (Qwen3-TTS: `dylan`,
   a male teacher's voice, for tutorials and lessons; `serena`, female, for
   promos; those are the defaults): clearer than
   zf_001 with English words and letters, about 2x real time, ~3.3 GB of
   models on first use. Storyshot listens to each take and makes it again if
   it comes out garbled; a `⚠ qwen: … sounds like "…"` warning means a line
   still came out wrong after 4 tries: rephrase it (spell out a number, say
   `一格` for `1 格`). Elsewhere a `qwen` storyboard renders with kokoro.
   `qwen` also reads Spanish, French, German, Italian and Portuguese: set the
   storyboard's `lang` (`lang: es`). For other languages, use ElevenLabs.
   Never publish a video narrated with macOS `say`: Apple's license allows its
   voices only for personal, non-commercial use, so keep it for drafts.
3. **Login.** If the flow needs a logged-in page:
   - Tell the user a browser window will open and that they should log in
     there, preferably with a demo account (the video shows whatever is on
     screen).
   - Call `login` with a URL behind the login. It opens a normal Chrome
     window and returns at once. Tell the user to log in there and, once the
     app shows them logged in, to leave the window open and reply "done".
     Nothing watches the window meanwhile (Google sign-in breaks if a script
     probes it), so wait for their reply.
   - Then call `login` again with the same URL and `done: true`. It saves the
     session to `videos/<site>-login.json`, adds it to `.gitignore` and closes
     the window. (CLI: `storyshot login <url>`, then press Enter.)
   - Pass that file as `storage_state` to `inspect_page` and `init_storyboard`,
     and add `storageState: <site>-login.json` to the storyboard.
   - Never ask for, store or type a password, and never write login steps.
   - If a later result says the login expired, call `login` again.

## 2. Explore — never guess selectors

1. `init_storyboard` with the start URL, purpose (and `storage_state` if
   logged in), and a short `topic` for tutorials and lessons. It writes
   `videos/<site>-<kind>[-<topic>].yaml` (kind = promo, tutorial, lesson or
   docs; the MP4 gets the same name, e.g. `videos/acme-tutorial-export-pdf.mp4`)
   with working first steps. Don't rename it to "demo". Verified targets for that
   page are listed as comments at the bottom, and a screenshot comes back.
2. For every other page the flow visits, call `inspect_page` with its `url`.
3. For states you can only reach by clicking (an editor after an upload, an
   open menu, a modal), write the steps up to that point, then call
   `inspect_page` with `storyboard` + `after_step: N`. It runs steps 1..N fast
   (about 10 s) and lists the targets on the page at that moment.
4. Copy targets exactly as printed: `{ role: "button", name: "Convert", exact: true }`.
   - `name` is the accessible name. It can differ from the label on screen;
     inspect shows `(on screen: "Export Image")` when it does. Never write a
     target from what the screenshot says.
   - Elements marked ↓ are below the fold. Actions scroll to them
     automatically.
   - Screenshots are in the same CSS pixels as the viewport. `at (x, y)` is
     an element's centre, usable as a point target.
   - Text inputs and code editors are listed as `role: "textbox"`. Click one,
     then use `type: …`.

## 3. Write the storyboard

### Tutorials and lessons are not ads

A promo shows as much as possible, fast. A tutorial does the opposite: the
viewer has to be able to **do it themselves** afterwards, often in a technical
or scientific tool they have never seen. Storyshot paces `tutorial` and
`course` slowly by default (`pace: slow`: slower cursor and typing, a beat
after every click, a hold after every narration line, slower voice, real
progress shown for waits) and the camera follows the action (`follow`), so
small controls are readable. Your job is the structure:

- **Start with the goal**: an `intro` with `bullets` saying what the viewer
  will be able to do ("Run a BLAST search", "Read the hits table", "Judge a
  match by E-value"), and what they need beforehand.
- **Split the workflow into parts**, each opened by a `card`
  (`card: { kicker: Part 2, title: Read the results }` on its first step).
  Cards become the YouTube chapters.
- **One action per step.** Each click, field or choice is its own step with
  its own `say:` explaining **what** it does and **why this value**. Never
  "fill in the form and submit" in one line. `check` warns when a tutorial
  step does more than two things.
- **Show, then explain the result.** After an action that produces output
  (a results table, a number, a plot, a status), add a step that only looks:
  `mark` the value or row you're talking about (`mark: "E value"`,
  `mark: { css: "tbody tr:nth-child(1)" }`), and say what it means and how to
  judge it ("an E-value this small means the match is not by chance").
- **Label the controls that matter.** `note: { target: …, text: "FASTA or accession" }`
  puts a short callout with an arrow next to a field, button or column. Use it for
  the one thing a newcomer would get wrong, not for everything.
- **Dropdowns:** `select: { target: …, option: "…" }` (inspect lists the
  options). Say why this option.
- **Then a different example.** Run the workflow again with a second input
  that behaves differently (another sequence, sample, parameter), and point
  out what changed and why. Comparison is what makes the concept stick.
  A short `card` ("Now a second example") separates it.
- **Lessons (`course`) explain the why.** Use concept cards for ideas that
  aren't on screen (`card: { kicker: Concept, title: …, bullets: […], image:
  diagram.svg }`), and question cards before a reveal (`card: { kicker:
  Question, title: "Which hit is the real homolog?", think: 3 }`, then the
  next step marks the answer).
- **Docs GIFs (`docs`)** become a help-center article: each step's clip is
  cropped to what it touches and holds the result before looping; a PNG of
  each result and `<out>-steps/README.md` are written too. Give every step a
  short `caption` (the heading) and a `doc:` line (the article text), and
  `note` the field the reader must not miss. Set the article's heading and
  first paragraph with `article: { title: …, intro: … }`. Downloads show a
  "Downloaded" bubble; `paste` and copy-to-clipboard work.
- **Animated cards that help explain.** Tutorials and lessons render their
  cards with HyperFrames by default (Node 22+; it installs itself on first
  use): titles land word by word, and each bullet lights up when the `say`
  line names it, so write the bullets in the narration's own words. Use them:
  a concept card for every idea that isn't on screen (the idea as the title,
  its 2–4 steps as bullets, a formula or a line of code as `emblem`), a
  question card for each check, and a recap end card. For a subject with its
  own material, give every title a backdrop from it:
  `hyperframes: { band: <a sequence or formula>, emblem: [<1–3 short lines>] }`.
  For a promo, `hyperframes: true` gives the launch template with hand-drawn
  accents (`hand: true` for hand lettering). `hyperframes: false` keeps the
  built-in cards.
- **End with a recap**: `end_card` with `bullets` listing the steps or rules
  to remember, and a `say` that repeats them.
- **Narrating real results.** You can't know the numbers (scores, counts,
  E-values) before the app produces them. Write the result steps with
  general narration, render once, read the actual values from the preview
  frames, then rewrite those `say:`/`note`/caption lines with the real
  numbers and run `compose` only (no re-recording, no new jobs).
- **Waiting is part of the lesson.** Long computations are still compressed,
  but say what is happening ("BLAST is now comparing your sequence against
  the database; this usually takes under a minute").
- Length follows the content. Don't cut explanation to hit a length, and
  don't pad: if a part is long, split it into more parts rather than
  speeding it up.

### Writing the narration

Viewers notice three things first: lines that run together, phrasing nobody
says out loud, and an explanation that jumps around. Write the `say:` lines as
a script before the steps around them, then read them in order on their own.
They should sound like one person talking a friend through it.

**Say it like a person.**
- Short sentences, one idea each: about 15 words at most in English, 25
  characters in Chinese. If you would run out of breath, split it.
- Spoken words: contractions ("you'll", "it's"), "you", present tense, active
  voice. In Chinese, 口语 rather than 书面语: "点一下这里", not "进行点击操作".
- Use the exact labels on screen, and the same term every time (no synonyms
  for variety).
- Each sentence gets a breath after it: Storyshot widens the pause between
  sentences to at least `voice.pause` (0.3 s for `pitch`, 0.6 s for tutorials
  and lessons). Commas get no extra pause, so split long lines into sentences
  rather than chaining clauses with commas.
- For fixed durations, budget about 2.5 words a second in English and 4
  characters a second in Chinese, and leave silence while the screen is busy.

**Cut the phrases that mark text as machine-written** (`check` flags the
common ones):
- Contrasts that only add weight: "not just X, but Y", "it's not X, it's Y".
- Inflated words: seamless, effortless, powerful, robust, unlock, elevate,
  supercharge, revolutionize, leverage, cutting-edge, game-changer, delve;
  "in today's fast-paced world". In Chinese: 赋能, 助力, 一站式, 全方位, 极致,
  无缝, 轻松搞定, 不仅……更……, 让我们一起.
- Openers and closers that say nothing: "Let's dive in", "Ever wondered…?",
  "And that's it!", "Simple as that."
- Three adjectives in a row, line after line ("fast, simple and powerful").
- Filler that talks down to a stuck viewer: basically, simply, just, easily.
- Dashes (—) in `say:` lines. Voices read them as a run-on; use a period.

**Explain in an order the viewer can follow** (tutorials and lessons):
1. The question or the goal ("How does b move the line?").
2. A concrete case on screen first: change the value, show the result.
3. Then name the idea, in plain words, the first time it appears.
4. Why it works, in one or two sentences, with a concept card if it isn't on
   screen (its bullets light up as you name them; a formula goes in `emblem`).
5. A check: a question card, then the step that reveals the answer.
6. The recap, in the same words as before.

Every step answers the question the step before it raised. Link them out loud:
"Now that b has moved the line up, let's see what m does." When the camera
has to go somewhere else on the page, say why first ("The results are further
down, in the table."). If a line only makes sense with the video, or the
script reads as a list of disconnected facts, reorder the steps before you
render.

(These rules borrow from [humanizer](https://github.com/blader/humanizer) and
[stop-slop](https://github.com/hardikpandya/stop-slop), both MIT.)

Rules of thumb from real renders (promos and tutorials):

- **One idea per step.**
  - `pitch`: 1.5–3 s per step (`duration:`), so the viewer gets one beat per
    shot; the number of shots comes from the story, plus an `end_card` held long enough to read its call to action (at least 2.5 s; leave its `duration` out). Typical shape: `intro` → hero → 2–4
    steps of the core flow ending on a visible result → pricing or CTA → end
    card. Promos sit in a browser window on a backdrop (`frame: false` turns
    that off). For an app people install (a PWA, or a desktop app built on
    web tech), use `frame: { window: app }`: the title bar shows the app's
    icon and name, not an address bar.
  - Other purposes: leave out `duration`. `auto` times each step to its
    narration and plays motion in real time.
- **Captions ≤ 7 words.** `**bold**` the payoff ("Every text box is
  **fully editable**"). Steps with the same caption keep it on screen.
- **Narration (`say:`) is not a caption.** Write full spoken sentences, one
  instruction or idea per step. Use normal spelling, and put pronunciations in
  `voice.pronounce` (e.g. `pxGenius: P X Genius`, `AI: A I`) so subtitles stay
  correct. For fixed durations, budget about 2.5 words per second.
- **Isolate long waits** (AI processing, uploads) in their own step: a
  `waitFor` the finished state. In `pitch` mode add `sfx: riser` and
  `duration: 1.0–1.5`. In tutorials and lessons, say what is happening
  instead; at most `sfx: chime` when the result arrives (a riser there plays
  only its chime). Waiting is compressed automatically.
- **Zoom sparingly**, on 2–4 payoff moments (headline, clicked button, result,
  price), with `scale: 1.2–1.5`.
- **Show the signature interaction.** Use `slide` for sliders:
  `slide: { target: <the slider inspect lists>, value: 3 }` lands on that value
  (`to: 0..1` for sliders that don't report a range). Use `drag` for before/after
  views (`drag: { from: { x: 0.57, y: 0.5 }, by: [{ x: -300 }, { x: 400 }] }`;
  `from` can be a target or a point). Use `type` for inputs: `type: y=x^2`
  types into whatever has focus (for editors and canvases with hidden inputs),
  and `type: { target: …, text: … }` clicks the target first. `press: Enter`
  and `press: "^"` send single keys. In `tutorial`/`course`, the spotlight
  highlights each click target automatically; add `highlight: true` to a
  `move` to point at something without clicking it.
- **Point at what the narration names.** `mark: "the exact phrase"` sweeps a
  highlighter over words on the page (or `mark: <target>` boxes a table row,
  card or code line) while the voice says them. On text-heavy pages a mark
  plus a zoom tells the viewer where to look.
- **Static pages (a landing page, docs, a README) have nothing to click.**
  Don't make a slideshow of scrolls: open with an `intro` (the promise),
  `mark` the claims as they are spoken, zoom on 2–3 of them, and end on a
  command or URL. If the product has a real flow, show that instead.
- **Cut boring navigation** with a `hidden: true` step (e.g. `goto: /pricing`).
- **Clean the frame** in `setup`: dismiss cookie banners and announcement bars
  (`dismiss` is a no-op when the element isn't there), and `hide` survey
  pop-ups, feedback tabs and chat widgets, which often appear late.
- **Keep the caption off the subject.** Captions sit bottom-centre. When one
  would cover a target the step clicks, hovers, types into or drags, or the
  zoom subject, it moves to the top automatically (with a warning). Other things
  aren't detected: if a payoff that isn't a target, a heading, or the app's own
  bottom toolbar is under the caption, set `captionPosition: top` (or `bottom`)
  on that step yourself.
- **Say what you show.** A caption claims something ("Every text box is
  **fully editable**"), so the step must demonstrate it: click the text layer,
  drag the compare slider, type into the field. A cursor drifting over the
  result proves nothing.
- **Elements without stable names** (e.g. buttons that show live counts) can
  be clicked by point: `click: { x: 196, y: 194 }`. Values > 1 are CSS px;
  values ≤ 1 are fractions of the viewport. The same applies to zoom
  `target`, `drag` `from`/`to`, and `move`. Take positions from inspect's
  `at (x, y)`.
- Never put real credentials in a storyboard. For logged-in apps, use
  `storageState` (see step 1).
- Internal sites: `http://` URLs just work. If an `https://` internal site
  fails with an untrusted certificate, add `ignoreHTTPSErrors: true` (inspect/init:
  `ignore_https_errors`). Never turn it on for public sites.

Run `check_storyboard` after every edit, and fix every ✖ before rendering. It
checks structure, typos and leftover `TODO`s, but not whether targets exist on
the page. Test new targets with `inspect_page` + `after_step`, which is much
faster than a failed render.

Notes:
- The end card's duration fits its `say:` line, bullets and `cta`
  automatically (never under 2.5 s); leave out `duration` there.
- Compose warns about **dead air**: 3 s or more where nothing moves and
  nothing is said. Shorten the wait or pause, hide the load in a `hidden`
  step, or narrate it. Keep `intro` cards to 6–8 s.
- With `subtitles: burn`, the top caption pills can repeat the subtitles;
  `captions: false` keeps them off the video (chapters and SRT still use them).
- `.storyshot/` next to the YAML is a cache of recordings, screenshots and
  voice lines. Add it to `.gitignore`.

## 4. Render, look, fix

1. `render_video` (use `draft: true` while iterating if the voice is
   ElevenLabs/OpenAI). If it answers with a `job_id`, call `render_status`
   until it finishes. Don't start a second render of the same storyboard
   meanwhile.
2. **Look at the preview image** (one frame per step at its zoom peak, with
   time and caption). For each frame, check: is the right thing on screen, is
   the caption readable and off the subject, does the zoom frame the subject?
   The log gives each step's speed. `motion x1.0` is real time, `x2` plays
   twice as fast, `x0.5` half speed. `waiting x20` means a wait was squeezed
   20×, which is expected.
3. Fix every ⚠ warning:
   - **rushed** (motion above x2.5): raise `duration`, or shorten `pause`/`ms`.
   - **slow motion** (below x0.5): lower `duration`.
   - **narration too long**: shorten the line or lengthen the step.
   - **zoom target not found**: fix the target.
   - **caption moved to the top/bottom**: it would have covered a target. Check
     that the new side doesn't cover something else, then set
     `captionPosition` explicitly to silence it. "covers … at both top and
     bottom": shorten the caption or change the zoom.
   - **near-blank frames** (an empty page with a spinner): the step shows a
     page loading. Move the click that loads it, plus a `waitFor` for the
     loaded content, into the previous step's end or a `hidden: true` step.
   - Images on screen are waited for automatically after each click,
     navigation and wait (up to 5 s), so empty image boxes mean an image took
     longer than that. Add a `waitFor` on something inside the loaded content.
   - A zoom on something near the edge of the screen is clamped to the
     frame, so the subject ends up off-centre. That's expected; use a smaller
     `scale` or skip the zoom.
4. **If a step fails**, the error names the step and action, says whether the
   target matched nothing or only hidden elements, and includes the page's
   clickable targets plus a screenshot at that moment. Use those targets.
5. Choose the re-render mode:
   - Changed **actions**, **setup**, or a zoom's element `target` (positions
     are measured while recording): `render`.
   - Changed only captions, `say` lines, durations, zoom
     scale/timing/point targets, voice, music or the end card: `compose`
     (seconds, no re-recording).
   - Draft looks right: `compose` with `draft: false` for the final voice.
     Only lines not yet synthesized cost credits. `draft` only matters with
     a paid voice; with `kokoro`, it is the same voice either way.

## 5. Deliver

Give the user:
- the MP4 path (plus `.srt` / chapters / step GIFs if they were made);
- a short shot list (time → what's shown → caption);
- what was sped up (e.g. "the ~30 s AI conversion is shown in 6 s").

Offer the natural next variants: another purpose, a vertical cut, another
language, or their own music (`music: { file: … }`).
