# Storyshot in a box: Chromium, ffmpeg and CJK fonts included. Works the same on
# Linux, Windows and macOS hosts, and in CI.
#   docker build -t storyshot .
#   docker run --rm -v "$PWD:/work" -v storyshot-cache:/root/.cache --env-file .env storyshot render demo.yaml
FROM mcr.microsoft.com/playwright:v1.64.0-noble

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/storyshot
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY bin ./bin
COPY src ./src
COPY skills ./skills
COPY README.md ./
RUN ln -s /opt/storyshot/bin/storyshot.mjs /usr/local/bin/storyshot

# Keep downloaded voice models between runs: -v storyshot-cache:/root/.cache
WORKDIR /work
ENTRYPOINT ["storyshot"]
CMD ["--help"]
