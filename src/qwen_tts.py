# Qwen3-TTS CustomVoice through mlx-audio (Apple Silicon), for `voice: { provider: qwen }`. Runs in
# storyshot's own venv (qwen-tts.mjs), one process per render: the model loads once for all lines.
#
# stdin:  {"repo", "revision", "temperature", "asr": {"repo", "revision"} | null,
#          "lines": [{"text", "file", "voice", "lang", "seed"}]}
# stderr: "line i/n <seconds>s [<tries> tries]" per line, plus whatever the libraries log
# stdout: {"results": [{"seconds", "tries", "suspect", "heard", "mismatch"}], "asr": null | "why it didn't load"}
#
# The model samples its speech tokens, so now and then a take garbles a few words, drops one, runs on
# into made-up words (a scientific number like 2e-105 does it) or stops early. Each take is checked:
# its length against the text, and what a speech recognizer (Qwen3-ASR) hears in it against the text.
# A take that fails is sampled again with another seed, and the best one is kept.
import contextlib
import json
import os
import re
import sys

os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
os.environ.setdefault('TRANSFORMERS_VERBOSITY', 'error')

TRIES = 4
# a take is sampled again when the recognizer hears this share of the line differently, or this long a run
# of mistakes in a row (a garble: 负 2 x → 负二长方荡 is 2.5); a warning if every take is still off
RETRY_AT, RETRY_RUN = 0.10, 2
WARN_AT, WARN_RUN = 0.15, 2


def expected(text):
    """Rough speaking time in seconds: ~3.6 Chinese characters a second, Latin words and numbers."""
    han = len(re.findall(r'[㐀-鿿]', text))
    words = len(re.findall(r'[A-Za-z]+', text))
    nums = len(re.findall(r'\d+(?:\.\d+)?', text))
    return han / 3.6 + words * 0.4 + nums * 0.5 + 0.3


def plausible(seconds, est):
    return 0.35 * est - 0.5 <= seconds <= 2.0 * est + 2.0


# --- what was said vs. what was meant ---------------------------------------------------------------
# Chinese is compared by sound (toneless pinyin), so a homophone the recognizer picks (交点/焦点) is no
# mistake; numbers are read out first (0.5 → 零点五, 2 → 二), since the recognizer writes either form.
DIGITS = '零一二三四五六七八九'


def cn_int(n):
    if n >= 10 ** 8:
        return ''.join(DIGITS[int(c)] for c in str(n))

    def four(x):
        out, zero = '', False
        for i, c in enumerate(f'{x:04d}'):
            d = int(c)
            if d == 0:
                zero = bool(out)
            else:
                out += ('零' if zero else '') + DIGITS[d] + ['千', '百', '十', ''][i]
                zero = False
        return out

    if n < 10:
        return DIGITS[n]
    hi, lo = divmod(n, 10000)
    out = (four(hi) + '万' if hi else '') + (('零' if hi and lo < 1000 else '') + four(lo) if lo else '')
    return re.sub('^一十', '十', out)


def cn_number(m):
    whole, _, frac = m.group().partition('.')
    return cn_int(int(whole)) + ('点' + ''.join(DIGITS[int(c)] for c in frac) if frac else '')


def units(text, chinese, pinyin):
    """The line as a list of sounds: pinyin syllables, digits, and Latin words as '#word' (m x and mx as '#m', '#x')."""
    t = text.lower().replace('−', '-')
    if chinese:
        t = re.sub(r'\d+(?:\.\d+)?', cn_number, t)
    out = []
    for tok in re.findall(r'[㐀-鿿]|[^\W\d_㐀-鿿]+|\d+', t):  # Han one by one, words (with accents), numbers
        if chinese and re.match(r'[㐀-鿿]', tok):
            out += [{'liang': 'er'}.get(p, p) for p in pinyin(tok)]
        elif tok.isdigit():
            out += list(tok)  # digit by digit: a wrong number (260 → 45) is several mistakes in a row, not one
        else:
            out += ['#' + c for c in tok] if len(tok) <= 2 else ['#' + tok]
    return out


