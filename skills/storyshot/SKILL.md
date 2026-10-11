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
   1. Type: pitch: a 15–30 s promo (other options: tutorial = narrated how-to;
      course = narrated lesson; docs = silent step-by-step GIFs)
   2. Length: about 15 s, 6 shots
   3. Flow: hero → Examples → Try It → AI result → pricing → end card
   4. Voice: none (other options: free local English voice; ElevenLabs, best
      quality and Chinese support, key found in .env)
   5. Music: upbeat · Captions: English · Subtitle file (.srt): no
   6. Format: 16:9, 1080p (other option: 9:16 vertical)
   7. Login: not needed (or: Examples needs a login, so I'll open a browser
      window for you to log in once; please use a demo account)
   ```

   Defaults by type (propose these unless the request says otherwise):

   | type | length | voice | music | on screen / files |
   |---|---|---|---|---|
   | `pitch` | 15 s (or 30 s), 5–7 shots | optional | upbeat | captions |
   | `tutorial` | 45–90 s, 6–12 steps | yes | soft | step numbers, spotlight, .srt, chapters |
   | `course` | 1–3 min | yes | none | spotlight, .srt, chapters |
   | `docs` | one GIF per step | none | none | step numbers, spotlight, GIFs |

   Captions match the site's language. `kokoro` (free, local) speaks English
   only; for other languages, use ElevenLabs.
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

Rules of thumb from real renders:

- **One idea per step.**
  - `pitch`: 1.5–3 s per step (`duration:`). A 15 s video is 5–7 visible
    steps plus a 1–1.5 s `end_card`. Typical shape: hero → 2–4 steps of the
    core flow ending on a visible result → pricing or CTA → end card.
  - Other purposes: leave out `duration`. `auto` times each step to its
    narration and plays motion in real time.
- **Captions ≤ 7 words.** `**bold**` the payoff ("Every text box is
  **fully editable**"). Steps with the same caption keep it on screen.
- **Narration (`say:`) is not a caption.** Write full spoken sentences, one
  instruction or idea per step. Use normal spelling, and put pronunciations in
  `voice.pronounce` (e.g. `pxGenius: P X Genius`, `AI: A I`) so subtitles stay
  correct. For fixed durations, budget about 2.5 words per second.
- **Isolate long waits** (AI processing, uploads) in their own step: a
  `waitFor` the finished state, `sfx: riser`, and in `pitch` mode
  `duration: 1.0–1.5`. Waiting is compressed automatically.
- **Zoom sparingly**, on 2–4 payoff moments (headline, clicked button, result,
  price), with `scale: 1.2–1.5`.
- **Show the signature interaction.** Use `drag` for sliders and before/after
  views (`drag: { from: { x: 0.57, y: 0.5 }, by: [{ x: -300 }, { x: 400 }] }`;
  `from` can be a target or a point). Use `type` for inputs: `type: y=x^2`
  types into whatever has focus (for editors and canvases with hidden inputs),
  and `type: { target: …, text: … }` clicks the target first. `press: Enter`
  and `press: "^"` send single keys. In `tutorial`/`course`, the spotlight
  highlights each click target automatically; add `highlight: true` to a
  `move` to point at something without clicking it.
- **Cut boring navigation** with a `hidden: true` step (e.g. `goto: /pricing`).
- **Clean the frame** in `setup`: dismiss cookie banners, announcement bars and
  chat widgets. `dismiss` is a no-op when the element isn't there.
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
- The end card's duration fits its `say:` line automatically; leave out
  `duration` there.
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
