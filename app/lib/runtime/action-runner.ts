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

const logger = createScopedLogger('ActionRunner');

/**
 * LLMs frequently hallucinate npm package names. This map auto-corrects
 * mistakes so `npm install` inside WebContainer doesn't fail with 404.
 */
const PACKAGE_NAME_CORRECTIONS: Record<string, string> = {
  // Lucide icons
  '@lucide/icons-react': 'lucide-react',
  '@lucide/react': 'lucide-react',
  'lucide-icons': 'lucide-react',
  '@lucide-icons/react': 'lucide-react',
  'lucide-react-icons': 'lucide-react',

  // Heroicons
  '@heroicons/react/solid': '@heroicons/react',
  '@heroicons/react/outline': '@heroicons/react',
  '@heroicons/react/24/solid': '@heroicons/react',
  '@heroicons/react/24/outline': '@heroicons/react',

  // Shadcn (not a real npm package)
  '@shadcn/ui': '@radix-ui/react-slot',
  'shadcn-ui': '@radix-ui/react-slot',

  // Router
  'react-router': 'react-router-dom',
  '@react-router': 'react-router-dom',

  // Icons
  'react-icon': 'react-icons',
  '@react-icons': 'react-icons',
  '@react-icons/all-files': 'react-icons',

  // Tailwind
  'tailwindcss/postcss': 'tailwindcss',
  '@tailwindcss/postcss': 'tailwindcss',
  '@tailwindcss/vite': 'tailwindcss',

  // Animation
  'framer-motion/react': 'framer-motion',
  '@framer-motion': 'framer-motion',
  '@framer-motion/react': 'framer-motion',

  // Toasts
  'react-hot-toast/headless': 'react-hot-toast',
  '@react-hot-toast': 'react-hot-toast',

  // React Query / TanStack
  '@tanstack/query': '@tanstack/react-query',
  'react-query': '@tanstack/react-query',
  '@tanstack/query-core': '@tanstack/react-query',

  // Forms
  '@hookform/resolvers/zod': '@hookform/resolvers',
  '@hookform/resolvers/yup': '@hookform/resolvers',

  // Axios
  '@axios': 'axios',
  'axios/dist': 'axios',

  // Zod
  'zod/lib': 'zod',
  '@zod': 'zod',

  // Date
  moment: 'date-fns',
  'moment-timezone': 'date-fns',

  // Clsx
  classnames: 'clsx',

  // Misc
  '@types/react-dom': '@types/react',

  // Pocketbase
  '@types/pocketbase': 'pocketbase',
  'pocketbase-types': 'pocketbase',
};

/**
 * Packages that ship their own TypeScript types — @types/* versions don't exist.
 * These will be REMOVED from devDependencies when found.
 */
const PACKAGES_TO_REMOVE = new Set([
  '@shadcn/components',
  '@shadcn/themes',
  'shadcn',
  '@nextui/react',

  // Packages that bundle their own types — no @types/* needed
  '@types/lucide-react',
  '@types/framer-motion',
  '@types/axios',
  '@types/zod',
  '@types/date-fns',
  '@types/clsx',
  '@types/sonner',
  '@types/react-router-dom',
  '@types/react-router',
  '@types/pocketbase',
  '@types/tailwindcss',
  '@types/vite',
]);

/**
 * Sanitizes an `npm install` shell command by:
 *  1. Replacing wrong package names using PACKAGE_NAME_CORRECTIONS
 *  2. Removing packages from PACKAGES_TO_REMOVE
 * Returns the cleaned command string (or original if no changes needed).
 */
