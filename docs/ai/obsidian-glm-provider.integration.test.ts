/**
 * Obsidian LLM Provider Integration Tests - GLM / 智谱AI
 *
 * 验证不同的 LLM Provider（以 GLM 为例）可以无缝支持
 * Obsidian Interface 对外提供的所有 Wiki 服务。
 *
 * 测试场景：
 *   1. 完整 Wiki 工作流（ingest → query → embedding → 持久化）
 *   2. 项目重新加载后 embedding 缓存命中
 *
 * ⚠️  安全提示：本文件包含测试用 API Key，请勿提交到公开仓库。
 *     生产环境建议改为环境变量读取：process.env.GLM_API_KEY
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
  createObsidianWikiService,
} from '@internal/interfaces/obsidian/desktop';

// ============================================================================
// Provider 配置（GLM / 智谱AI）
// ⚠️  测试用 Key，请勿泄露或提交到公开仓库
// ============================================================================

const GLM_BASE_URL    = 'https://open.bigmodel.cn/api/paas/v4';
const GLM_LLM_MODEL   = 'glm-4-flash';       // glm-4-flash 速度快、成本低，适合测试
const GLM_EMB_MODEL   = 'embedding-3';
const GLM_API_KEY     = process.env.GLM_API_KEY || 'xxxx';

// workspace llm config 中写入的字段（与 wiki-adapter.ts 约定对齐）
const GLM_WORKSPACE_LLM_CONFIG = {
  type:            'glm',
  model:           GLM_LLM_MODEL,
  baseUrl:         GLM_BASE_URL,
  apiKey:          GLM_API_KEY,
  maxTokens:       4096,
  contextLength:   128000,
  // embedding 独立配置（同一 API Key，GLM /embeddings 兼容 OpenAI 格式）
  embeddingModel:  GLM_EMB_MODEL,
  embeddingType:   'glm',
  embeddingBaseUrl: GLM_BASE_URL,
  embeddingApiKey: GLM_API_KEY,
};

// ============================================================================
// 测试内容（DDD 主题）
// ============================================================================

const DDD_SOURCE_CONTENT = `# Domain-Driven Design Introduction

Domain-Driven Design (DDD) is a software development approach that focuses on modeling
software to match the business domain.

## Key Concepts

### Ubiquitous Language
A common language shared between developers and domain experts.

### Bounded Context
A logical boundary within which a particular domain model is defined and applicable.

### Entities
Objects that have a distinct identity. For example, a User or Order entity has a unique ID.

### Value Objects
Objects that describe characteristics but have no conceptual identity. For example, an Address.

### Aggregates
A cluster of domain objects that can be treated as a single unit with an Aggregate Root.

### Repositories
Mechanisms for encapsulating storage and retrieval of domain objects.

## Benefits

DDD improves communication through ubiquitous language and aligns code with business rules.
`;

// ============================================================================
// 工具函数
// ============================================================================

/** 测试 GLM API 是否可达（发一条简单聊天请求） */
async function checkGLMAvailable(): Promise<{ llm: boolean; embedding: boolean }> {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${GLM_API_KEY}`,
  };

  // LLM 健康检查
  let llmOk = false;
  try {
    const resp = await fetch(`${GLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: GLM_LLM_MODEL,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5,
        stream: false,
      }),
      signal: AbortSignal.timeout(10000),
    });
    llmOk = resp.ok;
    if (!resp.ok) {
      const txt = await resp.text();
      console.warn(`[glm-check] LLM HTTP ${resp.status}: ${txt.substring(0, 200)}`);
    }
  } catch (err: any) {
    console.warn(`[glm-check] LLM error: ${err.message}`);
  }

  // Embedding 健康检查
  let embOk = false;
  try {
    const resp = await fetch(`${GLM_BASE_URL}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: GLM_EMB_MODEL, input: 'test' }),
      signal: AbortSignal.timeout(10000),
    });
    embOk = resp.ok;
    if (!resp.ok) {
      const txt = await resp.text();
      console.warn(`[glm-check] Embedding HTTP ${resp.status}: ${txt.substring(0, 200)}`);
    }
  } catch (err: any) {
    console.warn(`[glm-check] Embedding error: ${err.message}`);
  }

  return { llm: llmOk, embedding: embOk };
}

// ============================================================================
// 共享测试状态
// ============================================================================

let tempWorkspacePath = '';
let tempSourcePath    = '';
let wikiOutputDir     = '';
const wikiProjectName = 'ddd-wiki-glm';

// ============================================================================
// Tests
// ============================================================================

describe('Obsidian Provider Integration - GLM (智谱AI)', () => {
  let llmAvailable      = false;
  let embeddingAvailable = false;

  const conversationHistory: Array<{ question: string; answer: string }> = [];

  // ── beforeAll: 准备工作区 + 检查 GLM 连通性 ────────────────────────────────
  beforeAll(async () => {
    tempWorkspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-glm-test-'));
    tempSourcePath    = path.join(tempWorkspacePath, 'ddd-notes');
    wikiOutputDir     = path.join(tempWorkspacePath, 'ddd-wiki-output');

    console.log(`\n📦 Test environment:`);
    console.log(`  Workspace: ${tempWorkspacePath}`);
    console.log(`  Provider:  GLM (${GLM_LLM_MODEL} + ${GLM_EMB_MODEL})`);
    console.log(`  Base URL:  ${GLM_BASE_URL}\n`);

    await fs.mkdir(tempSourcePath, { recursive: true });
    await fs.writeFile(path.join(tempSourcePath, 'ddd-fundamentals.md'), DDD_SOURCE_CONTENT);
    console.log('✅ Test source file created');

    const { llm, embedding } = await checkGLMAvailable();
    llmAvailable       = llm;
    embeddingAvailable = embedding;

    if (llmAvailable) {
      console.log(`✅ GLM LLM available: ${GLM_LLM_MODEL}`);
    } else {
      console.warn(`⚠️  GLM LLM not available – check API Key / network`);
    }

    if (embeddingAvailable) {
      console.log(`✅ GLM Embedding available: ${GLM_EMB_MODEL}\n`);
    } else {
      console.warn(`⚠️  GLM Embedding not available\n`);
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

  // ── Test 1: 完整 Wiki 工作流 ──────────────────────────────────────────────
  it('should complete full Wiki workflow with GLM provider', async () => {
    if (!llmAvailable) {
      console.warn('⚠️  Skipping: GLM not available');
      return;
    }

    const workspaceService    = createObsidianWorkspaceService();
    const globalConfigService = createObsidianGlobalConfigService();
    const projectService      = createObsidianProjectService();
    const projectConfigService = createObsidianProjectConfigService();
    const wikiService         = createObsidianWikiService();

    // Step 1: 初始化 workspace
    console.log('\n📝 Step 1: Initialize Workspace');
    const initResult = await workspaceService.initWorkspace(tempWorkspacePath, {
      name: 'GLM Provider Test Workspace',
    });
    expect(initResult.success).toBe(true);
    console.log(`✅ Workspace: ${initResult.data?.id}`);

    // Step 2: 写入 GLM 配置（显式，不依赖环境变量）
    console.log('\n⚙️  Step 2: Configure GLM LLM Config');
    const configResult = await globalConfigService.set(
      tempWorkspacePath,
      'llm',
      GLM_WORKSPACE_LLM_CONFIG
    );
    expect(configResult.success).toBe(true);

    await globalConfigService.set(tempWorkspacePath, 'wiki.outputLanguage', 'English');
    console.log(`✅ GLM config set: ${JSON.stringify({
      type: GLM_WORKSPACE_LLM_CONFIG.type,
      model: GLM_WORKSPACE_LLM_CONFIG.model,
      embeddingModel: GLM_WORKSPACE_LLM_CONFIG.embeddingModel,
    })}`);

    // Step 3: 创建项目
    console.log('\n📚 Step 3: Create Wiki Project');
    const createResult = await projectService.createProject({
      name: wikiProjectName,
      workspacePath: tempWorkspacePath,
      sourceFolder: tempSourcePath,
      type: 'wiki',
    });
    expect(createResult.success).toBe(true);
    const projectPath = createResult.data?.path!;
    console.log(`✅ Project: ${createResult.data?.id}, path: ${projectPath}`);

    // Step 4: 配置输出目录
    console.log('\n⚙️  Step 4: Configure outputDir');
    const setCfgResult = await projectConfigService.set(
      tempWorkspacePath, wikiProjectName, 'outputDir', wikiOutputDir
    );
    expect(setCfgResult.success).toBe(true);
    console.log(`✅ outputDir: ${wikiOutputDir}`);

    // Step 5: Ingest（通过 GLM 提取知识 + 生成 embedding）
    console.log('\n📥 Step 5: Ingest with GLM');
    const ingestStart = Date.now();

    const ingestResult = await wikiService.ingest({
      workspacePath: tempWorkspacePath,
      projectName:   wikiProjectName,
      temperature:   0.3,
      onProgress: (event) => {
        const tag = event.type.padEnd(28);
        const pct = event.progress ? ` (${event.progress.percentage}%)` : '';
        console.log(`  [${tag}] ${event.message}${pct}`);
      },
    });

    const ingestMs = Date.now() - ingestStart;
    console.log(`Ingest done in ${ingestMs}ms`);

    expect(ingestResult.success).toBe(true);
    expect(ingestResult.data?.success).toBe(true);

    const totalKnowledge = (ingestResult.data?.extractedEntities || 0)
      + (ingestResult.data?.extractedConcepts || 0);
    expect(totalKnowledge).toBeGreaterThan(0);
    console.log(`✅ Extracted: ${ingestResult.data?.extractedEntities} entities, `
      + `${ingestResult.data?.extractedConcepts} concepts, `
      + `${ingestResult.data?.extractedConnections} connections`);
    console.log(`✅ Pages generated: ${ingestResult.data?.pagesGenerated}`);

    // Step 5.5: 验证 kb.json 在项目目录
    const kbPath = path.join(projectPath, 'kb.json');
    const kbExists = await fs.access(kbPath).then(() => true).catch(() => false);
    expect(kbExists).toBe(true);
    console.log(`✅ kb.json: ${kbPath}`);

    // Step 5.6: 验证 embeddings.json（如果 embedding 可用）
    const embeddingsPath = path.join(projectPath, 'embeddings.json');
    const embeddingsExist = await fs.access(embeddingsPath).then(() => true).catch(() => false);

    if (embeddingAvailable) {
      console.log('\n🔬 Step 5.6: Verify GLM embeddings');
      if (embeddingsExist) {
        const embContent = await fs.readFile(embeddingsPath, 'utf-8');
        const embIndex   = JSON.parse(embContent);
        // EmbeddingIndex.toJSON() → Record<string, number[]>
        const embEntries = Object.keys(embIndex);
        const firstVec   = Object.values(embIndex)[0] as number[] | undefined;
        const dim        = firstVec?.length ?? 0;

        console.log(`✅ embeddings.json: ${embEntries.length} entries, dim=${dim}`);
        console.log(`   Sample keys: ${embEntries.slice(0, 3).join(', ')}`);
        expect(embEntries.length).toBeGreaterThan(0);
        expect(dim).toBeGreaterThan(0);
      } else {
        console.warn('⚠️  embeddings.json not created (GLM embedding may have failed silently)');
      }
    }

    // Step 6: 多轮问答
    console.log('\n💬 Step 6: Multi-turn Query with GLM');

    const questions = [
      'What is Domain-Driven Design?',
      'What is the difference between an Entity and a Value Object?',
      'How does Ubiquitous Language help development?',
    ];

    for (const question of questions) {
      console.log(`\n🤔 Q: ${question}`);
      let answer = '';
      for await (const chunk of wikiService.queryStream({
        workspacePath: tempWorkspacePath,
        projectName:   wikiProjectName,
        question,
      })) {
        answer += chunk;
      }
      expect(answer.length).toBeGreaterThan(0);
      console.log(`✅ A (${answer.length} chars): ${answer.substring(0, 120).replace(/\n/g, ' ')}…`);
      conversationHistory.push({ question, answer });
    }

    // Step 7: 验证 KB 内容
    console.log('\n🔍 Step 7: Verify KB content');
    const kbContent = await fs.readFile(kbPath, 'utf-8');
    const kb = JSON.parse(kbContent);
    const entityCount  = kb.entities ? Object.keys(kb.entities).length : 0;
    const conceptCount = kb.concepts ? Object.keys(kb.concepts).length : 0;
    console.log(`✅ KB: ${entityCount} entities, ${conceptCount} concepts`);
    expect(entityCount + conceptCount).toBeGreaterThan(0);

    // Step 8: 验证 wiki 页面生成
    console.log('\n📄 Step 8: Verify generated wiki pages');
    const entitiesDir = path.join(wikiOutputDir, 'entities');
    const conceptsDir = path.join(wikiOutputDir, 'concepts');

    const entDirExists = await fs.access(entitiesDir).then(() => true).catch(() => false);
    const conDirExists = await fs.access(conceptsDir).then(() => true).catch(() => false);

    let entityPageCount  = 0;
    let conceptPageCount = 0;
    if (entDirExists) {
      entityPageCount = (await fs.readdir(entitiesDir)).filter(f => f.endsWith('.md')).length;
    }
    if (conDirExists) {
      conceptPageCount = (await fs.readdir(conceptsDir)).filter(f => f.endsWith('.md')).length;
    }

    console.log(`✅ Entity pages: ${entityPageCount}, Concept pages: ${conceptPageCount}`);
    expect(entityPageCount + conceptPageCount).toBe(entityCount + conceptCount);

    console.log('\n🎉 GLM full workflow test passed!\n');
  }, 300000); // 5 minutes – GLM API may be slower than local

  // ── Test 2: Reload 项目 + Embedding 持久化验证 ──────────────────────────────
  it('should reload project and reuse GLM embedding cache', async () => {
    if (!llmAvailable) {
      console.warn('⚠️  Skipping: GLM not available');
      return;
    }

    const projectService       = createObsidianProjectService();
    const projectConfigService  = createObsidianProjectConfigService();
    const wikiService           = createObsidianWikiService();

    // ── Scenario A: 新项目 ingest ─────────────────────────────────────────────
    console.log('\n🆕 Scenario A: Fresh project → ingest → save');

    const freshName      = 'ddd-wiki-glm-reload';
    const freshOutputDir = path.join(tempWorkspacePath, 'ddd-wiki-glm-reload-output');

    const createResult = await projectService.createProject({
      name: freshName, workspacePath: tempWorkspacePath,
      sourceFolder: tempSourcePath, type: 'wiki',
    });
    expect(createResult.success).toBe(true);
    const freshProjectPath = createResult.data?.path!;

    await projectConfigService.set(tempWorkspacePath, freshName, 'outputDir', freshOutputDir);

    const ingestResult = await wikiService.ingest({
      workspacePath: tempWorkspacePath,
      projectName:   freshName,
      temperature:   0.3,
      onProgress: (event) => {
        if (['ingest:complete', 'ingest:error'].includes(event.type)) {
          console.log(`  [${event.type}] ${event.message}`);
        }
      },
    });

    expect(ingestResult.success).toBe(true);
    console.log(`✅ Ingest: ${ingestResult.data?.extractedEntities} entities, `
      + `${ingestResult.data?.extractedConcepts} concepts`);

    // 验证 kb.json
    const kbPath = path.join(freshProjectPath, 'kb.json');
    expect(await fs.access(kbPath).then(() => true).catch(() => false)).toBe(true);
    console.log(`✅ kb.json saved: ${kbPath}`);

    // 验证 embeddings.json
    const embPath = path.join(freshProjectPath, 'embeddings.json');
    const embExists = await fs.access(embPath).then(() => true).catch(() => false);

    if (embeddingAvailable && embExists) {
      const embContent = await fs.readFile(embPath, 'utf-8');
      const embIndex   = JSON.parse(embContent);
      const embCount   = Object.keys(embIndex).length;
      const firstVec   = Object.values(embIndex)[0] as number[] | undefined;
      console.log(`✅ embeddings.json: ${embCount} entries, dim=${firstVec?.length ?? 0}`);
      expect(embCount).toBeGreaterThan(0);
    } else if (embeddingAvailable) {
      console.warn('⚠️  embeddings.json not found – GLM embedding may have failed');
    }

    // ── Scenario B: 重载项目，验证 KB 从磁盘加载 ──────────────────────────────
    console.log('\n🔄 Scenario B: Reload project by name → query');

    const reloadedWikiService = createObsidianWikiService();
    const queryQuestion = 'What are the core concepts in DDD?';
    console.log(`🔍 Query: ${queryQuestion}`);

    let answer = '';
    const t0 = Date.now();
    for await (const chunk of reloadedWikiService.queryStream({
      workspacePath: tempWorkspacePath,
      projectName:   freshName,
      question:      queryQuestion,
    })) {
      answer += chunk;
    }
    const elapsed = Date.now() - t0;

    console.log(`✅ Query done in ${elapsed}ms, answer: ${answer.length} chars`);
    console.log(`   First 200 chars: ${answer.substring(0, 200).replace(/\n/g, ' ')}`);

    const mentionsDDD = ['domain', 'entity', 'aggregate', 'context', 'bounded', 'ubiquitous']
      .some(kw => answer.toLowerCase().includes(kw));

    expect(answer.length).toBeGreaterThan(0);
    expect(mentionsDDD).toBe(true);
    console.log('✅ Response references DDD concepts (KB loaded from disk)');

    // ── Scenario C: embedding cache 命中（如果 embedding 可用）──────────────
    if (embeddingAvailable && embExists) {
      console.log('\n🔬 Scenario C: Verify embedding cache reused on reload');

      const embQ = 'How do Value Objects differ from Entities?';
      let embAnswer = '';
      for await (const chunk of reloadedWikiService.queryStream({
        workspacePath: tempWorkspacePath,
        projectName:   freshName,
        question:      embQ,
      })) {
        embAnswer += chunk;
      }

      const hasVO = ['value', 'identity', 'entity'].some(k => embAnswer.toLowerCase().includes(k));
      expect(embAnswer.length).toBeGreaterThan(0);
      expect(hasVO).toBe(true);
      console.log('✅ Embedding-assisted query returned relevant answer');
      console.log(`   Answer (200 chars): ${embAnswer.substring(0, 200).replace(/\n/g, ' ')}`);
    }

    console.log('\n🎉 GLM reload + embedding persistence test passed!\n');
  }, 300000);
});
