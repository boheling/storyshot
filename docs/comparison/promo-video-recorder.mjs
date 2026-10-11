// promo-video-recorder choreography for the same storyline as the Storyshot promo (its defaults: 1920x1080, captions, generated music).
// Run: copy scripts/recorder-lib.mjs from github.com/palamut62/promo-video-recorder (commit 11045d9) next to this file, then `node promo-video-recorder.mjs`.
import { record } from "./recorder-lib.mjs";
const OUT = "promo-video-recorder.mp4";
const H = (t) => `article h2:has-text("${t}")`;
await record({
  url: "https://github.com/boheling/storyshot",
  out: OUT,
  width: 1920, height: 1080,
  brand: "Storyshot",
  captions: true,
  music: "generate",
  choreograph: async (h) => {
    await h.caption("Storyshot", "Product videos from your coding agent");
    await h.sleep(600);
    await h.zoomSel('[data-testid="repo-name-link"]', 1.45, 1400);
    await h.unzoom(700);

    await h.caption("One YAML storyboard in", "a polished 1080p MP4 out");
    await h.zoomSel('article h1', 1.3, 2400);
    await h.unzoom(700);

    await h.caption("Cursor, zoom, captions, voice, music", "all automatic");
    await h.zoomSel(H("What happens when you ask"), 1.3, 2600);
    await h.unzoom(700);

    await h.caption("Promos, tutorials, lessons", "and docs GIFs");
    await h.zoomSel(H("What you can make"), 1.3, 2600);
    await h.unzoom(700);

    await h.caption("Works with logged-in apps");
    await h.zoomSel(H("Logged-in apps"), 1.3, 2000);
    await h.unzoom(700);

    await h.caption("npx -y storyshot setup cursor", "Same storyboard, same video, every time");
    await h.zoomSel(H("Quick start"), 1.35, 3000);
    await h.unzoom(800);
    await h.captionHide();
  },
});
console.log("DONE:", OUT);
