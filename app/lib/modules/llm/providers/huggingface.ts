import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { logger } from '~/utils/logger';

export default class HuggingFaceProvider extends BaseProvider {
  name = 'HuggingFace';
  getApiKeyLink = 'https://huggingface.co/settings/tokens';

  config = {
    apiTokenKey: 'HuggingFace_API_KEY',
  };

  staticModels: ModelInfo[] = [
    // --- Top-tier coding models (free serverless) ---
    {
      name: 'Qwen/Qwen3-Coder-480B-A35B-Instruct',
      label: 'Qwen3 Coder 480B-A35B (best coding)',
      provider: 'HuggingFace',
      maxTokenAllowed: 32768,
    },
    {
      name: 'Qwen/Qwen3-Coder-30B-A3B-Instruct',
      label: 'Qwen3 Coder 30B-A3B',
      provider: 'HuggingFace',
      maxTokenAllowed: 32768,
    },
    {
      name: 'Qwen/Qwen2.5-Coder-32B-Instruct',
      label: 'Qwen2.5 Coder 32B',
      provider: 'HuggingFace',
      maxTokenAllowed: 32768,
    },

    // --- Reasoning models ---
    {
      name: 'deepseek-ai/DeepSeek-R1',
      label: 'DeepSeek R1 671B (reasoning)',
      provider: 'HuggingFace',
      maxTokenAllowed: 32768,
    },
    {
      name: 'deepseek-ai/DeepSeek-R1-0528',
      label: 'DeepSeek R1 0528 (reasoning)',
      provider: 'HuggingFace',
      maxTokenAllowed: 32768,
    },
    {
      name: 'Qwen/QwQ-32B',
      label: 'QwQ 32B (reasoning)',
      provider: 'HuggingFace',
      maxTokenAllowed: 32768,
    },
    {
      name: 'moonshotai/Kimi-K2-Thinking',
      label: 'Kimi K2 Thinking (reasoning)',
      provider: 'HuggingFace',
      maxTokenAllowed: 32768,
    },

    // --- General chat / instruction models ---
    {
      name: 'deepseek-ai/DeepSeek-V3-0324',
      label: 'DeepSeek V3 0324',
      provider: 'HuggingFace',
      maxTokenAllowed: 32768,
    },
    {
      name: 'deepseek-ai/DeepSeek-V3.2',
      label: 'DeepSeek V3.2',
      provider: 'HuggingFace',
      maxTokenAllowed: 32768,
    },
    {
      name: 'moonshotai/Kimi-K2-Instruct',
      label: 'Kimi K2 Instruct',
      provider: 'HuggingFace',
      maxTokenAllowed: 32768,
    },
    {
      name: 'meta-llama/Llama-3.3-70B-Instruct',
      label: 'Llama 3.3 70B Instruct',
      provider: 'HuggingFace',
      maxTokenAllowed: 32768,
    },
    {
      name: 'meta-llama/Llama-3.1-8B-Instruct',
      label: 'Llama 3.1 8B Instruct',
      provider: 'HuggingFace',
      maxTokenAllowed: 8192,
    },
    {
      name: 'openai/gpt-oss-120b',
      label: 'GPT-OSS 120B',
      provider: 'HuggingFace',
      maxTokenAllowed: 32768,
    },
    {
      name: 'openai/gpt-oss-20b',
      label: 'GPT-OSS 20B',
      provider: 'HuggingFace',
      maxTokenAllowed: 32768,
    },
    {
      name: 'zai-org/GLM-5',
      label: 'GLM-5',
      provider: 'HuggingFace',
      maxTokenAllowed: 32768,
    },
    {
      name: 'zai-org/GLM-4.7',
      label: 'GLM-4.7',
      provider: 'HuggingFace',
      maxTokenAllowed: 32768,
    },
    {
      name: 'zai-org/GLM-4.7-Flash',
      label: 'GLM-4.7 Flash (fast)',
      provider: 'HuggingFace',
      maxTokenAllowed: 32768,
    },
    {
      name: 'MiniMaxAI/MiniMax-M2.5',
      label: 'MiniMax M2.5',
      provider: 'HuggingFace',
      maxTokenAllowed: 32768,
    },
    {
      name: 'Qwen/Qwen3-235B-A22B',
      label: 'Qwen3 235B-A22B',
      provider: 'HuggingFace',
      maxTokenAllowed: 32768,
    },
    {
      name: 'Qwen/Qwen3-8B',
      label: 'Qwen3 8B',
      provider: 'HuggingFace',
      maxTokenAllowed: 32768,
    },
    {
      name: 'google/gemma-2-9b-it',
      label: 'Gemma 2 9B IT',
      provider: 'HuggingFace',
      maxTokenAllowed: 8192,
    },
    {
      name: 'mistralai/Mistral-7B-Instruct-v0.2',
      label: 'Mistral 7B Instruct v0.2',
      provider: 'HuggingFace',
      maxTokenAllowed: 8192,
    },

    // --- Distilled reasoning ---
    {
      name: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
      label: 'DeepSeek R1 Distill Qwen 32B',
      provider: 'HuggingFace',
      maxTokenAllowed: 32768,
    },
    {
      name: 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B',
      label: 'DeepSeek R1 0528 Qwen3 8B',
      provider: 'HuggingFace',
      maxTokenAllowed: 16384,
    },
  ];

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv: Record<string, string> = {},
  ): Promise<ModelInfo[]> {
    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: settings,
      serverEnv,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'HuggingFace_API_KEY',
    });

    if (!apiKey) {
      return [];
    }

    try {
      const resp = await fetch(
        'https://huggingface.co/api/models?pipeline_tag=text-generation&inference=warm&sort=likes&direction=-1&limit=50&filter=conversational',
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );

      if (!resp.ok) {
        return [];
      }

      const models = (await resp.json()) as Array<{ id: string; likes: number }>;

      const staticNames = new Set(this.staticModels.map((m) => m.name));

      return models
        .filter((m) => !staticNames.has(m.id))
        .map((m) => ({
          name: m.id,
          label: `${m.id} [${m.likes} likes]`,
          provider: this.name,
          maxTokenAllowed: 8192,
        }));
    } catch (err) {
      logger.warn('HuggingFace: failed to fetch dynamic models', err);
      return [];
    }
  }

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { model, serverEnv, apiKeys, providerSettings } = options;

    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'HuggingFace_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    const openai = createOpenAI({
      baseURL: 'https://router.huggingface.co/hf-inference/v1/',
      apiKey,
    });

    return openai(model);
  }
}