def mismatch(text, heard, chinese, pinyin):
    """(share of the line heard differently, the longest run of mistakes in a row), both in units of the
    text. A garbled take has a run of several; a homophone or a misheard letter is one on its own."""
    a, b = units(text, chinese, pinyin), units(heard, chinese, pinyin)
    letter = lambda u: len(u) == 2 and u[0] == '#'
    d = {(0, 0): (0, None)}
    for i in range(len(a) + 1):
        for j in range(len(b) + 1):
            if i == j == 0:
                continue
            ways = []
            if i:
                ways.append((d[i - 1, j][0] + 1, (i - 1, j, 1)))
            if j:
                ways.append((d[i, j - 1][0] + 1, (i, j - 1, 1)))
            if i and j:
                x, y = a[i - 1], b[j - 1]
                # a variable (m, b, x) the recognizer wrote as a character, or a number word it wrote in digits
                # (tres → 3), is half a mistake
                cost = 0 if x == y else 0.5 if letter(x) or letter(y) or x.isdigit() != y.isdigit() else 1
                ways.append((d[i - 1, j - 1][0] + cost, (i - 1, j - 1, cost)))
                # a name in Latin letters in a Chinese line (Desmos) can come back as a few syllables: one mistake
                if chinese and len(x) > 3 and x[0] == '#':
                    ways += [(d[i - 1, j - k][0] + 1, (i - 1, j - k, 1)) for k in range(2, min(5, j) + 1)]
            d[i, j] = min(ways, key=lambda w: w[0])
    i, j, run, worst = len(a), len(b), 0, 0
    while (i, j) != (0, 0):
        i, j, cost = d[i, j][1]
        run = run + cost if cost else 0
        worst = max(worst, run)
    return d[len(a), len(b)][0] / max(1, len(a)), worst


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
        asr, asr_error, pinyin = None, None, None
        if job.get('asr'):
            try:
                from mlx_audio.stt.utils import load_model as load_stt
                from pypinyin import lazy_pinyin as pinyin
                asr = load_stt(snapshot_download(job['asr']['repo'], revision=job['asr']['revision']))
            except Exception as e:  # offline before the first download, say: check by length only
                asr_error = f'{type(e).__name__}: {e}'.splitlines()[0][:300]

        def hear(audio, line):
            """(what the recognizer heard, mismatch), or (None, None) for a line it can't check."""
            chinese = line['lang'] == 'chinese'
            latin = {'english': 'English', 'spanish': 'Spanish', 'french': 'French', 'german': 'German', 'italian': 'Italian',
                     'portuguese': 'Portuguese'}.get(line['lang'], 'English' if line['lang'] == 'auto' else None)
            if asr is None or not (chinese or (latin and not re.search(r'[㐀-鿿]', line['text']))):
                return None, None
            tmp = line['file'] + '.check.wav'
            write(tmp, audio, model.sample_rate)
            try:
                heard = asr.generate(tmp, language='Chinese' if chinese else latin).text.strip()
            finally:
                os.remove(tmp)
            return heard, mismatch(line['text'], heard, chinese, pinyin)

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
                fits = plausible(seconds, est)
                heard, m = hear(audio, line) if fits else (None, None)
                # how far off the recognizer heard it: up to 1 is fine (0 when it couldn't check)
                worse = max(m[0] / RETRY_AT, m[1] / RETRY_RUN) if m else 0
                # a take of the right length that says the line beats one that doesn't; then the closest length
                rank = (not fits, worse if worse > 1 else 0, abs(math.log(max(seconds, 0.1) / est)))
                if best is None or rank < best['rank']:
                    best = {'rank': rank, 'audio': audio, 'seconds': seconds, 'fits': fits, 'heard': heard, 'm': m}
                if fits and worse <= 1:
                    break
            write(line['file'], best['audio'], model.sample_rate)
            m = best['m']
            results.append({'seconds': best['seconds'], 'tries': k + 1, 'heard': best['heard'], 'mismatch': m and m[0],
                            'suspect': not best['fits'] or bool(m and (m[0] > WARN_AT or m[1] > WARN_RUN))})
            print(f'line {i + 1}/{n} {best["seconds"]:.1f}s' + (f' {k + 1} tries' if k else ''), file=sys.stderr, flush=True)
    out.write(json.dumps({'results': results, 'asr': asr_error}))


if __name__ == '__main__':
    main()
