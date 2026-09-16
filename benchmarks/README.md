# Benchmarks

The frame-count benchmark on [blitzframes.com](https://blitzframes.com): `npx blitzframes benchmark`
on six public Remotion compositions at 100, 200 and 400 frames.

| Composition | Source |
| --- | --- |
| Skia | [remotion-dev/template-skia](https://github.com/remotion-dev/template-skia) |
| GitHub Unwrapped | [remotion-dev/github-unwrapped](https://github.com/remotion-dev/github-unwrapped) |
| TikTok captions | [remotion-dev/template-tiktok](https://github.com/remotion-dev/template-tiktok) |
| Music visualization | [remotion-dev/template-music-visualization](https://github.com/remotion-dev/template-music-visualization) |
| ZurichJS scenes | [JonnyBurger/zurichjs-scenes](https://github.com/JonnyBurger/zurichjs-scenes) |
| MapLibre map | [remotion-dev/maplibre-example](https://github.com/remotion-dev/maplibre-example) |

Each composition is wrapped in a Remotion `<Loop>` so that every length exists
([`wrappers`](wrappers)), and `frames` in the input props sets the length. ZurichJS scenes and
GitHub Unwrapped loop their first 200 frames: their later scenes run a 2048 MB stock Lambda out of
memory and fail inside the template, respectively. The MapLibre flight is timed by the composition's
length, so the whole route plays at every length; it loads its map tiles from OpenFreeMap while rendering.

## Run it

It needs the [Remotion Lambda setup](https://www.remotion.dev/docs/lambda/setup) and a BlitzFrames
token from `npx blitzframes`, in the environment or in `benchmarks/.env`:

```sh
REMOTION_AWS_ACCESS_KEY_ID=...
REMOTION_AWS_SECRET_ACCESS_KEY=...
REMOTION_AWS_REGION=eu-central-1
BLITZFRAMES_TOKEN=...
```

```sh
npm install
node benchmarks/run.mjs                        # all six at 100, 200 and 400 frames
ONLY=skia SIZES=100 node benchmarks/run.mjs    # a subset
```

The compositions are cloned into a temporary directory with Remotion pinned to one version
(`REMOTION_VERSION`, by default the one this package tests with). Every composition and length is
one `blitzframes benchmark` run: times are end to end, the median of three warm renders; costs are
Remotion's AWS estimate and BlitzFrames' per-frame price plus an assumed AWS cost. The CLI's JSON for each run and
`sweep-summary.json` combining them are written to `benchmarks/runs/<timestamp>/`.
