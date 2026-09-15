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
  timeoutInSeconds: 120,
  memorySizeInMb: 2048,
  // token: optional; otherwise read from BLITZFRAMES_TOKEN
});
```

Same options and validation as Remotion's [`deployFunction`](https://www.remotion.dev/docs/lambda/deployfunction), plus `token`.
`region`, `timeoutInSeconds`, and `memorySizeInMb` are required. The CLI supplies defaults
when these flags are omitted.

## Terms

[Terms](https://blitzframes.com/terms) · [Privacy](https://blitzframes.com/privacy)
