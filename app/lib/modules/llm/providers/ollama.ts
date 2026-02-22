import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { ollama } from 'ollama-ai-provider';
import { logger } from '~/utils/logger';

interface OllamaModelDetails {
  parent_model: string;
  format: string;
  family: string;
  families: string[];
  parameter_size: string;
  quantization_level: string;
}

export interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: OllamaModelDetails;
}

export interface OllamaApiResponse {
  models: OllamaModel[];
}

/**
 * Pick a safe num_ctx based on model weight file size.
 * Larger models need more RAM per context token, so we cap accordingly.
 */
function pickNumCtx(modelSizeBytes: number, desiredCtx: number): number {
  const sizeGB = modelSizeBytes / (1024 * 1024 * 1024);

  if (sizeGB > 20) {
    return Math.min(desiredCtx, 8192);
  }

  if (sizeGB > 10) {
    return Math.min(desiredCtx, 16384);
  }

  return desiredCtx;
}

export default class OllamaProvider extends BaseProvider {
  name = 'Ollama';
  getApiKeyLink = 'https://ollama.com/download';
  labelForGetApiKey = 'Download Ollama';
  icon = 'i-ph:cloud-arrow-down';

  config = {
    baseUrlKey: 'OLLAMA_API_BASE_URL',
  };

  staticModels: ModelInfo[] = [];

  private _modelSizeMap = new Map<string, number>();

  private _convertEnvToRecord(env?: Env): Record<string, string> {
    if (!env) {
      return {};
    }

    return Object.entries(env).reduce(
      (acc, [key, value]) => {
        acc[key] = String(value);
        return acc;
      },
      {} as Record<string, string>,
    );
  }

  getDefaultNumCtx(serverEnv?: Env): number {
    const envRecord = this._convertEnvToRecord(serverEnv);
    return envRecord.DEFAULT_NUM_CTX ? parseInt(envRecord.DEFAULT_NUM_CTX, 10) : 32768;
  }

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv: Record<string, string> = {},
  ): Promise<ModelInfo[]> {
    let { baseUrl } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: settings,
      serverEnv,
      defaultBaseUrlKey: 'OLLAMA_API_BASE_URL',
      defaultApiTokenKey: '',
    });

    if (!baseUrl) {
      throw new Error('No baseUrl found for OLLAMA provider');
    }

    if (typeof window === 'undefined') {
      const isDocker = process?.env?.RUNNING_IN_DOCKER === 'true' || serverEnv?.RUNNING_IN_DOCKER === 'true';

      baseUrl = isDocker ? baseUrl.replace('localhost', 'host.docker.internal') : baseUrl;
      baseUrl = isDocker ? baseUrl.replace('127.0.0.1', 'host.docker.internal') : baseUrl;
    }

    const response = await fetch(`${baseUrl}/api/tags`);
    const data = (await response.json()) as OllamaApiResponse;

    const desiredCtx = this.getDefaultNumCtx(serverEnv as unknown as Env);

    return data.models.map((model: OllamaModel) => {
      this._modelSizeMap.set(model.name, model.size);

      const numCtx = pickNumCtx(model.size, desiredCtx);

      return {
        name: model.name,
        label: `${model.name} (${model.details.parameter_size})`,
        provider: this.name,
        maxTokenAllowed: numCtx,
      };
    });
  }

  getModelInstance: (options: {
    model: string;
    serverEnv?: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }) => LanguageModelV1 = (options) => {
    const { apiKeys, providerSettings, serverEnv, model } = options;
    const envRecord = this._convertEnvToRecord(serverEnv);

    let { baseUrl } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: envRecord,
      defaultBaseUrlKey: 'OLLAMA_API_BASE_URL',
      defaultApiTokenKey: '',
    });

    if (!baseUrl) {
      throw new Error('No baseUrl found for OLLAMA provider');
    }

    const isDocker = process?.env?.RUNNING_IN_DOCKER === 'true' || envRecord.RUNNING_IN_DOCKER === 'true';
    baseUrl = isDocker ? baseUrl.replace('localhost', 'host.docker.internal') : baseUrl;
    baseUrl = isDocker ? baseUrl.replace('127.0.0.1', 'host.docker.internal') : baseUrl;

    const desiredCtx = this.getDefaultNumCtx(serverEnv);
    const modelSize = this._modelSizeMap.get(model) || 0;
    const numCtx = pickNumCtx(modelSize, desiredCtx);

    logger.info(`Ollama: ${model} (${(modelSize / 1e9).toFixed(1)}GB) → num_ctx=${numCtx}`);

    const ollamaInstance = ollama(model, {
      numCtx,
    }) as LanguageModelV1 & { config: any };

    ollamaInstance.config.baseURL = `${baseUrl}/api`;

    return ollamaInstance;
  };
}
