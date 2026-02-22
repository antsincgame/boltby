import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('ResourceManager');

interface OllamaPsModel {
  name: string;
  model: string;
  size: number;
  digest: string;
  expires_at: string;
}

interface LMStudioModelInfo {
  key: string;
  type: string;
  max_context_length?: number;
  loaded_instances: Array<{
    id: string;
    config: { context_length: number };
  }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

class ResourceManager {
  private static _instance: ResourceManager;

  private _activeProvider: string | null = null;
  private _activeModel: string | null = null;

  static getInstance(): ResourceManager {
    if (!ResourceManager._instance) {
      ResourceManager._instance = new ResourceManager();
    }

    return ResourceManager._instance;
  }

  private _getOllamaUrl(): string {
    return process?.env?.OLLAMA_API_BASE_URL || 'http://127.0.0.1:11434';
  }

  private _getLMStudioUrl(): string {
    return process?.env?.LMSTUDIO_API_BASE_URL || 'http://127.0.0.1:1234';
  }

  async isOllamaReachable(baseUrl?: string): Promise<boolean> {
    try {
      const url = baseUrl || this._getOllamaUrl();
      const resp = await fetch(`${url}/api/ps`, { signal: AbortSignal.timeout(3000) });

      return resp.ok;
    } catch {
      return false;
    }
  }

  async isLMStudioReachable(baseUrl?: string): Promise<boolean> {
    try {
      const url = baseUrl || this._getLMStudioUrl();
      const resp = await fetch(`${url}/api/v1/models`, { signal: AbortSignal.timeout(3000) });

      return resp.ok;
    } catch {
      return false;
    }
  }

