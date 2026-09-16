<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/BlitzFrames/blitzframes/main/.github/assets/blitzframes-wordmark-light.png">
    <img alt="BlitzFrames" src="https://raw.githubusercontent.com/BlitzFrames/blitzframes/main/.github/assets/blitzframes-wordmark-dark.png" width="360">
  </picture>
</p>

# blitzframes

Faster Remotion Lambda renders on your own AWS account.

```sh
npx blitzframes
```

Run it inside a Remotion project; it offers to add `@remotion/lambda` if it is missing, or to clone
a sample project in an empty folder. It signs you in by email, starts a free trial or finds your
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

It takes the same flags as `npx remotion lambda functions deploy`, with the same defaults, plus
`--token`. Use the printed function name as `functionName` in `renderMediaOnLambda`.

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
`region`, `timeoutInSeconds`, and `memorySizeInMb` are required.

## How it works

BlitzFrames deploys the function Remotion would deploy for your project's Remotion version, with
BlitzFrames added. Its name has `-bf` in it, for example
`remotion-render-4-0-524-bf-mem4096mb-disk2048mb-900sec`, so it sits next to your stock functions.

- Your existing Remotion functions are never changed or deleted.
- Deploying again with the same settings reuses the function.
- Render as usual with Remotion, using this function name.

## License

MIT. Using the BlitzFrames service is subject to the [terms](https://blitzframes.com/terms) and
[privacy notice](https://blitzframes.com/privacy).
