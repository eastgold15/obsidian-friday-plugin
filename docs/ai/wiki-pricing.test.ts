/**
 * Wiki Pricing Unit Tests
 *
 * 纯逻辑单元测试，不依赖 LLM / 网络。
 * 覆盖场景：
 *  1. 精确匹配已知模型
 *  2. 通配符匹配（本地模型 ollama / lmstudio）
 *  3. 未知 provider 返回 undefined
 *  4. 已知 provider 但未知 model → 回退通配符
 *  5. 零费用本地模型
 *  6. 大小写不敏感匹配
 *  7. calculateCost 数值精度
 *  8. isExact 标志
 *  9. ObsidianWikiService.calculateCost / getPricingTable 接口层
 * 10. isLocal 标志
 */

import { describe, it, expect } from 'vitest';
import {
  findPricing,
  estimateCost,
  calculateCost,
  MODEL_PRICING,
} from '@internal/domain/wiki';
import { createObsidianWikiService } from '@internal/interfaces/obsidian/desktop';

// ---------------------------------------------------------------------------
// Domain layer tests
// ---------------------------------------------------------------------------

describe('findPricing', () => {
  it('finds exact match for openai gpt-4o', () => {
    const p = findPricing('openai', 'gpt-4o');
    expect(p).toBeDefined();
    expect(p!.provider).toBe('openai');
    expect(p!.model).toBe('gpt-4o');
    expect(p!.inputPer1M).toBe(5);
    expect(p!.outputPer1M).toBe(15);
    expect(p!.currency).toBe('USD');
    expect(p!.isLocal).toBeUndefined();
  });

  it('finds exact match for deepseek-chat', () => {
    const p = findPricing('deepseek', 'deepseek-chat');
    expect(p).toBeDefined();
    expect(p!.inputPer1M).toBe(0.27);
    expect(p!.outputPer1M).toBe(1.1);
  });

  it('finds exact match for deepseek-reasoner', () => {
    const p = findPricing('deepseek', 'deepseek-reasoner');
    expect(p).toBeDefined();
    expect(p!.inputPer1M).toBe(0.55);
    expect(p!.outputPer1M).toBe(2.19);
  });

  it('finds exact match for glm-4-plus', () => {
    const p = findPricing('glm', 'glm-4-plus');
    expect(p).toBeDefined();
    expect(p!.inputPer1M).toBe(0.7);
  });

  it('finds wildcard match for ollama (any model)', () => {
    const p = findPricing('ollama', 'llama3.2');
    expect(p).toBeDefined();
    expect(p!.isLocal).toBe(true);
    expect(p!.inputPer1M).toBe(0);
    expect(p!.outputPer1M).toBe(0);
  });

  it('finds wildcard match for lmstudio', () => {
    const p = findPricing('lmstudio', 'qwen3.5-9b');
    expect(p).toBeDefined();
    expect(p!.isLocal).toBe(true);
  });

  it('returns undefined for completely unknown provider', () => {
    const p = findPricing('unknown-provider', 'some-model');
    expect(p).toBeUndefined();
  });

  it('returns undefined for known provider with no wildcard and unknown model', () => {
    // openai 只有精确型条目，没有通配符
    const p = findPricing('openai', 'gpt-99-ultra');
    expect(p).toBeUndefined();
  });

  it('is case-insensitive for provider and model', () => {
    expect(findPricing('OpenAI', 'GPT-4O')).toBeDefined();
    expect(findPricing('DEEPSEEK', 'DeepSeek-Chat')).toBeDefined();
    expect(findPricing('Ollama', 'SomeModel')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
describe('calculateCost (raw)', () => {
  it('calculates cost correctly for known pricing', () => {
    const pricing = findPricing('openai', 'gpt-4o')!;
    // 1000 input + 500 output
    // input:  (1000 / 1_000_000) * 5   = 0.005 USD
    // output: (500  / 1_000_000) * 15  = 0.0075 USD
    // total:  0.0125 USD
    const cost = calculateCost(pricing, 1000, 500);
    expect(cost).toBeCloseTo(0.0125, 8);
  });

  it('returns 0 for local model', () => {
    const pricing = findPricing('ollama', 'anything')!;
    expect(calculateCost(pricing, 100_000, 50_000)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('estimateCost', () => {
  it('returns full breakdown for known model', () => {
    const result = estimateCost('openai', 'gpt-4o', 1200, 800);
    expect(result).toBeDefined();
    expect(result!.provider).toBe('openai');
    expect(result!.model).toBe('gpt-4o');
    expect(result!.inputTokens).toBe(1200);
    expect(result!.outputTokens).toBe(800);
    expect(result!.inputCost).toBeCloseTo((1200 / 1_000_000) * 5, 10);
    expect(result!.outputCost).toBeCloseTo((800 / 1_000_000) * 15, 10);
    expect(result!.totalCost).toBeCloseTo(result!.inputCost + result!.outputCost, 10);
    expect(result!.currency).toBe('USD');
    expect(result!.isExact).toBe(true);
    expect(result!.isLocal).toBe(false);
  });

  it('sets isExact=false for wildcard match (ollama)', () => {
    const result = estimateCost('ollama', 'llama3.2', 500, 200);
    expect(result).toBeDefined();
    expect(result!.isExact).toBe(false);
    // model name should be preserved as passed in
    expect(result!.model).toBe('llama3.2');
    expect(result!.totalCost).toBe(0);
    expect(result!.isLocal).toBe(true);
  });

  it('returns undefined for unknown provider', () => {
    expect(estimateCost('anthropic', 'claude-3', 1000, 500)).toBeUndefined();
  });

  it('returns undefined for known provider but unregistered model (no wildcard)', () => {
    expect(estimateCost('openai', 'gpt-99-nonexistent', 1000, 500)).toBeUndefined();
  });

  it('handles zero tokens', () => {
    const result = estimateCost('openai', 'gpt-4o', 0, 0);
    expect(result).toBeDefined();
    expect(result!.totalCost).toBe(0);
  });

  it('handles large token counts correctly', () => {
    // 1M tokens each at gpt-4o pricing: $5 input + $15 output = $20
    const result = estimateCost('openai', 'gpt-4o', 1_000_000, 1_000_000);
    expect(result).toBeDefined();
    expect(result!.inputCost).toBeCloseTo(5, 6);
    expect(result!.outputCost).toBeCloseTo(15, 6);
    expect(result!.totalCost).toBeCloseTo(20, 6);
  });

  it('calculates deepseek-chat correctly', () => {
    // 10000 input at $0.27/M + 5000 output at $1.1/M
    const result = estimateCost('deepseek', 'deepseek-chat', 10_000, 5_000);
    expect(result).toBeDefined();
    expect(result!.inputCost).toBeCloseTo((10_000 / 1_000_000) * 0.27, 10);
    expect(result!.outputCost).toBeCloseTo((5_000 / 1_000_000) * 1.1, 10);
  });

  it('moonshot-v1-128k pricing', () => {
    const result = estimateCost('moonshot', 'moonshot-v1-128k', 2000, 1000);
    expect(result).toBeDefined();
    expect(result!.inputCost).toBeCloseTo((2000 / 1_000_000) * 0.7, 10);
    expect(result!.outputCost).toBeCloseTo((1000 / 1_000_000) * 2.8, 10);
  });
});

// ---------------------------------------------------------------------------
describe('MODEL_PRICING table', () => {
  it('has at least one entry for each major provider', () => {
    const providers = new Set(MODEL_PRICING.map(p => p.provider));
    expect(providers.has('openai')).toBe(true);
    expect(providers.has('deepseek')).toBe(true);
    expect(providers.has('glm')).toBe(true);
    expect(providers.has('moonshot')).toBe(true);
    expect(providers.has('ollama')).toBe(true);
    expect(providers.has('lmstudio')).toBe(true);
  });

  it('all entries have required fields', () => {
    for (const p of MODEL_PRICING) {
      expect(typeof p.provider).toBe('string');
      expect(typeof p.model).toBe('string');
      expect(typeof p.inputPer1M).toBe('number');
      expect(typeof p.outputPer1M).toBe('number');
      expect(p.currency).toBe('USD');
    }
  });

  it('local models have isLocal=true and zero prices', () => {
    const localModels = MODEL_PRICING.filter(p => p.isLocal);
    expect(localModels.length).toBeGreaterThan(0);
    for (const p of localModels) {
      expect(p.inputPer1M).toBe(0);
      expect(p.outputPer1M).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Interface layer tests (ObsidianWikiService)
// ---------------------------------------------------------------------------

describe('ObsidianWikiService.calculateCost', () => {
  const wikiService = createObsidianWikiService();

  it('returns success with breakdown for known model', () => {
    const result = wikiService.calculateCost({
      provider: 'openai',
      model: 'gpt-4o',
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.totalCost).toBeGreaterThan(0);
    expect(result.data!.currency).toBe('USD');
  });

  it('returns success with zero cost for local ollama model', () => {
    const result = wikiService.calculateCost({
      provider: 'ollama',
      model: 'llama3.2',
      inputTokens: 10_000,
      outputTokens: 5_000,
    });
    expect(result.success).toBe(true);
    expect(result.data!.totalCost).toBe(0);
    expect(result.data!.isLocal).toBe(true);
  });

  it('returns success=false for unknown provider', () => {
    const result = wikiService.calculateCost({
      provider: 'anthropic',
      model: 'claude-3',
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.data).toBeUndefined();
  });

  it('calculates gpt-4.1-mini correctly through the interface', () => {
    // 100_000 input @ $0.4/M + 50_000 output @ $1.6/M
    // = 0.04 + 0.08 = 0.12 USD
    const result = wikiService.calculateCost({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      inputTokens: 100_000,
      outputTokens: 50_000,
    });
    expect(result.success).toBe(true);
    expect(result.data!.inputCost).toBeCloseTo(0.04, 8);
    expect(result.data!.outputCost).toBeCloseTo(0.08, 8);
    expect(result.data!.totalCost).toBeCloseTo(0.12, 8);
  });
});

describe('ObsidianWikiService.getPricingTable', () => {
  const wikiService = createObsidianWikiService();

  it('returns the full pricing table', () => {
    const table = wikiService.getPricingTable();
    expect(Array.isArray(table)).toBe(true);
    expect(table.length).toBeGreaterThan(0);
  });

  it('table contains entries for all expected providers', () => {
    const table = wikiService.getPricingTable();
    const providers = new Set(table.map(p => p.provider));
    expect(providers.has('openai')).toBe(true);
    expect(providers.has('deepseek')).toBe(true);
    expect(providers.has('ollama')).toBe(true);
  });
});
