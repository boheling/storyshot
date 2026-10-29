# Mandarin text -> Kokoro v1.1-zh phonemes, for storyshot's Chinese voice (src/kokoro-zh.mjs).
# Runs in storyshot's own venv (~/.cache/storyshot/zh-venv), once per render for every line.
#   stdin:  {"lines": ["...", ...], "target": 300, "max": 510}
#   stdout: {"pieces": [["<phonemes>", ...], ...]}   one list per line; long lines come back in pieces
# G2P: misaki ZHG2P(version='1.1'); English words and single letters go through misaki's espeak-ng
# fallback (letter names: "m x" -> ˈɛm ˈɛks), instead of being dropped as the stock frontend does.
import json
import logging
import os
import re
import shutil
import sys


def espeak_data_path():
    # espeak-ng truncates its data path at 160 characters; use a copy at a shorter path if needed
    import espeakng_loader
    data = espeakng_loader.get_data_path()
    if len(data) <= 120:
        return data
    import tempfile
    from importlib.metadata import version
    for base in (os.path.join(os.path.expanduser('~'), '.cache', 'storyshot'), tempfile.gettempdir()):
        short = os.path.join(base, f"espeak-ng-data-{version('espeakng-loader')}")
        if len(short) > 120:
            continue
        if not os.path.exists(os.path.join(short, 'phontab')):
            shutil.rmtree(short, ignore_errors=True)
            shutil.copytree(data, short)
        return short
    return data


def make_g2p():
    import jieba
    jieba.setLogLevel(logging.ERROR)
    from phonemizer.backend.espeak.wrapper import EspeakWrapper
    import misaki.espeak  # noqa: F401  (points phonemizer at the bundled espeak-ng library)
    EspeakWrapper.set_data_path(espeak_data_path())
    from misaki.espeak import EspeakFallback
    from misaki import zh

    esp = EspeakFallback(british=False)

    class Token:
        def __init__(self, text):
            self.text = text

    def en_callable(run):  # the v1.1 frontend hands over Latin runs like "m x" or "GeoGebra"
        return ' '.join(esp(Token(w))[0] or '' for w in re.findall(r"[A-Za-z']+", run))

    g2p = zh.ZHG2P(version='1.1', en_callable=en_callable)
    return lambda text: (g2p(text)[0] or '').strip()


SENTENCE = re.compile(r'(?<=[。！？；!?;])')
CLAUSE = re.compile(r'(?<=[，、：,:])')


def units(g2p, text, target, hard):
    """Split text into (text, phoneme length) units no longer than `target`: sentences first, then clauses,
    then (rarely) plain character slices."""
    out = []
    for sentence in [s for s in SENTENCE.split(text) if s.strip()]:
        n = len(g2p(sentence))
        if n <= target:
            out.append((sentence, n))
            continue
        for clause in [c for c in CLAUSE.split(sentence) if c.strip()]:
            m = len(g2p(clause))
            if m <= hard:
                out.append((clause, m))
                continue
            k = -(-m // target)
            step = -(-len(clause) // k)
            for i in range(0, len(clause), step):
                part = clause[i:i + step]
                out.append((part, len(g2p(part))))
    return out


def pieces(g2p, text, target, hard):
    text = text.strip()
    if not text:
        return []
    ps = g2p(text)
    if len(ps) <= target:
        return [ps] if ps else []
    us = units(g2p, text, target, hard)
    total = sum(n for _, n in us)
    k = -(-total // target)
    goal = total / k
    groups, cur, n = [], [], 0
    for t, m in us:
        # close the group when the next unit would overflow, or would land further from an even split
        if cur and (n + m > target or abs(n + m - goal) > abs(n - goal)):
            groups.append(''.join(cur))
            cur, n = [], 0
        cur.append(t)
        n += m
    if cur:
        groups.append(''.join(cur))
    return [p[:hard] for p in (g2p(g) for g in groups) if p]


def main():
    req = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    out = sys.stdout
    sys.stdout = sys.stderr  # keep any library chatter off the JSON channel
    g2p = make_g2p()
    target, hard = int(req.get('target', 300)), int(req.get('max', 510))
    result = [pieces(g2p, line, target, hard) for line in req['lines']]
    out.buffer.write(json.dumps({'pieces': result}, ensure_ascii=False).encode('utf-8'))
    out.flush()


if __name__ == '__main__':
    main()
