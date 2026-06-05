import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { registerInvoke } from '../ipc/registry';
import {
  checkRunnerInstalledRequestSchema,
  runnerInstallProgressChannel,
  type RunnerInfo,
  type RunnerInstallCheck,
} from '../../shared/ipc-types';
import {
  gitInitRequestSchema,
  runnerInstallRequestSchema,
  runnerProbeAuthRequestSchema,
} from '../../shared/runner-discovery';
import { toFriendlyError } from '../util/friendly-error';
import { acceptMerge, prepareMergeBundle, rejectMerge } from './merge-review';
import { clear, listRuns, markSeen, onRunsChanged } from './run-registry';
import { resolveRegisteredRunnerId, runnerRegistry } from './runner-registry-instance';
import { abortSpawnedRun, spawnFromUiAsync } from './spawn-from-ui';
import { isGitRepo } from './worktrees';
import { getAvailablePackageManagers, installRunner } from './runner-install';
import { probeRunnerAuth } from './runner-probe';
import { initGitRepo } from './git-init';

function assertRunnerExists(runnerId: string): void {
  if (!runnerRegistry.has(runnerId)) throw new Error(`Unknown runner: ${runnerId}`);
}

const runIdRequest = z.object({ runId: z.string().min(1) });

const spawnFromUiSchema = z.object({
  task: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  workspaceRoot: z.string().min(1),
  useWorktree: z.boolean(),
  runnerId: z.string().min(1).default('internal'),
});

const gitIsRepoSchema = z.object({
  path: z.string().min(1),
});

const PLUGIN_PREFIX = 'plugin__';

function describeRunnerId(rawId: string): {
  exposedId: string;
  source: RunnerInfo['source'];
  pluginId?: string;
} {
  if (rawId.startsWith(PLUGIN_PREFIX)) {
    const rest = rawId.slice(PLUGIN_PREFIX.length);
    const sep = rest.indexOf('__');
    if (sep > 0 && sep < rest.length - 2) {
      const pluginId = rest.slice(0, sep);
      const bareId = rest.slice(sep + 2);
      return { exposedId: bareId, source: 'plugin', pluginId };
    }
  }
  return { exposedId: rawId, source: 'builtin' };
}

function describeRunners(): RunnerInfo[] {
  return runnerRegistry.list().map((runner) => {
    const desc = describeRunnerId(runner.id);
    const info: RunnerInfo = {
      id: desc.exposedId,
      displayName: runner.displayName,
      source: desc.source,
      streaming: runner.streaming,
    };
    if (desc.pluginId !== undefined) info.pluginId = desc.pluginId;
    return info;
  });
}

export function registerAgentHandlers(): void {
  registerInvoke('agent:list-runs', z.void(), () => listRuns());
  registerInvoke('agent:clear-runs', z.void(), () => {
    clear();
    return listRuns();
  });

  registerInvoke(
    'agent:mark-runs-seen',
    z.object({ runIds: z.array(z.string().min(1)) }),
    (req) => {
      markSeen(req.runIds);
      return { ok: true as const, runs: listRuns() };
    },
  );

  registerInvoke('agent:get-merge-bundle', runIdRequest, async (req) => {
    try {
      const bundle = await prepareMergeBundle(req.runId);
      return {
        runId: bundle.runId,
        diff: bundle.diff,
        files: bundle.files,
        branch: bundle.branch,
      };
    } catch (err) {
      throw toFriendlyError(err);
    }
  });

  registerInvoke('agent:accept-merge', runIdRequest, async (req) => {
    const outcome = await acceptMerge(req.runId);
    return outcome.error === undefined
      ? { ok: outcome.ok }
      : { ok: outcome.ok, error: outcome.error };
  });

  registerInvoke('agent:reject-merge', runIdRequest, async (req) => {
    const outcome = await rejectMerge(req.runId);
    return outcome.error === undefined
      ? { ok: outcome.ok }
      : { ok: outcome.ok, error: outcome.error };
  });

  registerInvoke('agent:spawn-from-ui', spawnFromUiSchema, async (req) => {
    const runnerId = req.runnerId ?? 'internal';
    if (!resolveRegisteredRunnerId(runnerId)) throw new Error(`Unknown runner: ${runnerId}`);
    try {
      return await spawnFromUiAsync({
        task: req.task,
        providerId: req.providerId,
        modelId: req.modelId,
        workspaceRoot: req.workspaceRoot,
        useWorktree: req.useWorktree,
        runnerId,
      });
    } catch (err) {
      throw toFriendlyError(err);
    }
  });

  registerInvoke('agent:abort-run', runIdRequest, (req) => {
    const aborted = abortSpawnedRun(req.runId);
    return aborted ? { ok: true } : { ok: false, error: 'run not active or not abortable' };
  });

  registerInvoke('agent:list-runners', z.void(), () => describeRunners());

  registerInvoke('agent:check-runner-installed', checkRunnerInstalledRequestSchema, async (req) => {
    const registeredId = resolveRegisteredRunnerId(req.runnerId);
    if (!registeredId) {
      assertRunnerExists(req.runnerId);
      throw new Error(`Unknown runner: ${req.runnerId}`);
    }
    const runner = runnerRegistry.get(registeredId);
    if (!runner) {
      assertRunnerExists(registeredId);
      throw new Error(`Unknown runner: ${req.runnerId}`);
    }
    if (typeof runner.checkInstalled !== 'function') {
      return { ok: true } satisfies RunnerInstallCheck;
    }
    try {
      return await runner.checkInstalled();
    } catch (err) {
      return {
        ok: false,
        hint: err instanceof Error ? err.message : 'check failed',
      } satisfies RunnerInstallCheck;
    }
  });

  registerInvoke('git:is-repo', gitIsRepoSchema, async (req) => {
    const isRepo = await isGitRepo(req.path);
    return { isRepo };
  });

  registerInvoke('runner:list-package-managers', z.void(), async () => {
    const managers = await getAvailablePackageManagers();
    return { managers };
  });

  registerInvoke('runner:install', runnerInstallRequestSchema, async (req) => {
    return await installRunner(req, (chunk) => {
      const payload = { runnerId: req.runnerId, stream: chunk.stream, chunk: chunk.chunk };
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(runnerInstallProgressChannel, payload);
      }
    });
  });

  registerInvoke('runner:probe-auth', runnerProbeAuthRequestSchema, async (req) => {
    return await probeRunnerAuth(req.runnerId);
  });

  registerInvoke('git:init-repo', gitInitRequestSchema, async (req) => {
    return await initGitRepo(req);
  });

  onRunsChanged((runs) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('agent:runs-changed', { runs: [...runs] });
    }
  });

  runnerRegistry.onChange(() => {
    const runners = describeRunners();
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('agent:runners-changed', { runners });
    }
  });
}
