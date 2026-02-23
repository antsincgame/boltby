import type { WebContainer } from '@webcontainer/api';
import { path as nodePath } from '~/utils/path';
import { atom, map, type MapStore } from 'nanostores';
import type {
  ActionAlert,
  BoltAction,
  DeployAlert,
  FileHistory,
  PocketBaseAction,
  PocketBaseAlert,
} from '~/types/actions';
import { createScopedLogger } from '~/utils/logger';
import { unreachable } from '~/utils/unreachable';
import type { ActionCallbackData } from './message-parser';
import type { BoltShell } from '~/utils/shell';
import { logStore } from '~/lib/stores/logs';
import {
  PACKAGE_NAME_CORRECTIONS,
  KNOWN_TAILWIND_PLUGINS,
  sanitizeNpmCommand,
  fixPackageJson,
  fixViteConfig,
  fixTailwindOrPostcssConfig,
  fixSourceImports,
  scaffoldViteFiles,
  extractTailwindPlugins,
} from './action-fixers';

const logger = createScopedLogger('ActionRunner');

export type ActionStatus = 'pending' | 'running' | 'complete' | 'aborted' | 'failed';

export type BaseActionState = BoltAction & {
  status: Exclude<ActionStatus, 'failed'>;
  abort: () => void;
  executed: boolean;
  abortSignal: AbortSignal;
};

export type FailedActionState = BoltAction &
  Omit<BaseActionState, 'status'> & {
    status: Extract<ActionStatus, 'failed'>;
    error: string;
  };

export type ActionState = BaseActionState | FailedActionState;

type BaseActionUpdate = Partial<Pick<BaseActionState, 'status' | 'abort' | 'executed'>>;

export type ActionStateUpdate =
  | BaseActionUpdate
  | (Omit<BaseActionUpdate, 'status'> & { status: 'failed'; error: string });

type ActionsMap = MapStore<Record<string, ActionState>>;

class ActionCommandError extends Error {
  readonly _output: string;
  readonly _header: string;

  constructor(message: string, output: string) {
    const formattedMessage = `Failed To Execute Shell Command: ${message}\n\nOutput:\n${output}`;
    super(formattedMessage);

    this._header = message;
    this._output = output;

    Object.setPrototypeOf(this, ActionCommandError.prototype);
    this.name = 'ActionCommandError';
  }

  get output() {
    return this._output;
  }
  get header() {
    return this._header;
  }
}

export class ActionRunner {
  #webcontainer: Promise<WebContainer>;
  #currentExecutionPromise: Promise<void> = Promise.resolve();
  #currentStartPromise: Promise<void> = Promise.resolve();
  #shellTerminal: () => BoltShell;
  runnerId = atom<string>(`${Date.now()}`);
  actions: ActionsMap = map({});
  onAlert?: (alert: ActionAlert) => void;
  onPocketBaseAlert?: (alert: PocketBaseAlert) => void;
  onDeployAlert?: (alert: DeployAlert) => void;
  buildOutput?: { path: string; exitCode: number; output: string };

  constructor(
    webcontainerPromise: Promise<WebContainer>,
    getShellTerminal: () => BoltShell,
    onAlert?: (alert: ActionAlert) => void,
    onPocketBaseAlert?: (alert: PocketBaseAlert) => void,
    onDeployAlert?: (alert: DeployAlert) => void,
  ) {
    this.#webcontainer = webcontainerPromise;
    this.#shellTerminal = getShellTerminal;
    this.onAlert = onAlert;
    this.onPocketBaseAlert = onPocketBaseAlert;
    this.onDeployAlert = onDeployAlert;
  }

