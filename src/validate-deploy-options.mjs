import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';

/** Remotion has no public validation-only API. Run its own validation with a provider
 * that stops at the first AWS operation. Nothing is patched globally and no real AWS
 * implementation is supplied. Like benchmark-functions.mjs, resolve internals from
 * the selected project so validation follows its installed Remotion version. */
export async function validateDeployOptions(remotion, options) {
  const require = remotion.source && remotion.source !== 'package'
    ? createRequire(join(remotion.source, 'package.json')) : createRequire(import.meta.url);
  const {internalDeployFunction} = require(join(dirname(require.resolve('@remotion/lambda')), 'api/deploy-function.js'));
  // These are the optional defaults applied by Remotion's public deployFunction.
  // Required memory, timeout and region are passed through without defaults.
  const normalized = {...options,
    diskSizeInMb: options.diskSizeInMb ?? remotion.constants.DEFAULT_EPHEMERAL_STORAGE_IN_MB,
    customRoleArn: options.customRoleArn ?? undefined,
    customLayerArns: options.customLayerArns ?? null,
    enableLambdaInsights: options.enableLambdaInsights ?? false,
    runtimePreference: options.runtimePreference ?? 'default',
    indent: options.indent ?? false, logLevel: options.logLevel ?? 'info',
  };
  const validated = Symbol('Remotion deployment options validated');
  try {
    await internalDeployFunction({...normalized,
      providerSpecifics: {getAccountId: async () => { throw validated; }},
      fullClientSpecifics: {},
    });
  } catch (error) {
    if (error !== validated) throw error;
    return normalized;
  }
  throw new Error('Unsupported Remotion deployment validation flow');
}
