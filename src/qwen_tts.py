# Qwen3-TTS CustomVoice through mlx-audio (Apple Silicon), for `voice: { provider: qwen }`. Runs in
# storyshot's own venv (qwen-tts.mjs), one process per render: the model loads once for all lines.
#
# stdin:  {"repo", "revision", "temperature", "lines": [{"text", "file", "voice", "lang", "seed"}]}
# stderr: "line i/n <seconds>s [<tries> tries]" per line, plus whatever the libraries log
# stdout: {"results": [{"seconds", "tries", "suspect"}]}
#
# The model samples its speech tokens, so now and then a line runs on into made-up words (a
# scientific number like 2e-105 does it) or stops early. A take far longer or shorter than the text
# should need is sampled again with another seed, and the closest one is kept.
import contextlib
import json
import os
import re
import sys

os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
os.environ.setdefault('TRANSFORMERS_VERBOSITY', 'error')

TRIES = 4


def expected(text):
    """Rough speaking time in seconds: ~3.6 Chinese characters a second, Latin words and numbers."""
    han = len(re.findall(r'[㐀-鿿]', text))
    words = len(re.findall(r'[A-Za-z]+', text))
    nums = len(re.findall(r'\d+(?:\.\d+)?', text))
    return han / 3.6 + words * 0.4 + nums * 0.5 + 0.3


def plausible(seconds, est):
    return 0.35 * est - 0.5 <= seconds <= 2.0 * est + 2.0


def main():
    job = json.load(sys.stdin)
    out = sys.stdout
    # the libraries print their own notes on stdout: keep it for the JSON answer
    with contextlib.redirect_stdout(sys.stderr):
        import math
        import mlx.core as mx
        import numpy as np
        from huggingface_hub import snapshot_download
        from mlx_audio.audio_io import write
        from mlx_audio.tts.utils import load_model

        model = load_model(snapshot_download(job['repo'], revision=job['revision']))
        results, n = [], len(job['lines'])
        for i, line in enumerate(job['lines']):
            est = expected(line['text'])
            best = None
            for k in range(TRIES):
                mx.random.seed(line['seed'] + k * 7919)
                parts = model.generate(text=line['text'], voice=line['voice'], lang_code=line['lang'],
                                       temperature=job['temperature'])
                audio = np.concatenate([np.array(r.audio, dtype=np.float32) for r in parts])
                seconds = len(audio) / model.sample_rate
                score = abs(math.log(max(seconds, 0.1) / est))
                if best is None or score < best[0]:
                    best = (score, audio, seconds)
                if plausible(seconds, est):
                    break
            write(line['file'], best[1], model.sample_rate)
            results.append({'seconds': best[2], 'tries': k + 1, 'suspect': not plausible(best[2], est)})
            print(f'line {i + 1}/{n} {best[2]:.1f}s' + (f' {k + 1} tries' if k else ''), file=sys.stderr, flush=True)
    out.write(json.dumps({'results': results}))


if __name__ == '__main__':
    main()