  addAction(data: ActionCallbackData) {
    const { actionId } = data;

    const actions = this.actions.get();
    const action = actions[actionId];

    if (action) {
      return;
    }

    const abortController = new AbortController();

    this.actions.setKey(actionId, {
      ...data.action,
      status: 'pending',
      executed: false,
      abort: () => {
        abortController.abort();
        this.#updateAction(actionId, { status: 'aborted' });
      },
      abortSignal: abortController.signal,
    });

    this.#currentExecutionPromise.then(() => {
      this.#updateAction(actionId, { status: 'running' });
    });
  }

  async runAction(data: ActionCallbackData, isStreaming: boolean = false) {
    const { actionId } = data;
    const action = this.actions.get()[actionId];

    if (!action) {
      unreachable(`Action ${actionId} not found`);
    }

    if (action.executed) {
      return;
    }

    if (isStreaming && action.type !== 'file') {
      return;
    }

    this.#updateAction(actionId, { ...action, ...data.action, executed: !isStreaming });

    this.#currentExecutionPromise = this.#currentExecutionPromise
      .then(() => {
        return this.#executeAction(actionId, isStreaming);
      })
      .catch((error) => {
        logger.error('Action failed:', error);
      });

    await this.#currentExecutionPromise;

    return;
  }

  async #executeAction(actionId: string, isStreaming: boolean = false) {
    const action = this.actions.get()[actionId];

    this.#updateAction(actionId, { status: 'running' });

    try {
      switch (action.type) {
        case 'shell': {
          await this.#runShellAction(action);
          break;
        }
        case 'file': {
          await this.#runFileAction(action);
          break;
        }
        case 'pocketbase': {
          try {
            await this.handlePocketBaseAction(action as PocketBaseAction);
          } catch (error: unknown) {
            this.#updateAction(actionId, {
              status: 'failed',
              error: error instanceof Error ? error.message : 'PocketBase action failed',
            });
            return;
          }
          break;
        }
        case 'build': {
          const buildOutput = await this.#runBuildAction(action);
          this.buildOutput = buildOutput;
          break;
        }
        case 'start': {
          const prevStart = this.#currentStartPromise;

          this.#currentStartPromise = prevStart
            .then(() => this.#runStartAction(action))
            .then(() => this.#updateAction(actionId, { status: 'complete' }))
            .catch((err: Error) => {
              if (action.abortSignal.aborted) {
                return;
              }

              this.#updateAction(actionId, { status: 'failed', error: 'Action failed' });
              logger.error(`[${action.type}]:Action failed\n\n`, err);

              if (!(err instanceof ActionCommandError)) {
                return;
              }

              this.onAlert?.({
                type: 'error',
                title: 'Dev Server Failed',
                description: err.header,
                content: err.output,
              });
            });

          return;
        }
      }

      this.#updateAction(actionId, {
        status: isStreaming ? 'running' : action.abortSignal.aborted ? 'aborted' : 'complete',
      });
    } catch (error) {
      if (action.abortSignal.aborted) {
        return;
      }

      this.#updateAction(actionId, { status: 'failed', error: 'Action failed' });
      logger.error(`[${action.type}]:Action failed\n\n`, error);

      if (!(error instanceof ActionCommandError)) {
        return;
      }

      this.onAlert?.({
        type: 'error',
        title: 'Dev Server Failed',
        description: error.header,
        content: error.output,
      });

      throw error;
    }
  }

  async #runShellAction(action: ActionState) {
    if (action.type !== 'shell') {
      unreachable('Expected shell action');
    }

    const shell = this.#shellTerminal();
    await shell.ready();

    if (!shell || !shell.terminal || !shell.process) {
      unreachable('Shell terminal not found');
    }

    const sanitizedCommand = sanitizeNpmCommand(action.content);
    logStore.logSystem(`Shell: ${sanitizedCommand.substring(0, 100)}`, { command: sanitizedCommand });

    const resp = await shell.executeCommand(this.runnerId.get(), sanitizedCommand, () => {
      logger.debug(`[${action.type}]:Aborting Action\n\n`, action);
      action.abort();
    });
    logger.debug(`${action.type} Shell Response: [exit code:${resp?.exitCode}]`);

    if (resp?.exitCode === 0) {
      logStore.logSystem(`Shell OK: ${sanitizedCommand.substring(0, 60)}`, { exitCode: 0 });
    } else {
      logStore.logError(`Shell FAIL (exit ${resp?.exitCode}): ${sanitizedCommand.substring(0, 60)}`, undefined, {
        exitCode: resp?.exitCode,
        output: resp?.output?.substring(0, 300),
      });
    }

    if (resp?.exitCode != 0) {
      const output = resp?.output || '';
      const isNpmInstall = /npm\s+install|npm\s+i\b/.test(sanitizedCommand);

      if (isNpmInstall && output.includes('404')) {
        const retryResult = await this.#retryNpmInstallWithFix(shell, output);

        if (retryResult) {
          return;
        }
      }

      throw new ActionCommandError(`Failed To Execute Shell Command`, output || 'No Output Available');
    }
  }

  async #retryNpmInstallWithFix(shell: BoltShell, errorOutput: string): Promise<boolean> {
    const notFoundMatch = errorOutput.match(/404\s+Not Found\s+-\s+GET\s+https?:\/\/registry\.npmjs\.org\/([^\s]+)/);

    if (!notFoundMatch) {
      return false;
    }

    const badPackage = decodeURIComponent(notFoundMatch[1]).replace(/%2f/gi, '/');
    logger.warn(`🔄 npm install failed: package "${badPackage}" not found, attempting auto-fix...`);

    try {
      const webcontainer = await this.#webcontainer;
      const pkgContent = await webcontainer.fs.readFile('package.json', 'utf-8');
      const pkg = JSON.parse(pkgContent);
      let removed = false;

      for (const depKey of ['dependencies', 'devDependencies', 'peerDependencies']) {
        const deps = pkg[depKey as keyof typeof pkg] as Record<string, string> | undefined;

        if (deps && badPackage in deps) {
          const corrected = PACKAGE_NAME_CORRECTIONS[badPackage];

          if (corrected) {
            const ver = deps[badPackage];
            delete deps[badPackage];
            deps[corrected] = ver;
            logger.info(`🔄 Retry-fix: "${badPackage}" → "${corrected}"`);
          } else {
            delete deps[badPackage];
            logger.info(`🔄 Retry-fix: removed non-existent "${badPackage}"`);
          }

          removed = true;
        }
      }

      if (!removed) {
        return false;
      }

      await webcontainer.fs.writeFile('package.json', JSON.stringify(pkg, null, 2));
      logger.info('🔄 Retrying npm install after fix...');

      const retryResp = await shell.executeCommand(this.runnerId.get(), 'npm install', () => {});

      if (retryResp?.exitCode === 0) {
        logger.info('✅ npm install succeeded after auto-fix');
        return true;
      }

      logger.warn('🔄 Retry failed, npm install still failing');
    } catch (e) {
      logger.error('🔄 Auto-fix retry error:', e);
    }

    return false;
  }

  async #runStartAction(action: ActionState) {
    if (action.type !== 'start') {
      unreachable('Expected shell action');
    }

    if (!this.#shellTerminal) {
      unreachable('Shell terminal not found');
    }

    const shell = this.#shellTerminal();
    await shell.ready();

    if (!shell || !shell.terminal || !shell.process) {
      unreachable('Shell terminal not found');
    }

    logStore.logSystem(`Dev server starting: ${action.content}`, { command: action.content });

    const resp = await shell.executeCommand(this.runnerId.get(), action.content, () => {
      logger.debug(`[${action.type}]:Aborting Action\n\n`, action);
      action.abort();
    });
    logger.debug(`${action.type} Shell Response: [exit code:${resp?.exitCode}]`);

    if (resp?.exitCode != 0) {
      logStore.logError(`Dev server failed (exit ${resp?.exitCode})`, undefined, {
        command: action.content,
        output: resp?.output?.substring(0, 300),
      });
      throw new ActionCommandError('Failed To Start Application', resp?.output || 'No Output Available');
    }

    logStore.logSystem('Dev server started', { command: action.content });

    return resp;
  }

  async #runFileAction(action: ActionState) {
    if (action.type !== 'file') {
      unreachable('Expected file action');
    }

    const webcontainer = await this.#webcontainer;
    const relativePath = nodePath.relative(webcontainer.workdir, action.filePath);

    let folder = nodePath.dirname(relativePath);

    folder = folder.replace(/\/+$/g, '');

    if (folder !== '.') {
      try {
        await webcontainer.fs.mkdir(folder, { recursive: true });
        logger.debug('Created folder', folder);
      } catch (error) {
        logger.error('Failed to create folder\n\n', error);
      }
    }

    try {
      let fileContent = action.content;
      let writePath = relativePath;

      if (relativePath === 'package.json' || relativePath.endsWith('/package.json')) {
        const hadBannedFramework =
          /"(next|astro|@angular\/core|solid-start|@builder\.io\/qwik|@sveltejs\/kit|nuxt|gatsby|@remix-run\/react)"\s*:/.test(
            fileContent,
          );
        fileContent = fixPackageJson(fileContent);

        if (
          hadBannedFramework &&
          !/"(next|astro|@angular\/core|solid-start|@builder\.io\/qwik|@sveltejs\/kit|nuxt|gatsby|@remix-run\/react)"\s*:/.test(
            fileContent,
          )
        ) {
          this.#scaffoldViteForBannedFramework(webcontainer);
        }
      } else if (/vite\.config\.(ts|js|mjs)$/.test(relativePath)) {
        fileContent = fixViteConfig(fileContent);
      } else if (/(?:postcss|tailwind)\.config\.(js|ts|mjs)$/.test(relativePath)) {
        const requiredPlugins = extractTailwindPlugins(fileContent);
        fileContent = fixTailwindOrPostcssConfig(fileContent, relativePath);
        writePath = relativePath.replace(/\.(js|ts|mjs)$/, '.cjs');

        if (writePath !== relativePath) {
          logger.info(`⚙️ Auto-fix: renamed ${relativePath} → ${writePath}`);
        }

        if (requiredPlugins.length > 0) {
          this.#ensureTailwindPlugins(webcontainer, requiredPlugins);
        }
      } else if (/\.(tsx?|jsx)$/.test(relativePath)) {
        fileContent = fixSourceImports(fileContent, relativePath);
      }

      await webcontainer.fs.writeFile(writePath, fileContent);
      logger.debug(`File written ${writePath}`);
      logStore.logSystem(`File: ${writePath}`, { size: fileContent.length });
    } catch (error) {
      logger.error('Failed to write file\n\n', error);
      throw error;
    }
  }

  async #ensureTailwindPlugins(webcontainer: WebContainer, plugins: string[]) {
    try {
      const pkgContent = await webcontainer.fs.readFile('package.json', 'utf-8');
      const pkg = JSON.parse(pkgContent);
      let changed = false;

      if (!pkg.devDependencies) {
        pkg.devDependencies = {};
      }

      for (const plugin of plugins) {
        const version = KNOWN_TAILWIND_PLUGINS[plugin];

        if (!version) {
          continue;
        }

        if (!pkg.dependencies?.[plugin] && !pkg.devDependencies[plugin]) {
          pkg.devDependencies[plugin] = version;
          logger.info(`📦 Auto-add missing Tailwind plugin: ${plugin}@${version}`);
          changed = true;
        }
      }

      if (changed) {
        await webcontainer.fs.writeFile('package.json', JSON.stringify(pkg, null, 2));
        logStore.logSystem('Auto-added missing Tailwind plugins to package.json', { plugins: plugins.join(', ') });
      }
    } catch (err) {
      logger.debug('Could not auto-add Tailwind plugins:', err instanceof Error ? err.message : String(err));
    }
  }

  async #scaffoldViteForBannedFramework(webcontainer: WebContainer) {
    logger.info('🔄 Banned framework → Vite+React: scaffolding essential files');
    logStore.logWarning('Banned framework auto-conversion: creating index.html, vite.config.ts, src/main.tsx');

    try {
      await scaffoldViteFiles(webcontainer as Parameters<typeof scaffoldViteFiles>[0]);
    } catch (err) {
      logger.warn('🔄 Vite scaffold failed:', err instanceof Error ? err.message : String(err));
    }
  }

  #updateAction(id: string, newState: ActionStateUpdate) {
    const actions = this.actions.get();

    this.actions.setKey(id, { ...actions[id], ...newState });
  }

  async getFileHistory(filePath: string): Promise<FileHistory | null> {
    try {
      const webcontainer = await this.#webcontainer;
      const historyPath = this.#getHistoryPath(filePath);
      const content = await webcontainer.fs.readFile(historyPath, 'utf-8');

      return JSON.parse(content);
    } catch (error) {
      logger.error('Failed to get file history:', error);
      return null;
    }
  }

  async saveFileHistory(filePath: string, history: FileHistory) {
    const historyPath = this.#getHistoryPath(filePath);

    await this.#runFileAction({
      type: 'file',
      filePath: historyPath,
      content: JSON.stringify(history),
      changeSource: 'auto-save',
    } as any);
  }

  #getHistoryPath(filePath: string) {
    return nodePath.join('.history', filePath);
  }

  async #runBuildAction(action: ActionState) {
    if (action.type !== 'build') {
      unreachable('Expected build action');
    }

    this.onDeployAlert?.({
      type: 'info',
      title: 'Building Application',
      description: 'Building your application...',
      stage: 'building',
      buildStatus: 'running',
      deployStatus: 'pending',
      source: 'netlify',
    });

    const webcontainer = await this.#webcontainer;

    const buildProcess = await webcontainer.spawn('npm', ['run', 'build']);

    let output = '';
    buildProcess.output.pipeTo(
      new WritableStream({
        write(data) {
          output += data;
        },
      }),
    );

    const exitCode = await buildProcess.exit;

    if (exitCode !== 0) {
      this.onDeployAlert?.({
        type: 'error',
        title: 'Build Failed',
        description: 'Your application build failed',
        content: output || 'No build output available',
        stage: 'building',
        buildStatus: 'failed',
        deployStatus: 'pending',
        source: 'netlify',
      });

      throw new ActionCommandError('Build Failed', output || 'No Output Available');
    }

    this.onDeployAlert?.({
      type: 'success',
      title: 'Build Completed',
      description: 'Your application was built successfully',
      stage: 'deploying',
      buildStatus: 'complete',
      deployStatus: 'running',
      source: 'netlify',
    });

    const commonBuildDirs = ['dist', 'build', 'out', 'output', '.next', 'public'];

    let buildDir = '';

    for (const dir of commonBuildDirs) {
      const dirPath = nodePath.join(webcontainer.workdir, dir);

      try {
        await webcontainer.fs.readdir(dirPath);
        buildDir = dirPath;
        logger.debug(`Found build directory: ${buildDir}`);
        break;
      } catch (error) {
        logger.debug(`Build directory ${dir} not found, trying next option. ${error}`);
      }
    }

    if (!buildDir) {
      buildDir = nodePath.join(webcontainer.workdir, 'dist');
      logger.debug(`No build directory found, defaulting to: ${buildDir}`);
    }

    return {
      path: buildDir,
      exitCode,
      output,
    };
  }

  async handlePocketBaseAction(action: PocketBaseAction) {
    const { operation, content, filePath } = action;
    logger.debug('[PocketBase Action]:', { operation, filePath, content });

    switch (operation) {
      case 'collection':
        this.onPocketBaseAlert?.({
          type: 'info',
          title: 'PocketBase Collection',
          description: 'Create or update collection',
          content,
          source: 'pocketbase',
        });

        if (filePath) {
          await this.#runFileAction({
            type: 'file',
            filePath,
            content,
          } as any);
        }

        return { success: true };

      case 'query': {
        this.onPocketBaseAlert?.({
          type: 'info',
          title: 'PocketBase Query',
          description: 'Execute database query',
          content,
          source: 'pocketbase',
        });
        return { pending: true };
      }

      default:
        throw new Error(`Unknown PocketBase operation: ${operation}`);
    }
  }

  handleDeployAction(
    stage: 'building' | 'deploying' | 'complete',
    status: ActionStatus,
    details?: {
      url?: string;
      error?: string;
      source?: 'netlify' | 'vercel' | 'github';
    },
  ): void {
    if (!this.onDeployAlert) {
      logger.debug('No deploy alert handler registered');
      return;
    }

    const alertType = status === 'failed' ? 'error' : status === 'complete' ? 'success' : 'info';

    const title =
      stage === 'building'
        ? 'Building Application'
        : stage === 'deploying'
          ? 'Deploying Application'
          : 'Deployment Complete';

    const description =
      status === 'failed'
        ? `${stage === 'building' ? 'Build' : 'Deployment'} failed`
        : status === 'running'
          ? `${stage === 'building' ? 'Building' : 'Deploying'} your application...`
          : status === 'complete'
            ? `${stage === 'building' ? 'Build' : 'Deployment'} completed successfully`
            : `Preparing to ${stage === 'building' ? 'build' : 'deploy'} your application`;

    const buildStatus =
      stage === 'building' ? status : stage === 'deploying' || stage === 'complete' ? 'complete' : 'pending';

    const deployStatus = stage === 'building' ? 'pending' : status;

    this.onDeployAlert({
      type: alertType,
      title,
      description,
      content: details?.error || '',
      url: details?.url,
      stage,
      buildStatus: buildStatus as any,
      deployStatus: deployStatus as any,
      source: details?.source || 'netlify',
    });
  }
}