  private async _unloadAllOllama(baseUrl: string): Promise<number> {
    let count = 0;

    try {
      const psResp = await fetch(`${baseUrl}/api/ps`, { signal: AbortSignal.timeout(5000) });
      const psData = (await psResp.json()) as { models: OllamaPsModel[] };

      for (const loaded of psData.models || []) {
        logger.info(`[UNLOAD] Ollama: ${loaded.name} (${(loaded.size / 1e9).toFixed(1)} GB)`);

        await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: loaded.name, keep_alive: 0 }),
        });
        count++;
      }

      if (count > 0) {
        logger.info(`[UNLOAD] Ollama: freed ${count} model(s)`);
        await sleep(2000);
      }
    } catch {
      logger.debug('[UNLOAD] Ollama: server not reachable');
    }

    return count;
  }

  private async _unloadAllLMStudio(baseUrl: string): Promise<number> {
    let count = 0;

    try {
      const resp = await fetch(`${baseUrl}/api/v1/models`, { signal: AbortSignal.timeout(5000) });
      const data = (await resp.json()) as { models: LMStudioModelInfo[] };

      for (const m of data.models || []) {
        if (m.type !== 'llm' || !m.loaded_instances?.length) {
          continue;
        }

        for (const inst of m.loaded_instances) {
          logger.info(`[UNLOAD] LMStudio: ${m.key} (ctx=${inst.config.context_length})`);

          await fetch(`${baseUrl}/api/v1/models/unload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instance_id: inst.id }),
          });
          count++;
        }
      }

      if (count > 0) {
        logger.info(`[UNLOAD] LMStudio: freed ${count} model(s)`);
        await sleep(2000);
      }
    } catch {
      logger.debug('[UNLOAD] LMStudio: server not reachable');
    }

    return count;
  }

  private async _waitForLMStudioModel(baseUrl: string, modelKey: string, timeoutMs: number = 30000): Promise<boolean> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const resp = await fetch(`${baseUrl}/api/v1/models`, { signal: AbortSignal.timeout(3000) });
        const data = (await resp.json()) as { models: LMStudioModelInfo[] };
        const model = data.models.find((m) => m.key === modelKey);

        if (model?.loaded_instances?.length) {
          const ctx = model.loaded_instances[0].config.context_length;
          logger.info(`[READY] LMStudio: ${modelKey} loaded (ctx=${ctx})`);

          return true;
        }
      } catch {
        /* retry */
      }

      await sleep(1000);
    }

    logger.warn(`[TIMEOUT] LMStudio: ${modelKey} did not load within ${timeoutMs}ms`);

    return false;
  }

  async prepareOllama(baseUrl: string, keepModel: string): Promise<void> {
    if (this._activeProvider === 'Ollama' && this._activeModel === keepModel) {
      logger.debug(`[SKIP] Ollama/${keepModel} already active`);
      return;
    }

    const reachable = await this.isOllamaReachable(baseUrl);

    if (!reachable) {
      this._activeProvider = null;
      this._activeModel = null;
      throw new Error(
        `Ollama server is not running at ${baseUrl}. Please start Ollama first (run "ollama serve" in terminal).`,
      );
    }

    logger.info(`========== RESOURCE SWITCH ==========`);
    logger.info(`[TARGET] Ollama / ${keepModel}`);
    logger.info(`[PREV]   ${this._activeProvider || 'none'} / ${this._activeModel || 'none'}`);

    await this._unloadAllLMStudio(this._getLMStudioUrl());

    try {
      const psResp = await fetch(`${baseUrl}/api/ps`);
      const psData = (await psResp.json()) as { models: OllamaPsModel[] };

      let unloaded = 0;

      for (const loaded of psData.models || []) {
        if (loaded.name === keepModel) {
          logger.info(`[KEEP] Ollama: ${loaded.name} already loaded`);
          continue;
        }

        logger.info(`[UNLOAD] Ollama: ${loaded.name}`);

        await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: loaded.name, keep_alive: 0 }),
        });
        unloaded++;
      }

      if (unloaded > 0) {
        await sleep(2000);
      }
    } catch (err) {
      logger.warn(`[ERROR] Ollama cleanup: ${String(err)}`);
    }

    this._activeProvider = 'Ollama';
    this._activeModel = keepModel;
    logger.info(`[DONE] Ollama/${keepModel} ready`);
    logger.info(`=====================================`);
  }

  async prepareLMStudio(baseUrl: string, keepModel: string, desiredCtx: number = 32768): Promise<void> {
    if (this._activeProvider === 'LMStudio' && this._activeModel === keepModel) {
      logger.debug(`[SKIP] LMStudio/${keepModel} already active`);
      return;
    }

    const reachable = await this.isLMStudioReachable(baseUrl);

    if (!reachable) {
      this._activeProvider = null;
      this._activeModel = null;
      throw new Error(
        `LM Studio server is not running at ${baseUrl}. Please start LM Studio and enable the local server.`,
      );
    }

    logger.info(`========== RESOURCE SWITCH ==========`);
    logger.info(`[TARGET] LMStudio / ${keepModel}`);
    logger.info(`[PREV]   ${this._activeProvider || 'none'} / ${this._activeModel || 'none'}`);

    await this._unloadAllOllama(this._getOllamaUrl());

    let keepModelLoaded = false;

    try {
      const resp = await fetch(`${baseUrl}/api/v1/models`);
      const data = (await resp.json()) as { models: LMStudioModelInfo[] };

      for (const m of data.models || []) {
        if (m.type !== 'llm' || !m.loaded_instances?.length) {
          continue;
        }

        for (const inst of m.loaded_instances) {
          if (m.key === keepModel) {
            keepModelLoaded = true;
            logger.info(`[KEEP] LMStudio: ${m.key} already loaded (ctx=${inst.config.context_length})`);
            continue;
          }

          logger.info(`[UNLOAD] LMStudio: ${m.key} (ctx=${inst.config.context_length})`);

          await fetch(`${baseUrl}/api/v1/models/unload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instance_id: inst.id }),
          });
        }
      }

      if (!keepModelLoaded) {
        const targetModel = data.models.find((m) => m.key === keepModel);

        if (targetModel) {
          const maxCtx = targetModel.max_context_length || 131072;
          const ctx = Math.min(desiredCtx, maxCtx);

          logger.info(`[LOAD] LMStudio: ${keepModel} (ctx=${ctx}, max=${maxCtx})`);

          const loadResp = await fetch(`${baseUrl}/api/v1/models/load`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: keepModel,
              context_length: ctx,
              flash_attention: true,
            }),
          });

          const loadResult = await loadResp.json();
          logger.info(`[LOAD] LMStudio result: ${JSON.stringify(loadResult)}`);

          await this._waitForLMStudioModel(baseUrl, keepModel);
        } else {
          throw new Error(
            `Model "${keepModel}" not found in LM Studio. Available models: ${data.models.map((m) => m.key).join(', ')}`,
          );
        }
      }
    } catch (err) {
      if (err instanceof Error && (err.message.includes('not running') || err.message.includes('not found'))) {
        throw err;
      }

      logger.error(`[ERROR] LMStudio resource management: ${String(err)}`);
      throw new Error(`Failed to prepare LM Studio model "${keepModel}": ${String(err)}`);
    }

    this._activeProvider = 'LMStudio';
    this._activeModel = keepModel;
    logger.info(`[DONE] LMStudio/${keepModel} ready`);
    logger.info(`=====================================`);
  }

  async unloadAll(): Promise<void> {
    if (!this._activeProvider) {
      return;
    }

    logger.info(`========== RESOURCE CLEANUP ==========`);
    logger.info(`[CLEANUP] Switching to cloud provider, freeing local resources`);
    logger.info(`[PREV] ${this._activeProvider} / ${this._activeModel}`);

    const ollamaFreed = await this._unloadAllOllama(this._getOllamaUrl());
    const lmsFreed = await this._unloadAllLMStudio(this._getLMStudioUrl());

    logger.info(`[DONE] Freed ${ollamaFreed + lmsFreed} model(s) total`);
    logger.info(`======================================`);

    this._activeProvider = null;
    this._activeModel = null;
  }

  resetTracking(): void {
    this._activeProvider = null;
    this._activeModel = null;
  }
}

export const resourceManager = ResourceManager.getInstance();
