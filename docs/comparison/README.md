# Storyshot vs. similar open-source tools

Three tools made a promo video of the same page
([github.com/boheling/storyshot](https://github.com/boheling/storyshot)) with
the same storyline: intro → what it does → what you can make → logged-in apps →
install command. None of them used a paid voice. Runs were on macOS with
ffmpeg 8.0.1, on 2026-10-11.

| | Storyshot 0.1.3 | [promo-video-recorder](https://github.com/palamut62/promo-video-recorder) (commit 11045d9) | [demo-dev](https://www.npmjs.com/package/demo-dev) 0.0.2-alpha.0 |
|---|---|---|---|
| Input | YAML storyboard ([storyshot-promo.yaml](storyshot-promo.yaml)) | JS choreography ([promo-video-recorder.mjs](promo-video-recorder.mjs)) | One prompt; the AI plans the scenes (command below) |
| Length | 30.2 s | 23.4 s | 30.6 s |
| Output | 1920×1080, 30 fps | 1920×1080, 30 fps | 1536×1048, 60 fps |
| Voice | Local Kokoro voice, timed to each step | None (not supported) | macOS `say` |
| Music and sound | Synth track, whoosh | Generated ambient pad | None |
| Captions | Large, with highlighted words; moved away from what's being shown | Small caption card | Small caption card |
| Ending | End card with title, tagline and install command | None | Title card at the start, none at the end |
| What we saw | One caption appears a moment before its scroll finishes | Zoom and scroll jump instead of easing; the watermark covers GitHub's logo | The plan spent the first ~12 s on GitHub's home page; two blank white frames (~2 s, ~19 s); last ~8 s are a still frame; never reached the install command |

## How each video was made

- **Storyshot:** `storyshot render docs/comparison/storyshot-promo.yaml`.
- **promo-video-recorder:** the choreography follows its SKILL.md and uses its
  `recorder-lib.mjs` unchanged. Its documented defaults are 1920×1080,
  `captions: true` and `music: "generate"`. One selector from the first draft no
  longer exists on GitHub and was replaced with `[data-testid="repo-name-link"]`.
- **demo-dev:**
  ```
  DEMO_AI_PROVIDER=claude DEMO_TTS_PROVIDER=local npx demo-dev@0.0.2-alpha.0 demo \
    --base-url https://github.com/boheling/storyshot --frame --quality high \
    --prompt "A 30-45 second promo video for Storyshot, an open-source tool that turns a YAML storyboard into a polished product demo video. Show the repo page, the README intro, scroll to the key features and how it works, and end on the npm install command."
  ```
  With ffmpeg 8 the final step fails when the AI-written title has a colon,
  because `escapeFFmpegText` in `src/render/ffmpeg-compose.ts` escapes `:`
  before `\`. We swapped the order (backslashes first) and ran it again;
  without that change it produces no video.

## Caveats

- Storyshot's author wrote the Storyshot storyboard, and knows that tool best.
- demo-dev plans with an AI at run time, so another run can come out better or
  worse. This is the second run; the first one hit the ffmpeg error above.
- Each tool has strengths this test doesn't show. demo-dev needs only a prompt
  and adds a browser frame on a gradient background. promo-video-recorder can
  post the video to X.