function sanitizeNpmCommand(command: string): string {
  // Only process npm install / npm i commands
  if (!/npm\s+(install|i)\b/.test(command)) {
    return command;
  }

  // Split on whitespace but preserve flags (-D, --save-dev, etc.)
  const parts = command.split(/\s+/);
  const cleaned: string[] = [];
  let changed = false;

  for (const part of parts) {
    // Strip version suffix to get bare package name (e.g. "lucide-react@^0.344" → "lucide-react")
    const atVersionIdx = part.lastIndexOf('@');
    const bareName = atVersionIdx > 0 ? part.slice(0, atVersionIdx) : part;
    const version = atVersionIdx > 0 ? part.slice(atVersionIdx) : '';

    if (PACKAGES_TO_REMOVE.has(bareName)) {
      logger.info(`📦 Auto-remove from npm command: "${part}"`);
      changed = true;
      continue;
    }

    if (PACKAGE_NAME_CORRECTIONS[bareName]) {
      const corrected = PACKAGE_NAME_CORRECTIONS[bareName] + version;
      logger.info(`📦 Auto-fix in npm command: "${part}" → "${corrected}"`);
      cleaned.push(corrected);
      changed = true;
      continue;
    }

    cleaned.push(part);
  }

  if (!changed) {
    return command;
  }

  // If only "npm install" remains with no packages, run plain npm install
  return cleaned.join(' ');
}

/**
 * If React is a dependency and these are missing, auto-add them to devDependencies.
 */
const REACT_REQUIRED_DEV_DEPS: Record<string, string> = {
  '@vitejs/plugin-react': '^4.3.0',
};

function fixPackageJson(content: string): string {
  try {
    const pkg = JSON.parse(content);
    let changed = false;

    const allDepKeys = ['dependencies', 'devDependencies', 'peerDependencies'] as const;

    // 1. Fix wrong package names
    for (const depKey of allDepKeys) {
      const deps = pkg[depKey];

      if (!deps || typeof deps !== 'object') {
        continue;
      }

      for (const [wrong, correct] of Object.entries(PACKAGE_NAME_CORRECTIONS)) {
        if (wrong in deps) {
          const version = deps[wrong];
          delete deps[wrong];

          if (!(correct in deps)) {
            deps[correct] = version;
          }

          logger.info(`📦 Auto-fix pkg: "${wrong}" → "${correct}"`);
          changed = true;
        }
      }

      // Remove non-existent packages
      for (const badPkg of PACKAGES_TO_REMOVE) {
        if (badPkg in deps) {
          delete deps[badPkg];
          logger.info(`📦 Auto-remove non-existent: "${badPkg}"`);
          changed = true;
        }
      }
    }

    // 2. Ensure "type": "module" for Vite projects
    const hasVite = pkg.devDependencies?.vite || pkg.dependencies?.vite;

    if (hasVite && !pkg.type) {
      pkg.type = 'module';
      logger.info('📦 Auto-fix: added "type": "module" for Vite project');
      changed = true;
    }

    // 3. Ensure React projects have @vitejs/plugin-react
    const hasReact = pkg.dependencies?.react || pkg.devDependencies?.react;

    if (hasReact && hasVite) {
      if (!pkg.devDependencies) {
        pkg.devDependencies = {};
      }

      for (const [dep, version] of Object.entries(REACT_REQUIRED_DEV_DEPS)) {
        if (!pkg.devDependencies[dep] && !pkg.dependencies?.[dep]) {
          pkg.devDependencies[dep] = version;
          logger.info(`📦 Auto-add missing: "${dep}@${version}"`);
          changed = true;
        }
      }
    }

    // 4. Fix Vite version (upgrade v3/v4 → v5)
    for (const depKey of allDepKeys) {
      const deps = pkg[depKey];

      if (!deps) {
        continue;
      }

      if (deps.vite && /^\^?[34]\./.test(deps.vite)) {
        deps.vite = '^5.4.0';
        logger.info('📦 Auto-fix: upgraded vite to ^5.4.0');
        changed = true;
      }

      if (deps['@vitejs/plugin-react'] && /^\^?[123]\./.test(deps['@vitejs/plugin-react'])) {
        deps['@vitejs/plugin-react'] = '^4.3.0';
        logger.info('📦 Auto-fix: upgraded @vitejs/plugin-react to ^4.3.0');
        changed = true;
      }
    }

    // 5. Ensure scripts.dev exists
    if (!pkg.scripts) {
      pkg.scripts = {};
    }

    if (!pkg.scripts.dev && hasVite) {
      pkg.scripts.dev = 'vite';
      logger.info('📦 Auto-fix: added missing "dev": "vite" script');
      changed = true;
    }

    return changed ? JSON.stringify(pkg, null, 2) : content;
  } catch {
    return repairTruncatedJson(content);
  }
}

