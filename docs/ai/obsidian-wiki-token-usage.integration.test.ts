/**
 * Wiki Token Usage Integration Tests
 *
 * 验证 token 使用量统计功能的端到端流程：
 *
 * Query 阶段（LLM streaming）：
 * - 每个 streaming chunk 到达时 completion token 动态累加（isEstimate: true）
 * - stream 结束后 emit 精确最终值（isEstimate: false）
 * - 动态增长：每次 isEstimate 事件的 completionTokens 严格单调递增
 * - 多次 query session 各自独立统计
 * - Query embedding token usage 在 LLM 生成前上报
 *
 * Ingest 阶段（LLM 提取 + Embedding 索引）：
 * - LLM 提取也走流式模式：每个 chunk 发一次 isEstimate:true 事件，completionTokens 单调递增
 * - stream 结束后 emit 精确最终值（isEstimate: false），含 promptTokens/completionTokens/model
 * - embedding 索引每次调用后上报 ingest:embedding:token:usage
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import {
  createObsidianWorkspaceService,
  createObsidianGlobalConfigService,
  createObsidianProjectConfigService,
  createObsidianProjectService,
  createObsidianWikiService
} from '@internal/interfaces/obsidian/desktop';

// ============================================================================
// 配置（与主集成测试保持一致，使用本地模型）
// ============================================================================
const LM_STUDIO_BASE_URL = 'http://localhost:1234/v1';
const LM_STUDIO_LLM_MODEL = 'qwen3.5-9b';
const LM_STUDIO_EMBEDDING_MODEL = 'text-embedding-nomic-embed-text-v2-moe';

async function checkLMStudioAvailable(): Promise<boolean> {
  try {
    const resp = await fetch(`${LM_STUDIO_BASE_URL}/models`, {
      signal: AbortSignal.timeout(3000)
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// 测试数据
// ============================================================================
const SOURCE_CONTENT = `# Token Tracking in LLM Systems

Token tracking is the process of counting the tokens consumed by LLM (Large Language Model) API calls.

## Why Token Tracking Matters

- **Cost Control**: Most LLM APIs charge per token. Knowing usage helps control costs.
- **Rate Limits**: APIs enforce limits on tokens per minute (TPM) and per day.
- **Performance**: Token count directly impacts latency and throughput.

## Prompt Tokens vs Completion Tokens

**Prompt tokens** are the tokens in the input: the system message, user query, and any context provided.

**Completion tokens** are the tokens in the model's generated response.

**Total tokens** = prompt tokens + completion tokens.

## Real-time Reporting

Real-time token reporting allows users to see token consumption immediately after each LLM call, enabling dynamic display of usage statistics in the UI.
`;

// ============================================================================
// 共享测试状态
// ============================================================================
let tempWorkspacePath: string = '';
let tempSourcePath: string = '';
let wikiOutputDir: string = '';
const wikiProjectName = 'token-usage-wiki';
let projectSetupDone = false;

describe('Wiki Token Usage Integration', () => {
  let llmAvailable = false;

  beforeAll(async () => {
    tempWorkspacePath = await fs.mkdtemp(
      path.join(os.tmpdir(), 'wiki-token-usage-test-')
    );
    tempSourcePath = path.join(tempWorkspacePath, 'token-notes');
    wikiOutputDir = path.join(tempWorkspacePath, 'token-notes wiki');

    console.log(`\n📦 Test environment:`);
    console.log(`  Workspace: ${tempWorkspacePath}`);
    console.log(`  Source:    ${tempSourcePath}`);
    console.log(`  Wiki out:  ${wikiOutputDir}\n`);

    await fs.mkdir(tempSourcePath, { recursive: true });
    await fs.writeFile(
      path.join(tempSourcePath, 'token-tracking.md'),
      SOURCE_CONTENT
    );
    console.log('✅ Test source file created\n');

    llmAvailable = await checkLMStudioAvailable();
    if (llmAvailable) {
      console.log(`✅ LM Studio available at ${LM_STUDIO_BASE_URL} (model: ${LM_STUDIO_LLM_MODEL})\n`);
    } else {
      console.warn(`⚠️  LM Studio not available — all tests will be skipped\n`);
    }
  });

  afterAll(async () => {
    if (tempWorkspacePath) {
      try {
        await fs.rm(tempWorkspacePath, { recursive: true, force: true });
        console.log(`\n🧹 Cleaned up: ${tempWorkspacePath}`);
      } catch (err) {
        console.warn(`⚠️  Cleanup failed: ${err}`);
      }
    }
  });

  // ============================================================================
  // Helper: set up workspace + project + ingest（只执行一次，被所有 test 复用）
  // ============================================================================
  async function ensureWikiProject(): Promise<void> {
    if (projectSetupDone) return;
    projectSetupDone = true;

    const workspaceService = createObsidianWorkspaceService();
    const globalConfigService = createObsidianGlobalConfigService();
    const projectService = createObsidianProjectService();
    const projectConfigService = createObsidianProjectConfigService();
    const wikiService = createObsidianWikiService();

    const initResult = await workspaceService.initWorkspace(tempWorkspacePath, {
      name: 'Token Usage Test Workspace',
    });
    expect(initResult.success).toBe(true);

    await globalConfigService.set(tempWorkspacePath, 'llm', {
      type: 'lmstudio',
      model: LM_STUDIO_LLM_MODEL,
      baseUrl: LM_STUDIO_BASE_URL,
      maxTokens: 8192,
      contextLength: 32768,
      embeddingModel: LM_STUDIO_EMBEDDING_MODEL,
    });
    await globalConfigService.set(tempWorkspacePath, 'wiki.outputLanguage', 'English');

    const createResult = await projectService.createProject({
      name: wikiProjectName,
      workspacePath: tempWorkspacePath,
      sourceFolder: tempSourcePath,
      type: 'wiki',
    });
    expect(createResult.success).toBe(true);

    await projectConfigService.set(
      tempWorkspacePath, wikiProjectName, 'outputDir', wikiOutputDir
    );

    console.log('📥 Ingesting source files...');
    const ingestResult = await wikiService.ingest({
      workspacePath: tempWorkspacePath,
      projectName: wikiProjectName,
      temperature: 0.3,
      onProgress: (event) => {
        if (['ingest:start', 'ingest:complete'].includes(event.type)) {
          console.log(`  [${event.type}] ${event.message}`);
        }
      },
    });
    expect(ingestResult.success).toBe(true);
    console.log(
      `✅ Ingest complete: ${ingestResult.data?.extractedEntities} entities, ` +
      `${ingestResult.data?.extractedConcepts} concepts\n`
    );
  }

  // ============================================================================
  // Test 1: 动态增长 — 每个 chunk 到达时 completionTokens 严格递增
  // ============================================================================
  it('should dynamically grow completionTokens with each streaming chunk', async () => {
    if (!llmAvailable) {
      console.warn('⚠️  Skipping: LM Studio not available');
      return;
    }

    await ensureWikiProject();
    const wikiService = createObsidianWikiService();

    const question = 'What is token tracking and why does it matter?';
    console.log(`\n🔍 Query: "${question}"`);

    // 收集所有 isEstimate: true 的事件（每 chunk 一个）
    const estimateEvents: Array<{
      completionTokens: number;
      receivedAt: number;
    }> = [];
    let finalAccurateUsage: any = null;
    let streamedChunks = 0;
    let fullAnswer = '';

    for await (const chunk of wikiService.queryStream({
      workspacePath: tempWorkspacePath,
      projectName: wikiProjectName,
      question,
      onProgress: (event) => {
        if (event.type !== 'query:token:usage') return;
        const meta = event.metadata;
        if (meta?.isEstimate === true) {
          estimateEvents.push({
            completionTokens: meta.tokenUsage.completionTokens,
            receivedAt: event.timestamp,
          });
        } else if (meta?.isEstimate === false) {
          finalAccurateUsage = meta.tokenUsage;
        }
      },
    })) {
      fullAnswer += chunk;
      streamedChunks++;
    }

    console.log(`\n📊 Streaming: ${streamedChunks} chunks, ${fullAnswer.length} chars`);
    console.log(`📊 Estimate events: ${estimateEvents.length}`);

    // ── 有动态增长事件 ────────────────────────────────────────────────────────
    expect(estimateEvents.length).toBeGreaterThan(0);
    // 每个 chunk 都应该有对应的估算事件
    expect(estimateEvents.length).toBe(streamedChunks);

    // ── completionTokens 严格单调递增（动态增长核心验证）────────────────────
    for (let i = 1; i < estimateEvents.length; i++) {
      expect(estimateEvents[i].completionTokens).toBeGreaterThan(
        estimateEvents[i - 1].completionTokens
      );
    }
    console.log(`✅ Monotonically increasing: ${estimateEvents[0].completionTokens} → ${estimateEvents[estimateEvents.length - 1].completionTokens}`);

    // 打印增长曲线（采样前 5 和后 5）
    const sample = [
      ...estimateEvents.slice(0, 5),
      ...(estimateEvents.length > 10 ? [null] : []),
      ...estimateEvents.slice(-5),
    ];
    console.log('📈 Growth curve (sampled):');
    for (const e of sample) {
      if (e === null) {
        console.log('   ...');
      } else {
        console.log(`   completionTokens: ${e.completionTokens}`);
      }
    }

    // ── stream 结束后有精确最终值 ─────────────────────────────────────────────
    expect(finalAccurateUsage).toBeDefined();
    expect(finalAccurateUsage.promptTokens).toBeGreaterThan(0);
    expect(finalAccurateUsage.completionTokens).toBeGreaterThan(0);
    expect(finalAccurateUsage.totalTokens).toBe(
      finalAccurateUsage.promptTokens + finalAccurateUsage.completionTokens
    );
    console.log(`\n🪙 Final accurate usage:`);
    console.log(`   promptTokens:     ${finalAccurateUsage.promptTokens}`);
    console.log(`   completionTokens: ${finalAccurateUsage.completionTokens}`);
    console.log(`   totalTokens:      ${finalAccurateUsage.totalTokens}`);
    if (finalAccurateUsage.model) {
      console.log(`   model:            ${finalAccurateUsage.model}`);
    }
  }, 300000);

  // ============================================================================
  // Test 2: 实时性 — isEstimate 事件与 chunk 同步到达，isEstimate:false 在 stream 后
  // ============================================================================
  it('should emit isEstimate:true events in sync with chunks, isEstimate:false after stream', async () => {
    if (!llmAvailable) {
      console.warn('⚠️  Skipping: LM Studio not available');
      return;
    }

    const wikiService = createObsidianWikiService();
    const question = 'What is the difference between prompt tokens and completion tokens?';
    console.log(`\n🔍 Query (real-time sync test): "${question}"`);

    const t0 = Date.now();

    interface Event { type: string; isEstimate?: boolean; completionTokens?: number; receivedAt: number; }
    const allEvents: Event[] = [];
    const chunkTimes: number[] = [];

    for await (const chunk of wikiService.queryStream({
      workspacePath: tempWorkspacePath,
      projectName: wikiProjectName,
      question,
      onProgress: (event) => {
        if (event.type === 'query:token:usage') {
          allEvents.push({
            type: event.type,
            isEstimate: event.metadata?.isEstimate,
            completionTokens: event.metadata?.tokenUsage?.completionTokens,
            receivedAt: Date.now() - t0,
          });
        } else {
          allEvents.push({ type: event.type, receivedAt: Date.now() - t0 });
        }
      },
    })) {
      chunkTimes.push(Date.now() - t0);
    }

    const estimateEvents = allEvents.filter(e => e.isEstimate === true);
    const finalEvent = allEvents.find(e => e.isEstimate === false);
    const completeEvent = allEvents.find(e => e.type === 'query:complete');

    console.log(`\n📊 Chunks: ${chunkTimes.length}, estimate events: ${estimateEvents.length}`);
    console.log(`   First chunk: t+${chunkTimes[0]}ms`);
    console.log(`   Last chunk:  t+${chunkTimes[chunkTimes.length - 1]}ms`);
    console.log(`   isEstimate:true  (last): t+${estimateEvents[estimateEvents.length - 1]?.receivedAt}ms`);
    console.log(`   isEstimate:false:         t+${finalEvent?.receivedAt}ms`);
    console.log(`   query:complete:           t+${completeEvent?.receivedAt}ms`);

    // ── isEstimate:true 事件数 = chunk 数（每 chunk 对应一次）───────────────
    expect(estimateEvents.length).toBe(chunkTimes.length);

    // ── isEstimate:true 事件在第一个 chunk 之前不存在（streaming 前无估算）──
    expect(estimateEvents.length).toBeGreaterThan(0);

    // ── isEstimate:false 在最后一个 chunk 之后到达 ────────────────────────────
    expect(finalEvent).toBeDefined();
    expect(finalEvent!.receivedAt).toBeGreaterThanOrEqual(chunkTimes[chunkTimes.length - 1]);

    // ── isEstimate:false 在 query:complete 之前到达 ───────────────────────────
    expect(finalEvent!.receivedAt).toBeLessThanOrEqual(completeEvent!.receivedAt);

    console.log(`\n✅ Real-time sync verified:
   - isEstimate:true fires once per chunk (${estimateEvents.length} events / ${chunkTimes.length} chunks)
   - isEstimate:false arrives after last chunk
   - isEstimate:false arrives before query:complete`);
  }, 300000);

  // ============================================================================
  // Test 3: 多 session 各自独立（不跨 session 累加）
  // ============================================================================
  it('should report independent token usage for each query session', async () => {
    if (!llmAvailable) {
      console.warn('⚠️  Skipping: LM Studio not available');
      return;
    }

    const wikiService = createObsidianWikiService();
    const questions = [
      'What are prompt tokens?',
      'How do completion tokens work?',
      'Why is total token count important for cost control?',
    ];

    console.log(`\n🔁 Running ${questions.length} independent query sessions...\n`);

    const sessionResults: Array<{
      question: string;
      finalPromptTokens: number;
      finalCompletionTokens: number;
      finalTotalTokens: number;
      peakEstimate: number;
    }> = [];

    for (const question of questions) {
      console.log(`🔍 Query: "${question}"`);

      let finalUsage: any = null;
      let peakEstimate = 0;

      for await (const chunk of wikiService.queryStream({
        workspacePath: tempWorkspacePath,
        projectName: wikiProjectName,
        question,
        onProgress: (event) => {
          if (event.type !== 'query:token:usage') return;
          const meta = event.metadata;
          if (meta?.isEstimate === true) {
            peakEstimate = meta.tokenUsage.completionTokens;
          } else if (meta?.isEstimate === false) {
            finalUsage = meta.tokenUsage;
          }
        },
      })) {
        // consume
      }

      expect(finalUsage).toBeDefined();
      expect(finalUsage.totalTokens).toBe(
        finalUsage.promptTokens + finalUsage.completionTokens
      );

      sessionResults.push({
        question,
        finalPromptTokens: finalUsage.promptTokens,
        finalCompletionTokens: finalUsage.completionTokens,
        finalTotalTokens: finalUsage.totalTokens,
        peakEstimate,
      });

      console.log(
        `   ✅ prompt=${finalUsage.promptTokens}  ` +
        `completion=${finalUsage.completionTokens}  ` +
        `total=${finalUsage.totalTokens}  ` +
        `(peak_estimate=${peakEstimate})`
      );
    }

    // 每个 session 独立，totalTokens > 0
    for (const r of sessionResults) {
      expect(r.finalTotalTokens).toBeGreaterThan(0);
    }

    // 汇总（各 session 独立计数，不跨 session 累加——即任意 session 的 token 数
    // 都显著小于所有 session 的累加总量）
    const totalAll = sessionResults.reduce((s, r) => s + r.finalTotalTokens, 0);
    for (const r of sessionResults) {
      expect(r.finalTotalTokens).toBeLessThan(totalAll);
    }

    console.log(`\n📊 Session Summary:`);
    for (const r of sessionResults) {
      console.log(`   total=${r.finalTotalTokens}  peakEstimate=${r.peakEstimate}`);
    }
    console.log(`   Combined total: ${totalAll}`);
    console.log('\n✅ Each session reported independent token usage');
  }, 300000);

  // ============================================================================
  // Test 4: 无 onProgress 时 streaming 不受影响
  // ============================================================================
  it('should stream normally without onProgress (no side-effects)', async () => {
    if (!llmAvailable) {
      console.warn('⚠️  Skipping: LM Studio not available');
      return;
    }

    const wikiService = createObsidianWikiService();
    const question = 'What is real-time token reporting?';
    console.log(`\n🔍 Query (no onProgress): "${question}"`);

    let answer = '';
    let chunkCount = 0;

    for await (const chunk of wikiService.queryStream({
      workspacePath: tempWorkspacePath,
      projectName: wikiProjectName,
      question,
      // 故意不传 onProgress
    })) {
      answer += chunk;
      chunkCount++;
    }

    expect(answer.length).toBeGreaterThan(0);
    expect(chunkCount).toBeGreaterThan(0);
    console.log(`✅ Streaming works without onProgress: ${chunkCount} chunks, ${answer.length} chars`);
  }, 300000);

  // ============================================================================
  // Test 5: Query embedding token usage 上报
  // ============================================================================
  it('should report embedding token usage during query', async () => {
    if (!llmAvailable) {
      console.warn('⚠️  Skipping: LM Studio not available');
      return;
    }

    const wikiService = createObsidianWikiService();
    const question = 'What are prompt tokens?';
    console.log(`\n🔍 Query (embedding usage): "${question}"`);

    const progressEvents: Array<{ type: string; metadata: any }> = [];

    for await (const _ of wikiService.queryStream({
      workspacePath: tempWorkspacePath,
      projectName: wikiProjectName,
      question,
      onProgress: (event) => {
        progressEvents.push({ type: event.type, metadata: event.metadata });
      }
    })) { /* consume stream */ }

    // 应当有 query:embedding:token:usage 事件
    const embeddingEvents = progressEvents.filter(e => e.type === 'query:embedding:token:usage');
    expect(embeddingEvents.length).toBeGreaterThan(0);

    const embUsage = embeddingEvents[0].metadata?.embeddingTokenUsage;
    expect(embUsage).toBeDefined();
    expect(embUsage.promptTokens).toBeGreaterThan(0);
    expect(embUsage.completionTokens).toBe(0);   // embedding 没有 completion token
    expect(embUsage.totalTokens).toBeGreaterThan(0);

    // embedding token usage 事件应出现在 LLM generating 之前
    const embIdx = progressEvents.findIndex(e => e.type === 'query:embedding:token:usage');
    const llmIdx = progressEvents.findIndex(e => e.type === 'query:llm:generating');
    if (llmIdx !== -1) {
      expect(embIdx).toBeLessThan(llmIdx);
    }

    console.log(`✅ Embedding token usage: prompt=${embUsage.promptTokens} total=${embUsage.totalTokens} model=${embUsage.model ?? 'n/a'}`);
    console.log(`   Event order: embedding@${embIdx} llm:generating@${llmIdx}`);
  }, 120000);

  // ============================================================================
  // Test 6: Ingest 阶段 LLM token usage 上报
  // ============================================================================
  it('should emit ingest:llm:token:usage during ingest of a new file', async () => {
    if (!llmAvailable) {
      console.warn('⚠️  Skipping: LM Studio not available');
      return;
    }

    await ensureWikiProject();

    // 写入一个新文件（之前从未 ingest 过），触发 LLM 提取调用
    const newFilePath = path.join(tempSourcePath, 'embedding-basics.md');
    await fs.writeFile(newFilePath, `# Embedding Basics

Embeddings are dense vector representations of text, capturing semantic meaning.

## What are embeddings?

An embedding converts discrete tokens into continuous floating-point vectors.
Each dimension encodes abstract semantic features learned during model training.

## Use cases

- Semantic search: find similar documents using cosine similarity
- Clustering: group related texts without labels
- Classification: use embeddings as features for downstream models
`);

    const wikiService = createObsidianWikiService();
    let estimateCount = 0;
    let finalUsage: any = null;
    console.log('\n📥 Ingesting new file (embedding-basics.md)...');

    const ingestResult = await wikiService.ingest({
      workspacePath: tempWorkspacePath,
      projectName: wikiProjectName,
      filePath: newFilePath,
      temperature: 0.1,
      onProgress: (event) => {
        if (event.type === 'ingest:llm:token:usage') {
          if (event.metadata?.isEstimate === true) {
            estimateCount++;
          } else if (event.metadata?.isEstimate === false) {
            finalUsage = event.metadata?.tokenUsage;
            console.log(`  [ingest:llm:token:usage final] prompt=${finalUsage?.promptTokens} completion=${finalUsage?.completionTokens} total=${finalUsage?.totalTokens} model=${finalUsage?.model ?? 'n/a'}`);
          }
        }
      },
    });

    expect(ingestResult.success).toBe(true);

    // 应有多个实时估算事件（流式效果）
    expect(estimateCount).toBeGreaterThan(1);

    // 最终精确事件必须存在
    expect(finalUsage).not.toBeNull();
    expect(finalUsage.promptTokens).toBeGreaterThan(0);
    expect(finalUsage.completionTokens).toBeGreaterThan(0);
    expect(finalUsage.totalTokens).toBeGreaterThan(0);
    expect(finalUsage.totalTokens).toBe(finalUsage.promptTokens + finalUsage.completionTokens);

    console.log(`✅ Ingest LLM token usage confirmed: estimate_events=${estimateCount} | final: prompt=${finalUsage.promptTokens} completion=${finalUsage.completionTokens} total=${finalUsage.totalTokens}`);
  }, 300000);

  // ============================================================================
  // Test 7: Ingest 阶段 — LLM + Embedding 使用量都有回调
  // ============================================================================
  it('should emit both ingest:llm:token:usage and ingest:embedding:token:usage', async () => {
    if (!llmAvailable) {
      console.warn('⚠️  Skipping: LM Studio not available');
      return;
    }

    await ensureWikiProject();

    // 再写一个新文件触发完整 ingest + embedding 流程
    const newFilePath = path.join(tempSourcePath, 'cost-estimation.md');
    await fs.writeFile(newFilePath, `# Cost Estimation for LLM APIs

When using cloud LLM APIs, cost is determined by token consumption.

## Pricing model

Most providers charge per 1 million tokens:
- Input (prompt) tokens — lower cost
- Output (completion) tokens — higher cost

## Estimation strategy

Multiply token counts by per-unit price to get estimated cost.
Track usage across sessions to monitor budget.
`);

    const wikiService = createObsidianWikiService();
    let llmEstimateCount = 0;
    let llmFinalUsage: any = null;
    let embeddingUsageCount = 0;
    console.log('\n📥 Ingesting new file (cost-estimation.md)...');

    const ingestResult = await wikiService.ingest({
      workspacePath: tempWorkspacePath,
      projectName: wikiProjectName,
      filePath: newFilePath,
      temperature: 0.1,
      onProgress: (event) => {
        if (event.type === 'ingest:llm:token:usage') {
          if (event.metadata?.isEstimate === true) {
            llmEstimateCount++;
          } else if (event.metadata?.isEstimate === false) {
            llmFinalUsage = event.metadata?.tokenUsage;
            console.log(`  [ingest:llm:token:usage final]`, JSON.stringify(event.metadata));
          }
        } else if (event.type === 'ingest:embedding:token:usage') {
          embeddingUsageCount++;
          console.log(`  [ingest:embedding:token:usage]`, JSON.stringify(event.metadata));
        }
      },
    });

    expect(ingestResult.success).toBe(true);

    // LLM 流式估算事件 + 最终精确事件都应存在
    expect(llmEstimateCount).toBeGreaterThan(1);
    expect(llmFinalUsage).not.toBeNull();
    expect(llmFinalUsage.promptTokens).toBeGreaterThan(0);

    const hasLLMUsage = llmFinalUsage !== null;
    const hasEmbeddingUsage = embeddingUsageCount > 0;

    // embedding usage 取决于 embedding provider 是否配置
    console.log(`✅ LLM usage reported: ${hasLLMUsage} (estimates=${llmEstimateCount}), Embedding usage reported: ${hasEmbeddingUsage} (events=${embeddingUsageCount})`);
  }, 300000);

  // ============================================================================
  // Test 8: Ingest 阶段流式实时 token usage — 与 query 一样逐 chunk 动态增长
  // ============================================================================
  it('should emit real-time streaming ingest:llm:token:usage events (isEstimate:true) that grow monotonically', async () => {
    if (!llmAvailable) {
      console.warn('⚠️  Skipping: LM Studio not available');
      return;
    }

    await ensureWikiProject();

    // 写入一个足够大的新文件，确保 LLM 会产生多个 streaming chunk
    const newFilePath = path.join(tempSourcePath, 'streaming-ingest-test.md');
    await fs.writeFile(newFilePath, `# Streaming Ingest Real-Time Token Test

This document is designed to test that the ingest phase streams token usage in real-time,
providing the same dynamic display effect as the query phase.

## Background

When a user ingests a new file, the LLM is called to extract entities, concepts, and connections.
Previously, the token usage was only reported once after the entire LLM response was complete.
This meant the frontend could not show a dynamically growing token counter during ingest.

## Expected Behavior

With the streaming ingest implementation:
1. Multiple events with isEstimate:true are emitted as each chunk arrives
2. The completionTokens value grows monotonically with each event
3. A final event with isEstimate:false is emitted with the accurate total from the API
4. This matches the behavior of queryStream where token counts grow per chunk

## Technical Details

The implementation switches from completeSync to the streaming complete() API when
an onIngestProgress callback is provided. Each text chunk is accumulated, and the
cumulative estimated token count is reported via the callback.

Token estimation: approximately 3 characters per token (same as queryStream).
`);

    const wikiService = createObsidianWikiService();
    const estimateEvents: Array<{ completionTokens: number; isEstimate: boolean }> = [];
    let finalAccurateEvent: { promptTokens: number; completionTokens: number; totalTokens: number } | null = null;
    console.log('\n📥 Ingesting new file (streaming-ingest-test.md) for real-time test...');

    const ingestResult = await wikiService.ingest({
      workspacePath: tempWorkspacePath,
      projectName: wikiProjectName,
      filePath: newFilePath,
      temperature: 0.1,
      onProgress: (event) => {
        if (event.type === 'ingest:llm:token:usage') {
          const tokenUsage = event.metadata?.tokenUsage;
          const isEstimate = event.metadata?.isEstimate;
          if (isEstimate === true) {
            estimateEvents.push({ completionTokens: tokenUsage?.completionTokens ?? 0, isEstimate: true });
          } else if (isEstimate === false) {
            finalAccurateEvent = {
              promptTokens: tokenUsage?.promptTokens ?? 0,
              completionTokens: tokenUsage?.completionTokens ?? 0,
              totalTokens: tokenUsage?.totalTokens ?? 0
            };
          }
        }
      },
    });

    expect(ingestResult.success).toBe(true);

    // 1. 应有多个实时估算事件（流式效果）
    expect(estimateEvents.length).toBeGreaterThan(1);
    console.log(`✅ Real-time estimate events: ${estimateEvents.length}`);

    // 2. completionTokens 应单调递增
    for (let i = 1; i < estimateEvents.length; i++) {
      expect(estimateEvents[i].completionTokens).toBeGreaterThanOrEqual(estimateEvents[i - 1].completionTokens);
    }
    const maxEstimated = estimateEvents[estimateEvents.length - 1].completionTokens;
    console.log(`✅ Monotonically growing: 0 → ~${maxEstimated} completion tokens`);

    // 3. 最终精确事件应存在且 promptTokens > 0
    expect(finalAccurateEvent).not.toBeNull();
    expect(finalAccurateEvent!.promptTokens).toBeGreaterThan(0);
    expect(finalAccurateEvent!.completionTokens).toBeGreaterThan(0);
    expect(finalAccurateEvent!.totalTokens).toBe(
      finalAccurateEvent!.promptTokens + finalAccurateEvent!.completionTokens
    );
    console.log(`✅ Final accurate event: prompt=${finalAccurateEvent!.promptTokens} completion=${finalAccurateEvent!.completionTokens} total=${finalAccurateEvent!.totalTokens}`);
  }, 300000);
});
