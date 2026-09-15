# blitzframes

Faster Remotion Lambda renders on your own AWS account.

```sh
npx blitzframes
```

Run it inside a Remotion project. It signs you in by email, starts a free trial or finds your
subscription, saves your token to `.env` as `BLITZFRAMES_TOKEN`, deploys a BlitzFrames function
and benchmarks it against stock Remotion Lambda.

It needs the Remotion Lambda setup (IAM user, role and `REMOTION_AWS_*` keys) from
[Remotion's guide](https://www.remotion.dev/docs/lambda/setup).

## Deploy

Whenever you would deploy a Remotion Lambda function, for example after upgrading Remotion,
replace `remotion` with `blitzframes` in the deploy command:

```sh
npx blitzframes lambda functions deploy
```

It takes the same flags as `npx remotion lambda functions deploy`, plus `--token`. Use the
printed function name as `functionName` in `renderMediaOnLambda`.

```sh
npx blitzframes lambda functions ls
npx blitzframes benchmark [--composition <id>] [--props '<json>']
```

## API

```js
import {deployFunctionBlitzFrames} from 'blitzframes';

const {functionName} = await deployFunctionBlitzFrames({
  region: 'eu-central-1',
  timeoutInSeconds: 900,
  memorySizeInMb: 4096,
  // token: optional; otherwise read from BLITZFRAMES_TOKEN
});
```

Same options as Remotion's [`deployFunction`](https://www.remotion.dev/docs/lambda/deployfunction), plus `token`.
`region`, `timeoutInSeconds`, and `memorySizeInMb` are required. The CLI supplies defaults
when these flags are omitted.

## Deployment behavior

Both deploy entry points use the project's Remotion version and identify functions by
version, memory, disk size, and timeout. The BlitzFrames name adds `-bf` inside the version
segment, for example `remotion-render-4-0-524-bf-mem2048mb-disk2048mb-120sec`.

| Existing functions | What deployment does |
| --- | --- |
| No matching function | Deploy stock through Remotion, copy it into the BlitzFrames function, then delete the temporary stock function. |
| Matching stock function | Copy it into the BlitzFrames function and preserve the original unchanged. |
| Stock with another version or configuration | Preserve it; create matching temporary stock, copy it, then delete only that temporary function. |
| Matching BlitzFrames function with the same loader/token | Return the existing name, without stock deployment or function changes. |
| Matching BlitzFrames function with another loader/token | Replace the BlitzFrames function; preserve pre-existing stock. |

There is no `--keep-stock` flag: pre-existing stock functions are always preserved.
Remotion's full deployment validation runs when creation or replacement is needed.
On reuse, the wrapper checks required fields, the token, and Remotion version, then uses
Remotion's name calculation and returns early. Other deployment options are not applied
or fully validated on that path; an unused invalid option can therefore go unreported.

Rendering and progress use Remotion's APIs. Pass the returned `functionName` to the API,
or select it with `--function-name` in Remotion's render CLI when multiple compatible
functions exist.

Benchmarking keeps both functions for the comparison and removes stock only if the
benchmark created it, including on setup or render failure.

## Terms

[Terms](https://blitzframes.com/terms) · [Privacy](https://blitzframes.com/privacy)