/**
 * Attempt to repair JSON that was truncated mid-generation (LLM ran out of tokens).
 * Strategy: remove the last incomplete key-value pair, then close all open braces/brackets.
 */
function repairTruncatedJson(content: string): string {
  let text = content.trim();

  if (!text.startsWith('{')) {
    return content;
  }

  // Remove trailing comma if present
  text = text.replace(/,\s*$/, '');

  /*
   * If we're inside an incomplete string value, remove it
   * e.g. `"@eslint/js":\n` or `"name": "my-` → remove the last incomplete pair
   */
  const lastCompleteEntry = text.lastIndexOf('",');

  if (lastCompleteEntry === -1) {
    return content;
  }

  // Cut to last complete key-value entry
  text = text.substring(0, lastCompleteEntry + 1);

  // Count open/close braces and brackets
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;

  for (const ch of text) {
    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\') {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (ch === '{') {
      openBraces++;
    } else if (ch === '}') {
      openBraces--;
    } else if (ch === '[') {
      openBrackets++;
    } else if (ch === ']') {
      openBrackets--;
    }
  }

  // Close all open brackets then braces
  text += '\n';

  for (let i = 0; i < openBrackets; i++) {
    text += ']';
  }

  for (let i = 0; i < openBraces; i++) {
    text += '}';
  }

  try {
    const repaired = JSON.parse(text);
    logger.warn(`🔧 Repaired truncated package.json (closed ${openBraces} braces, ${openBrackets} brackets)`);

    return JSON.stringify(repaired, null, 2);
  } catch {
    logger.error('🔧 Could not repair truncated package.json');

    return content;
  }
}

/**
 * Fix common LLM mistakes in vite.config files:
 * - Missing React plugin import/usage
 * - Wrong plugin syntax
 */
