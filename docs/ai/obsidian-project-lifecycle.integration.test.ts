/**
 * Obsidian Project Lifecycle Integration Tests
 * 
 * Tests the complete lifecycle of projects in Obsidian interface
 * 
 * Test Flow:
 * 1. Initialize workspace
 * 2. Create empty project
 *    - Verify creation
 *    - Verify it appears in project list
 *    - Verify getProjectInfo returns correct data
 * 3. Create project from file
 *    - Verify creation
 *    - Verify both projects appear in list
 * 4. Create project from folder
 *    - Verify creation
 *    - Verify all three projects appear in list
 * 5. Delete projects one by one
 *    - Verify deletion
 *    - Verify project no longer appears in list
 *    - Verify getProjectInfo returns not found
 * 6. Verify workspace is empty
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  createObsidianWorkspaceService,
  createObsidianProjectService,
  createObsidianProjectConfigService,
  createObsidianWorkspaceAppService,
} from '@internal/interfaces/obsidian/desktop';

// Test configuration
const TEST_TIMEOUT = 60000; // 60 seconds
const TEST_DATA_DIR = path.join(__dirname, 'data');
const TEST_FILE = path.join(TEST_DATA_DIR, 'build.md');
const TEST_FOLDER = path.join(TEST_DATA_DIR, 'content');
const TEST_MULTI_FOLDER = path.join(TEST_DATA_DIR, 'multi');

describe('Obsidian Project Lifecycle Integration Tests', () => {
  let tempWorkspacePath: string;
  let workspaceService: ReturnType<typeof createObsidianWorkspaceService>;
  let projectService: ReturnType<typeof createObsidianProjectService>;

  beforeAll(async () => {
    // Create temporary workspace directory
    tempWorkspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-lifecycle-test-'));
    console.log(`Created temporary workspace: ${tempWorkspacePath}`);

    // Initialize services
    workspaceService = createObsidianWorkspaceService();
    projectService = createObsidianProjectService();

    // Initialize workspace
    const initResult = await workspaceService.initWorkspace(tempWorkspacePath, {
      name: 'Project Lifecycle Test Workspace',
    });
    
    if (!initResult.success) {
      throw new Error(`Failed to initialize workspace: ${initResult.error}`);
    }
    
    console.log('Workspace initialized successfully');

    // Verify test data exists
    const fileExists = await fs.stat(TEST_FILE).then(() => true).catch(() => false);
    const folderExists = await fs.stat(TEST_FOLDER).then(() => true).catch(() => false);
    const multiFolderExists = await fs.stat(TEST_MULTI_FOLDER).then(() => true).catch(() => false);
    
    if (!fileExists) {
      throw new Error(`Test file not found: ${TEST_FILE}`);
    }
    if (!folderExists) {
      throw new Error(`Test folder not found: ${TEST_FOLDER}`);
    }
    if (!multiFolderExists) {
      throw new Error(`Test multi-language folder not found: ${TEST_MULTI_FOLDER}`);
    }
    
    console.log('Test data verified');
  }, TEST_TIMEOUT);

  afterAll(async () => {
    // Clean up temporary workspace
    if (tempWorkspacePath) {
      try {
        await fs.rm(tempWorkspacePath, { recursive: true, force: true });
        console.log(`Cleaned up temporary workspace: ${tempWorkspacePath}`);
      } catch (error) {
        console.error(`Failed to clean up workspace: ${error}`);
      }
    }
  }, TEST_TIMEOUT);

  describe('Project Creation Phase', () => {
    test('1. Create empty project', async () => {
      const result = await projectService.createProject({
        name: 'empty-project',
        workspacePath: tempWorkspacePath,
        createSampleContent: true,
        type: 'site',
      });
      
      console.log('Create empty project result:', {
        success: result.success,
        message: result.message,
        projectName: result.data?.name,
        type: result.data?.type,
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      
      if (result.data) {
        expect(result.data.name).toBe('empty-project');
        expect(result.data.id).toBeDefined();
        expect(result.data.path).toBeDefined();
        expect(result.data.createdAt).toBeDefined();
        expect(result.data.updatedAt).toBeDefined();
        expect(result.data.type).toBe('site');
      }
    }, TEST_TIMEOUT);

    test('2. Verify empty project appears in list', async () => {
      const result = await projectService.listProjects(tempWorkspacePath);
      
      console.log('List projects after empty project:', {
        success: result.success,
        count: result.data?.length,
        names: result.data?.map(p => p.name),
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.length).toBe(1);
      
      const emptyProject = result.data?.find(p => p.name === 'empty-project');
      expect(emptyProject).toBeDefined();
    }, TEST_TIMEOUT);

    test('3. Get empty project info', async () => {
      const result = await projectService.getProjectInfo(
        tempWorkspacePath,
        'empty-project'
      );
      
      console.log('Get empty project info:', {
        success: result.success,
        name: result.data?.name,
        id: result.data?.id,
        type: result.data?.type,
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.name).toBe('empty-project');
      expect(result.data?.type).toBe('site');
    }, TEST_TIMEOUT);

    test('4. Create project from file', async () => {
      const result = await projectService.createProject({
        name: 'file-project',
        workspacePath: tempWorkspacePath,
        sourceFile: TEST_FILE,
        theme: 'https://gohugo.net/note.zip?version=1.2',
        language: 'en',
        type: 'site',
      });
      
      console.log('Create file project result:', {
        success: result.success,
        message: result.message,
        projectName: result.data?.name,
        hasFileLink: !!result.data?.fileLink,
        type: result.data?.type,
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      
      if (result.data) {
        expect(result.data.name).toBe('file-project');
        expect(result.data.fileLink).toBeDefined();
        expect(result.data.fileLink?.sourcePath).toBe(TEST_FILE);
        expect(result.data.type).toBe('site');
      }
    }, TEST_TIMEOUT);

    test('5. Verify both projects appear in list', async () => {
      const result = await projectService.listProjects(tempWorkspacePath);
      
      console.log('List projects after file project:', {
        success: result.success,
        count: result.data?.length,
        names: result.data?.map(p => p.name),
        types: result.data?.map(p => p.type),
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.length).toBe(2);
      
      const projectNames = result.data?.map(p => p.name) || [];
      expect(projectNames).toContain('empty-project');
      expect(projectNames).toContain('file-project');

      // Verify type is persisted for all projects
      result.data?.forEach(p => {
        expect(p.type).toBeDefined();
        expect(p.type).toBe('site');
      });
    }, TEST_TIMEOUT);

    test('6. Create project from folder', async () => {
      const result = await projectService.createProject({
        name: 'folder-project',
        workspacePath: tempWorkspacePath,
        sourceFolder: TEST_FOLDER,
        theme: 'https://gohugo.net/note.zip?version=1.2',
        language: 'en',
        type: 'wiki',
      });
      
      console.log('Create folder project result:', {
        success: result.success,
        message: result.message,
        projectName: result.data?.name,
        hasContentLinks: !!result.data?.contentLinks,
        contentLinksCount: result.data?.contentLinks?.length,
        type: result.data?.type,
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      
      if (result.data) {
        expect(result.data.name).toBe('folder-project');
        expect(result.data.contentLinks).toBeDefined();
        expect(result.data.contentLinks?.length).toBeGreaterThan(0);
        expect(result.data.type).toBe('wiki');
      }
    }, TEST_TIMEOUT);

    test('7. Verify all three projects appear in list', async () => {
      const result = await projectService.listProjects(tempWorkspacePath);
      
      console.log('List projects after folder project:', {
        success: result.success,
        count: result.data?.length,
        names: result.data?.map(p => p.name),
        types: result.data?.map(p => ({ name: p.name, type: p.type })),
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.length).toBe(3);
      
      const projectNames = result.data?.map(p => p.name) || [];
      expect(projectNames).toContain('empty-project');
      expect(projectNames).toContain('file-project');
      expect(projectNames).toContain('folder-project');

      // Verify types are persisted correctly
      const emptyP = result.data?.find(p => p.name === 'empty-project');
      const fileP = result.data?.find(p => p.name === 'file-project');
      const folderP = result.data?.find(p => p.name === 'folder-project');
      expect(emptyP?.type).toBe('site');
      expect(fileP?.type).toBe('site');
      expect(folderP?.type).toBe('wiki');
    }, TEST_TIMEOUT);
  });

  describe('Project Deletion Phase', () => {
    test('8. Delete empty project (keep files)', async () => {
      const result = await projectService.deleteProject(
        tempWorkspacePath,
        'empty-project',
        { deleteFiles: false }
      );
      
      console.log('Delete empty project result:', {
        success: result.success,
        message: result.message,
      });
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('Project deleted');
    }, TEST_TIMEOUT);

    test('9. Verify empty project no longer in list', async () => {
      const result = await projectService.listProjects(tempWorkspacePath);
      
      console.log('List projects after deleting empty project:', {
        success: result.success,
        count: result.data?.length,
        names: result.data?.map(p => p.name),
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.length).toBe(2);
      
      const projectNames = result.data?.map(p => p.name) || [];
      expect(projectNames).not.toContain('empty-project');
      expect(projectNames).toContain('file-project');
      expect(projectNames).toContain('folder-project');
    }, TEST_TIMEOUT);

    test('10. Verify getProjectInfo returns not found for deleted project', async () => {
      const result = await projectService.getProjectInfo(
        tempWorkspacePath,
        'empty-project'
      );
      
      console.log('Get deleted project info:', {
        success: result.success,
        error: result.error,
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('not found');
    }, TEST_TIMEOUT);

    test('11. Delete file project (remove files)', async () => {
      const result = await projectService.deleteProject(
        tempWorkspacePath,
        'file-project',
        { deleteFiles: true }
      );
      
      console.log('Delete file project result:', {
        success: result.success,
        message: result.message,
      });
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('Project deleted');
    }, TEST_TIMEOUT);

    test('12. Verify only folder project remains', async () => {
      const result = await projectService.listProjects(tempWorkspacePath);
      
      console.log('List projects after deleting file project:', {
        success: result.success,
        count: result.data?.length,
        names: result.data?.map(p => p.name),
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.length).toBe(1);
      
      const projectNames = result.data?.map(p => p.name) || [];
      expect(projectNames).toContain('folder-project');
      expect(projectNames).not.toContain('empty-project');
      expect(projectNames).not.toContain('file-project');
    }, TEST_TIMEOUT);

    test('13. Delete folder project (remove files)', async () => {
      const result = await projectService.deleteProject(
        tempWorkspacePath,
        'folder-project',
        { deleteFiles: true }
      );
      
      console.log('Delete folder project result:', {
        success: result.success,
        message: result.message,
      });
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('Project deleted');
    }, TEST_TIMEOUT);

    test('14. Verify workspace has no projects', async () => {
      const result = await projectService.listProjects(tempWorkspacePath);
      
      console.log('List projects after deleting all projects:', {
        success: result.success,
        count: result.data?.length,
        names: result.data?.map(p => p.name),
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.length).toBe(0);
    }, TEST_TIMEOUT);
  });

  describe('Error Handling', () => {
    test('15. Cannot delete non-existent project', async () => {
      const result = await projectService.deleteProject(
        tempWorkspacePath,
        'non-existent-project'
      );
      
      console.log('Delete non-existent project result:', {
        success: result.success,
        error: result.error,
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('not found');
    }, TEST_TIMEOUT);

    test('16. Cannot get info for non-existent project', async () => {
      const result = await projectService.getProjectInfo(
        tempWorkspacePath,
        'non-existent-project'
      );
      
      console.log('Get non-existent project info:', {
        success: result.success,
        error: result.error,
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('not found');
    }, TEST_TIMEOUT);
  });

  describe('Complete Lifecycle Validation', () => {
    test('17. Create and immediately delete project', async () => {
      // Create
      const createResult = await projectService.createProject({
        name: 'temp-project',
        workspacePath: tempWorkspacePath,
      });
      
      console.log('Create temp project:', {
        success: createResult.success,
        projectName: createResult.data?.name,
      });
      
      expect(createResult.success).toBe(true);
      
      // Verify exists
      const listResult1 = await projectService.listProjects(tempWorkspacePath);
      expect(listResult1.data?.length).toBe(1);
      expect(listResult1.data?.[0].name).toBe('temp-project');
      
      // Delete
      const deleteResult = await projectService.deleteProject(
        tempWorkspacePath,
        'temp-project'
      );
      
      console.log('Delete temp project:', {
        success: deleteResult.success,
        message: deleteResult.message,
      });
      
      expect(deleteResult.success).toBe(true);
      
      // Verify deleted
      const listResult2 = await projectService.listProjects(tempWorkspacePath);
      expect(listResult2.data?.length).toBe(0);
    }, TEST_TIMEOUT);

    test('18. Multiple projects lifecycle', async () => {
      // Create multiple projects
      const projects = ['project-a', 'project-b', 'project-c'];
      
      for (const name of projects) {
        const result = await projectService.createProject({
          name,
          workspacePath: tempWorkspacePath,
        });
        expect(result.success).toBe(true);
      }
      
      // Verify all exist
      const listResult1 = await projectService.listProjects(tempWorkspacePath);
      expect(listResult1.data?.length).toBe(3);
      
      console.log('Created multiple projects:', {
        count: listResult1.data?.length,
        names: listResult1.data?.map(p => p.name),
      });
      
      // Delete middle one
      const deleteResult = await projectService.deleteProject(
        tempWorkspacePath,
        'project-b'
      );
      expect(deleteResult.success).toBe(true);
      
      // Verify only 2 remain
      const listResult2 = await projectService.listProjects(tempWorkspacePath);
      expect(listResult2.data?.length).toBe(2);
      
      const remainingNames = listResult2.data?.map(p => p.name) || [];
      expect(remainingNames).toContain('project-a');
      expect(remainingNames).toContain('project-c');
      expect(remainingNames).not.toContain('project-b');
      
      console.log('After deleting project-b:', {
        count: listResult2.data?.length,
        names: remainingNames,
      });
      
      // Clean up remaining projects
      await projectService.deleteProject(tempWorkspacePath, 'project-a');
      await projectService.deleteProject(tempWorkspacePath, 'project-c');
      
      // Verify empty
      const listResult3 = await projectService.listProjects(tempWorkspacePath);
      expect(listResult3.data?.length).toBe(0);
      
      console.log('All projects cleaned up');
    }, TEST_TIMEOUT);
  });

  describe('Project Configuration Tests', () => {
    test('19. Create project with publish method configuration', async () => {
      const result = await projectService.createProject({
        name: 'config-test-project',
        workspacePath: tempWorkspacePath,
        createSampleContent: true,
      });
      
      console.log('Create project for config test:', {
        success: result.success,
        projectName: result.data?.name,
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, TEST_TIMEOUT);

    test('20. Set publish method configuration', async () => {
      const projectConfigService = createObsidianProjectConfigService();
      
      // Set publish method to 'mdf-share'
      const result = await projectConfigService.set(
        tempWorkspacePath,
        'config-test-project',
        'publish.method',
        'mdf-share'
      );
      
      console.log('Set publish method result:', {
        success: result.success,
      });
      
      expect(result.success).toBe(true);
    }, TEST_TIMEOUT);

    test('21. Verify publish method in project info', async () => {
      const result = await projectService.getProjectInfo(
        tempWorkspacePath,
        'config-test-project'
      );
      
      console.log('Get project info with publish method:', {
        success: result.success,
        name: result.data?.name,
        publishMethod: result.data?.publishMethod,
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.publishMethod).toBe('mdf-share');
    }, TEST_TIMEOUT);

    test('22. Verify publish method in project list', async () => {
      const result = await projectService.listProjects(tempWorkspacePath);
      
      console.log('List projects with publish method:', {
        success: result.success,
        count: result.data?.length,
        projects: result.data?.map(p => ({
          name: p.name,
          publishMethod: p.publishMethod,
        })),
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.length).toBe(1);
      
      const project = result.data?.find(p => p.name === 'config-test-project');
      expect(project).toBeDefined();
      expect(project?.publishMethod).toBe('mdf-share');
    }, TEST_TIMEOUT);

    test('23. Update publish method to netlify', async () => {
      const projectConfigService = createObsidianProjectConfigService();
      
      // Update publish method to 'netlify'
      const result = await projectConfigService.set(
        tempWorkspacePath,
        'config-test-project',
        'publish.method',
        'netlify'
      );
      
      expect(result.success).toBe(true);
      
      // Verify the update
      const infoResult = await projectService.getProjectInfo(
        tempWorkspacePath,
        'config-test-project'
      );
      
      console.log('Updated publish method:', {
        publishMethod: infoResult.data?.publishMethod,
      });
      
      expect(infoResult.data?.publishMethod).toBe('netlify');
    }, TEST_TIMEOUT);

    test('24. Clean up config test project', async () => {
      const result = await projectService.deleteProject(
        tempWorkspacePath,
        'config-test-project',
        { deleteFiles: true }
      );
      
      expect(result.success).toBe(true);
      
      // Verify deletion
      const listResult = await projectService.listProjects(tempWorkspacePath);
      expect(listResult.data?.length).toBe(0);
      
      console.log('Config test project cleaned up');
    }, TEST_TIMEOUT);
  });

  describe('Multi-language Project Tests', () => {
    test('25. Create multi-language project from folder', async () => {
      const result = await projectService.createProject({
        name: 'multi-lang-project',
        workspacePath: tempWorkspacePath,
        sourceFolder: TEST_MULTI_FOLDER,
        theme: 'https://gohugo.net/note.zip?version=1.2',
      });
      
      console.log('Create multi-language project result:', {
        success: result.success,
        message: result.message,
        projectName: result.data?.name,
        hasContentLinks: !!result.data?.contentLinks,
        contentLinksCount: result.data?.contentLinks?.length,
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      
      if (result.data) {
        expect(result.data.name).toBe('multi-lang-project');
        expect(result.data.contentLinks).toBeDefined();
        expect(result.data.contentLinks?.length).toBeGreaterThan(0);
        
        // Log all content links for debugging
        console.log('Content links:', result.data.contentLinks?.map(link => ({
          sourcePath: link.sourcePath,
          languageCode: link.languageCode,
          weight: link.weight,
        })));
      }
    }, TEST_TIMEOUT);

    test('26. Verify multi-language content links', async () => {
      const result = await projectService.getProjectInfo(
        tempWorkspacePath,
        'multi-lang-project'
      );
      
      console.log('Get multi-language project info:', {
        success: result.success,
        name: result.data?.name,
        contentLinksCount: result.data?.contentLinks?.length,
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.contentLinks).toBeDefined();
      
      if (result.data?.contentLinks) {
        const contentLinks = result.data.contentLinks;
        
        // Should have content links for multiple languages
        expect(contentLinks.length).toBeGreaterThan(0);
        
        // Check if languages are detected
        const languages = contentLinks.map(link => link.languageCode).filter(Boolean);
        console.log('Detected languages:', [...new Set(languages)]);
        
        // Should have at least one language detected (either 'en' or 'zh')
        expect(languages.length).toBeGreaterThan(0);
        
        // Verify that content links have source paths
        contentLinks.forEach(link => {
          expect(link.sourcePath).toBeDefined();
          expect(link.sourcePath).toContain(TEST_MULTI_FOLDER);
        });
        
        // Check for both language directories
        const hasEnglishContent = contentLinks.some(link => 
          link.sourcePath.includes('content') && !link.sourcePath.includes('content.zh')
        );
        const hasChineseContent = contentLinks.some(link => 
          link.sourcePath.includes('content.zh')
        );
        
        console.log('Has English content:', hasEnglishContent);
        console.log('Has Chinese content:', hasChineseContent);
        
        expect(hasEnglishContent || hasChineseContent).toBe(true);
      }
    }, TEST_TIMEOUT);

    test('27. Verify multi-language project in list', async () => {
      const result = await projectService.listProjects(tempWorkspacePath);
      
      console.log('List projects with multi-language project:', {
        success: result.success,
        count: result.data?.length,
        names: result.data?.map(p => p.name),
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.length).toBe(1);
      
      const multiLangProject = result.data?.find(p => p.name === 'multi-lang-project');
      expect(multiLangProject).toBeDefined();
    }, TEST_TIMEOUT);

    test('28. Clean up multi-language project', async () => {
      const result = await projectService.deleteProject(
        tempWorkspacePath,
        'multi-lang-project',
        { deleteFiles: true }
      );
      
      console.log('Delete multi-language project result:', {
        success: result.success,
        message: result.message,
      });
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('Project deleted');
      
      // Verify deletion
      const listResult = await projectService.listProjects(tempWorkspacePath);
      expect(listResult.data?.length).toBe(0);
      
      console.log('Multi-language project cleaned up');
    }, TEST_TIMEOUT);
  });

  describe('Project Type Persistence Tests', () => {
    test('29. Create site project and verify type is persisted', async () => {
      const result = await projectService.createProject({
        name: 'site-type-project',
        workspacePath: tempWorkspacePath,
        type: 'site',
        createSampleContent: false,
      });

      expect(result.success).toBe(true);
      expect(result.data?.type).toBe('site');

      // Reload from disk via getProjectInfo to confirm persistence
      const info = await projectService.getProjectInfo(tempWorkspacePath, 'site-type-project');
      expect(info.success).toBe(true);
      expect(info.data?.type).toBe('site');

      console.log('site-type-project type persisted:', info.data?.type);
    }, TEST_TIMEOUT);

    test('30. Create wiki project and verify type is persisted', async () => {
      const result = await projectService.createProject({
        name: 'wiki-type-project',
        workspacePath: tempWorkspacePath,
        type: 'wiki',
        createSampleContent: false,
      });

      expect(result.success).toBe(true);
      expect(result.data?.type).toBe('wiki');

      // Reload from disk via getProjectInfo to confirm persistence
      const info = await projectService.getProjectInfo(tempWorkspacePath, 'wiki-type-project');
      expect(info.success).toBe(true);
      expect(info.data?.type).toBe('wiki');

      console.log('wiki-type-project type persisted:', info.data?.type);
    }, TEST_TIMEOUT);

    test('31. Default type is "site" when not specified', async () => {
      const result = await projectService.createProject({
        name: 'default-type-project',
        workspacePath: tempWorkspacePath,
        createSampleContent: false,
      });

      expect(result.success).toBe(true);
      expect(result.data?.type).toBe('site');

      const info = await projectService.getProjectInfo(tempWorkspacePath, 'default-type-project');
      expect(info.success).toBe(true);
      expect(info.data?.type).toBe('site');

      console.log('default-type-project type:', info.data?.type);
    }, TEST_TIMEOUT);

    test('32. Type appears correctly in project list', async () => {
      const result = await projectService.listProjects(tempWorkspacePath);

      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(3);

      const siteProject = result.data?.find(p => p.name === 'site-type-project');
      const wikiProject = result.data?.find(p => p.name === 'wiki-type-project');
      const defaultProject = result.data?.find(p => p.name === 'default-type-project');

      expect(siteProject?.type).toBe('site');
      expect(wikiProject?.type).toBe('wiki');
      expect(defaultProject?.type).toBe('site');

      console.log('Project types in list:', result.data?.map(p => ({ name: p.name, type: p.type })));
    }, TEST_TIMEOUT);

    test('33. Create wiki project from file and verify type persists', async () => {
      const result = await projectService.createProject({
        name: 'wiki-file-project',
        workspacePath: tempWorkspacePath,
        sourceFile: TEST_FILE,
        type: 'wiki',
        language: 'en',
      });

      expect(result.success).toBe(true);
      expect(result.data?.type).toBe('wiki');

      const info = await projectService.getProjectInfo(tempWorkspacePath, 'wiki-file-project');
      expect(info.success).toBe(true);
      expect(info.data?.type).toBe('wiki');
      expect(info.data?.fileLink).toBeDefined();

      console.log('wiki-file-project type:', info.data?.type, 'fileLink:', !!info.data?.fileLink);
    }, TEST_TIMEOUT);

    test('34. Create wiki project from folder and verify type persists', async () => {
      const result = await projectService.createProject({
        name: 'wiki-folder-project',
        workspacePath: tempWorkspacePath,
        sourceFolder: TEST_FOLDER,
        type: 'wiki',
        language: 'en',
      });

      expect(result.success).toBe(true);
      expect(result.data?.type).toBe('wiki');

      const info = await projectService.getProjectInfo(tempWorkspacePath, 'wiki-folder-project');
      expect(info.success).toBe(true);
      expect(info.data?.type).toBe('wiki');
      expect(info.data?.contentLinks).toBeDefined();

      console.log('wiki-folder-project type:', info.data?.type, 'contentLinks:', info.data?.contentLinks?.length);
    }, TEST_TIMEOUT);

    test('35. Clean up type persistence test projects', async () => {
      const names = [
        'site-type-project',
        'wiki-type-project',
        'default-type-project',
        'wiki-file-project',
        'wiki-folder-project',
      ];

      for (const name of names) {
        const result = await projectService.deleteProject(tempWorkspacePath, name, { deleteFiles: true });
        expect(result.success).toBe(true);
      }

      const listResult = await projectService.listProjects(tempWorkspacePath);
      expect(listResult.data?.length).toBe(0);

      console.log('All type persistence test projects cleaned up');
    }, TEST_TIMEOUT);
  });

  describe('Project File I/O Tests', () => {
    const PROJECT_NAME = 'file-io-project';

    test('36. Create project for file I/O tests', async () => {
      const result = await projectService.createProject({
        name: PROJECT_NAME,
        workspacePath: tempWorkspacePath,
        type: 'wiki',
        createSampleContent: false,
      });

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe(PROJECT_NAME);
      console.log('Created file-io-project at:', result.data?.path);
    }, TEST_TIMEOUT);

    test('37. Write file to project root (kb.json)', async () => {
      const workspaceAppService = createObsidianWorkspaceAppService();
      const workspace = await workspaceAppService.loadWorkspace(tempWorkspacePath);
      const project = workspace.findProject(PROJECT_NAME)!;

      const content = JSON.stringify({ version: 1, entries: ['note-a', 'note-b'] }, null, 2);
      await project.writeFile('kb.json', content);

      // Verify via fileExists
      const exists = await project.fileExists('kb.json');
      expect(exists).toBe(true);

      // Verify the resolved path is under the project root
      const filePath = project.getFilePath('kb.json');
      expect(filePath).toContain(PROJECT_NAME);
      expect(filePath).toContain('kb.json');

      console.log('kb.json written to:', filePath);
    }, TEST_TIMEOUT);

    test('38. Read file from project root (kb.json)', async () => {
      const workspaceAppService = createObsidianWorkspaceAppService();
      const workspace = await workspaceAppService.loadWorkspace(tempWorkspacePath);
      const project = workspace.findProject(PROJECT_NAME)!;

      const raw = await project.readFile('kb.json');
      const data = JSON.parse(raw);

      expect(data.version).toBe(1);
      expect(data.entries).toEqual(['note-a', 'note-b']);

      console.log('kb.json read back:', data);
    }, TEST_TIMEOUT);

    test('39. Overwrite file with new content', async () => {
      const workspaceAppService = createObsidianWorkspaceAppService();
      const workspace = await workspaceAppService.loadWorkspace(tempWorkspacePath);
      const project = workspace.findProject(PROJECT_NAME)!;

      const updated = JSON.stringify({ version: 2, entries: ['note-a', 'note-b', 'note-c'] }, null, 2);
      await project.writeFile('kb.json', updated);

      const raw = await project.readFile('kb.json');
      const data = JSON.parse(raw);

      expect(data.version).toBe(2);
      expect(data.entries).toHaveLength(3);

      console.log('kb.json overwritten, new version:', data.version);
    }, TEST_TIMEOUT);

    test('40. Write file to subdirectory (data/index.json)', async () => {
      const workspaceAppService = createObsidianWorkspaceAppService();
      const workspace = await workspaceAppService.loadWorkspace(tempWorkspacePath);
      const project = workspace.findProject(PROJECT_NAME)!;

      const content = JSON.stringify({ name: 'index', createdAt: Date.now() }, null, 2);
      await project.writeFile('data/index.json', content);

      const exists = await project.fileExists('data/index.json');
      expect(exists).toBe(true);

      const raw = await project.readFile('data/index.json');
      const data = JSON.parse(raw);
      expect(data.name).toBe('index');

      const filePath = project.getFilePath('data/index.json');
      expect(filePath).toContain('data/index.json');

      console.log('data/index.json written to:', filePath);
    }, TEST_TIMEOUT);

    test('41. fileExists returns false for non-existent file', async () => {
      const workspaceAppService = createObsidianWorkspaceAppService();
      const workspace = await workspaceAppService.loadWorkspace(tempWorkspacePath);
      const project = workspace.findProject(PROJECT_NAME)!;

      const exists = await project.fileExists('does-not-exist.json');
      expect(exists).toBe(false);

      console.log('fileExists("does-not-exist.json"):', exists);
    }, TEST_TIMEOUT);

    test('42. readFile throws for non-existent file', async () => {
      const workspaceAppService = createObsidianWorkspaceAppService();
      const workspace = await workspaceAppService.loadWorkspace(tempWorkspacePath);
      const project = workspace.findProject(PROJECT_NAME)!;

      await expect(project.readFile('missing.json')).rejects.toThrow();
      console.log('readFile("missing.json") correctly throws');
    }, TEST_TIMEOUT);

    test('43. getFilePath returns correct absolute path', async () => {
      const workspaceAppService = createObsidianWorkspaceAppService();
      const workspace = await workspaceAppService.loadWorkspace(tempWorkspacePath);
      const project = workspace.findProject(PROJECT_NAME)!;

      const filePath = project.getFilePath('kb.json');
      expect(filePath).toBe(`${project.getPath()}/kb.json`);

      const subPath = project.getFilePath('data/index.json');
      expect(subPath).toBe(`${project.getPath()}/data/index.json`);

      console.log('getFilePath("kb.json"):', filePath);
    }, TEST_TIMEOUT);

    test('44. Clean up file I/O test project', async () => {
      const result = await projectService.deleteProject(
        tempWorkspacePath,
        PROJECT_NAME,
        { deleteFiles: true }
      );

      expect(result.success).toBe(true);

      const listResult = await projectService.listProjects(tempWorkspacePath);
      expect(listResult.data?.length).toBe(0);

      console.log('file-io-project cleaned up');
    }, TEST_TIMEOUT);
  });
});