function fixViteConfig(content: string): string {
  let fixed = content;
  let changed = false;

  const hasReactPlugin = /plugin-react|@vitejs\/plugin-react/.test(fixed);
  const definesPlugins = /plugins\s*:/.test(fixed);

  if (!hasReactPlugin && definesPlugins) {
    if (!fixed.includes("from '@vitejs/plugin-react'")) {
      fixed = `import react from '@vitejs/plugin-react';\n${fixed}`;
      changed = true;
    }

    if (!/react\s*\(/.test(fixed)) {
      fixed = fixed.replace(/plugins\s*:\s*\[/, 'plugins: [react(), ');
      changed = true;
    }
  }

  if (!hasReactPlugin && !definesPlugins) {
    fixed = `import react from '@vitejs/plugin-react';\n${fixed}`;
    fixed = fixed.replace(
      /export\s+default\s+defineConfig\s*\(\s*\{/,
      'export default defineConfig({\n  plugins: [react()],',
    );
    changed = true;
  }

  // Fix require() in ESM config
  if (fixed.includes('require(') && fixed.includes('import ')) {
    fixed = fixed.replace(/const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\);?/g, "import $1 from '$2';");
    changed = true;
  }

  if (changed) {
    logger.info('⚙️ Auto-fix: patched vite.config');
  }

  return fixed;
}

/**
 * Fix common LLM mistakes in generated source files.
 */
function fixSourceImports(content: string, filePath: string): string {
  let fixed = content;
  let changed = false;

  // Fix wrong Lucide imports in source files
  const lucideImportPattern = /from\s+['"]@lucide\/(?:icons-react|react)['"]/g;

  if (lucideImportPattern.test(fixed)) {
    fixed = fixed.replace(lucideImportPattern, "from 'lucide-react'");
    logger.info(`⚙️ Auto-fix imports in ${filePath}: @lucide/* → lucide-react`);
    changed = true;
  }

  // Fix wrong react-router import
  const routerPattern = /from\s+['"]react-router['"]/g;

  if (routerPattern.test(fixed) && !fixed.includes('react-router-dom')) {
    fixed = fixed.replace(routerPattern, "from 'react-router-dom'");
    logger.info(`⚙️ Auto-fix imports in ${filePath}: react-router → react-router-dom`);
    changed = true;
  }

  // Fix wrong react-query import
  const queryPattern = /from\s+['"]react-query['"]/g;

  if (queryPattern.test(fixed)) {
    fixed = fixed.replace(queryPattern, "from '@tanstack/react-query'");
    logger.info(`⚙️ Auto-fix imports in ${filePath}: react-query → @tanstack/react-query`);
    changed = true;
  }

  /*
   * Fix wrong PocketBase named import: { PocketBase } → default import
   * pocketbase uses default export, not named export
   */
  const pbNamedImport = /import\s*\{\s*PocketBase\s*\}\s*from\s*['"]pocketbase['"]/g;

  if (pbNamedImport.test(fixed)) {
    fixed = fixed.replace(pbNamedImport, "import PocketBase from 'pocketbase'");
    logger.info(`⚙️ Auto-fix imports in ${filePath}: { PocketBase } → default import`);
    changed = true;
  }

  // Fix wrong axios named import: { axios } → default import
  const axiosNamedImport = /import\s*\{\s*axios\s*\}\s*from\s*['"]axios['"]/g;

  if (axiosNamedImport.test(fixed)) {
    fixed = fixed.replace(axiosNamedImport, "import axios from 'axios'");
    logger.info(`⚙️ Auto-fix imports in ${filePath}: { axios } → default import`);
    changed = true;
  }

  // Fix wrong framer-motion import path
  const framerPattern = /from\s+['"]framer-motion\/react['"]/g;

  if (framerPattern.test(fixed)) {
    fixed = fixed.replace(framerPattern, "from 'framer-motion'");
    logger.info(`⚙️ Auto-fix imports in ${filePath}: framer-motion/react → framer-motion`);
    changed = true;
  }

  /*
   * Wrap raw PocketBase useEffect calls with error handling
   * Detects patterns like: useEffect(() => { pb.collection(...).getList(...) }, [])
   * where the PocketBase call lacks try/catch — which crashes the app if PocketBase is unreachable
   */
  if (
    fixed.includes('pocketbase') &&
    fixed.includes('useEffect') &&
    fixed.includes('.getList(') &&
    !fixed.includes('.catch(')
  ) {
    // Add .catch(() => {}) to any bare pb.collection().getList() chains inside useEffect
    const bareGetList = /(\bpb\.collection\([^)]+\)\.getList\([^)]*\))(?![\s\S]*?\.catch)/g;

    if (bareGetList.test(fixed)) {
      fixed = fixed.replace(bareGetList, '$1.catch(() => {})');
      logger.info(`⚙️ Auto-fix: added .catch() to bare PocketBase getList() in ${filePath}`);
      changed = true;
    }
  }

  // Fix require() mixed with import in .ts/.tsx/.jsx files
  if (/\.(tsx?|jsx)$/.test(filePath) && fixed.includes('require(')) {
    fixed = fixed.replace(/const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\);?/g, "import $1 from '$2';");

    if (fixed !== content) {
      logger.info(`⚙️ Auto-fix: converted require() → import in ${filePath}`);
      changed = true;
    }
  }

  return changed ? fixed : content;
}

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
    // Create a formatted message that includes both the error message and output
    const formattedMessage = `Failed To Execute Shell Command: ${message}\n\nOutput:\n${output}`;
    super(formattedMessage);

    // Set the output separately so it can be accessed programmatically
    this._header = message;
    this._output = output;

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, ActionCommandError.prototype);

    // Set the name of the error for better debugging
    this.name = 'ActionCommandError';
  }

  // Optional: Add a method to get just the terminal output
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
      // action already added
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
      return; // No return value here
    }

    if (isStreaming && action.type !== 'file') {
      return; // No return value here
    }

    this.#updateAction(actionId, { ...action, ...data.action, executed: !isStreaming });

    this.#currentExecutionPromise = this.#currentExecutionPromise
      .then(() => {
        return this.#executeAction(actionId, isStreaming);
      })
      .catch((error) => {
        console.error('Action failed:', error);
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
          } catch (error: any) {
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

          // Store build output for deployment
          this.buildOutput = buildOutput;
          break;
        }
        case 'start': {
          // making the start app non blocking

          this.#runStartAction(action)
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

          /*
           * adding a delay to avoid any race condition between 2 start actions
           * i am up for a better approach
           */
          await new Promise((resolve) => setTimeout(resolve, 2000));

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

      // re-throw the error to be caught in the promise chain
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

    const resp = await shell.executeCommand(this.runnerId.get(), sanitizedCommand, () => {
      logger.debug(`[${action.type}]:Aborting Action\n\n`, action);
      action.abort();
    });
    logger.debug(`${action.type} Shell Response: [exit code:${resp?.exitCode}]`);

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

  /**
   * Parse E404 package from npm output, remove it from package.json, and retry.
   */
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

    const resp = await shell.executeCommand(this.runnerId.get(), action.content, () => {
      logger.debug(`[${action.type}]:Aborting Action\n\n`, action);
      action.abort();
    });
    logger.debug(`${action.type} Shell Response: [exit code:${resp?.exitCode}]`);

    if (resp?.exitCode != 0) {
      throw new ActionCommandError('Failed To Start Application', resp?.output || 'No Output Available');
    }

    return resp;
  }

  async #runFileAction(action: ActionState) {
    if (action.type !== 'file') {
      unreachable('Expected file action');
    }

    const webcontainer = await this.#webcontainer;
    const relativePath = nodePath.relative(webcontainer.workdir, action.filePath);

    let folder = nodePath.dirname(relativePath);

    // remove trailing slashes
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

      if (relativePath === 'package.json' || relativePath.endsWith('/package.json')) {
        fileContent = fixPackageJson(fileContent);
      } else if (/vite\.config\.(ts|js|mjs)$/.test(relativePath)) {
        fileContent = fixViteConfig(fileContent);
      } else if (/\.(tsx?|jsx)$/.test(relativePath)) {
        fileContent = fixSourceImports(fileContent, relativePath);
      }

      await webcontainer.fs.writeFile(relativePath, fileContent);
      logger.debug(`File written ${relativePath}`);
    } catch (error) {
      logger.error('Failed to write file\n\n', error);
      throw error;
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
    // const webcontainer = await this.#webcontainer;
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

    // Trigger build started alert
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

    // Create a new terminal specifically for the build
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
      // Trigger build failed alert
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

    // Trigger build success alert
    this.onDeployAlert?.({
      type: 'success',
      title: 'Build Completed',
      description: 'Your application was built successfully',
      stage: 'deploying',
      buildStatus: 'complete',
      deployStatus: 'running',
      source: 'netlify',
    });

    // Check for common build directories
    const commonBuildDirs = ['dist', 'build', 'out', 'output', '.next', 'public'];

    let buildDir = '';

    // Try to find the first existing build directory
    for (const dir of commonBuildDirs) {
      const dirPath = nodePath.join(webcontainer.workdir, dir);

      try {
        await webcontainer.fs.readdir(dirPath);
        buildDir = dirPath;
        logger.debug(`Found build directory: ${buildDir}`);
        break;
      } catch (error) {
        // Directory doesn't exist, try the next one
        logger.debug(`Build directory ${dir} not found, trying next option. ${error}`);
      }
    }

    // If no build directory was found, use the default (dist)
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

  // Add this method declaration to the class
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
