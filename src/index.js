#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from './utils/logger.js';
import { launchKiaraProfile, navigateToFlow } from './browser/launch-profile.js';
import { getPage, getBrowser, setBrowser, closeBrowser as closeBrowserConnection, getContext } from './browser/connect.js';
import { verifyAccount as checkAccount } from './browser/account-check.js';
import { handleFlowOpen } from './tools/flow-open.js';
import { handleFlowStatus } from './tools/flow-status.js';
import { handleGenerateImage } from './tools/generate-image.js';
import { handleGenerateVideo } from './tools/generate-video.js';
import { handleDownloadLatest } from './tools/download-latest.js';
import { handleCreateCharacter } from './tools/create-character.js';
import { handleImportCharacter } from './tools/import-character.js';
import { handleOpenCharacters } from './tools/open-characters.js';
import { handleCreateScene } from './tools/create-scene.js';
import { handleOpenToolsGallery } from './tools/open-tools-gallery.js';
import { handleUseGridArchitect } from './tools/grid-architect.js';
import { handleDiscoverUi } from './tools/discover-ui.js';
import { handleUseFlowTool } from './tools/use-flow-tool.js';
import { handleWaitGeneration } from './tools/wait-generation.js';
import { handleCancelGeneration } from './tools/cancel-generation.js';
import { handleFlowCurrentState } from './tools/flow-current-state.js';
import { handleFlowIsLogged } from './tools/flow-is-logged.js';
import { saveSession, restoreSession, getSessionInfo } from './session/session-manager.js';
import { jobQueue } from './queue/job-queue.js';
import { takeScreenshot } from './utils/screenshots.js';
import fs from 'fs';
import path from 'path';

const TOOL_DEFINITIONS = [
  {
    name: 'flow_connect',
    description: 'Launch Chrome with the configured Google profile, connect CDP, navigate to Google Flow, and verify account.',
    inputSchema: {
      type: 'object',
      properties: {
        headless: { type: 'boolean', description: 'Launch in headless mode (not recommended, Google Flow needs visible browser).', default: false },
        open_flow: { type: 'boolean', description: 'Auto-navigate to Google Flow after connection.', default: true },
      },
    },
  },
  {
    name: 'flow_disconnect',
    description: 'Close the browser and clean up the MCP connection to Google Flow.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flow_status',
    description: 'Check current connection status: browser connected, Flow page loaded, account verified, job queue state.',
    inputSchema: {
      type: 'object',
      properties: {
        full: { type: 'boolean', description: 'Return full status with screenshot.', default: false },
      },
    },
  },
  {
    name: 'flow_account_check',
    description: 'Verify the logged-in Google account matches the configured expected email (Profile 3).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flow_discover_ui',
    description: 'Navigate to a Google Flow page and discover all interactive elements (buttons, inputs, links, headings). Updates the internal selectors map for robust automation.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'string', description: 'Page to discover. Options: main, image-generation, video-generation, characters, scenes, tools-gallery, grid-architect.', default: 'main' },
      },
      required: ['page'],
    },
  },
  {
    name: 'flow_generate_image',
    description: '⚠️ CES IMAGES CONSOMMENT DES CRÉDITS. Par défaut (auto_confirm=false): remplit le prompt, sélectionne le modèle/ratio, prend un screenshot et retourne "ready_for_confirmation". NE clique PAS sur Generate. Quand auto_confirm=true: vérifie d\'abord que l\'interface est bien en mode IMAGE (pas Vidéo), que le modèle est un modèle image, prend un screenshot de vérification, PUIS clique Generate, attend les images et les télécharge. NAN/BANANA modèles image seulement.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The text prompt for image generation.' },
        model: { type: 'string', description: 'Model to use: Nano Banana Pro, Nano Banana 2, or Imagen 4.', default: 'Nano Banana 2' },
        auto_confirm: { type: 'boolean', description: '⚠️ CRÉDITS. Si false (défaut): prépare seulement, ne consomme rien. Si true: vérifie que le mode Image est actif, PUIS clique Generate (consomme des crédits).', default: false },
        ratio: { type: 'string', description: 'Aspect ratio: 1:1, 16:9, 9:16, 4:3, 3:4.', default: '1:1' },
        reference_images: { type: 'array', items: { type: 'string' }, description: 'Paths to reference images (optional).' },
        brand: { type: 'string', description: 'Brand context for automatic model selection: premium, standard.' },
        project_name: { type: 'string', description: 'Name for the project (will reuse existing project with same campaign, or create new).' },
        campaign: { type: 'string', description: 'Campaign identifier for project matching (e.g., "ete-2026", "nouvelle-collection").' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'flow_generate_video',
    description: 'Set up a video generation in Google Flow. Fills prompt, selects Omni Flash or Veo model, configures settings. NOTE: Does NOT click final Generate (paid feature — stops at ready-to-generate).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The text prompt for video generation.' },
        model: { type: 'string', description: 'Model: Omni Flash, Veo 2, Nano Banana 2.', default: 'Omni Flash' },
        ratio: { type: 'string', description: 'Aspect ratio: 16:9, 9:16, 1:1.', default: '16:9' },
        duration: { type: 'number', description: 'Target duration in seconds.', default: 5 },
        reference_images: { type: 'array', items: { type: 'string' }, description: 'Paths to reference images (optional).' },
        project_name: { type: 'string', description: 'Name for the project (will reuse existing project with same campaign, or create new).' },
        campaign: { type: 'string', description: 'Campaign identifier for project matching (e.g., "ete-2026", "nouvelle-collection").' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'flow_download_latest',
    description: 'Download the most recently generated file from Google Flow.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flow_create_character',
    description: 'Create a new character in Google Flow Characters with name and description.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Character name.' },
        description: { type: 'string', description: 'Character description/prompt.' },
        reference_images: { type: 'array', items: { type: 'string' }, description: 'Paths to reference images for character design.' },
        project_name: { type: 'string', description: 'Name for the project (will reuse existing project with same campaign, or create new).' },
        campaign: { type: 'string', description: 'Campaign identifier for project matching (e.g., "ete-2026", "nouvelle-collection").' },
      },
      required: ['name', 'description'],
    },
  },
  {
    name: 'flow_import_character',
    description: 'Import a character from a saved JSON file into Google Flow.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to character JSON file.' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'flow_open_characters',
    description: 'Open the Google Flow Characters page and list existing characters.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flow_create_scene',
    description: 'Create a new scene in Google Flow Scenes with characters and prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Scene description/prompt.' },
        characters: { type: 'array', items: { type: 'string' }, description: 'Character names to include in the scene.' },
        project_name: { type: 'string', description: 'Name for the project (will reuse existing project with same campaign, or create new).' },
        campaign: { type: 'string', description: 'Campaign identifier for project matching (e.g., "ete-2026", "nouvelle-collection").' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'flow_open_tools_gallery',
    description: 'Open the Google Flow Tools Gallery and list available tools.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flow_use_grid_architect',
    description: 'Open Grid Architect in Google Flow, fill theme prompt, shot prompts, engine, ratio, and visual logic settings. Supports batch shot generation for brand campaigns.',
    inputSchema: {
      type: 'object',
      properties: {
        theme_prompt: { type: 'string', description: 'Overall theme prompt for the grid.' },
        shot_prompts: { type: 'array', items: { type: 'string' }, description: 'Array of individual shot prompts for the grid.' },
        engine: { type: 'string', description: 'Engine/model for the grid.', default: 'Nano Banana 2' },
        ratio: { type: 'string', description: 'Aspect ratio for all shots.', default: '16:9' },
        visual_logic: { type: 'string', description: 'Visual logic type: None, Colour Pop, Side by Side, etc.' },
        references: { type: 'array', items: { type: 'string' }, description: 'Paths to reference images.' },
        project_name: { type: 'string', description: 'Name for the project (will reuse existing project with same campaign, or create new).' },
        campaign: { type: 'string', description: 'Campaign identifier for project matching (e.g., "ete-2026", "nouvelle-collection").' },
      },
      required: ['theme_prompt'],
    },
  },
  {
    name: 'flow_use_tool',
    description: 'Open any tool by name in Google Flow and optionally fill its configuration parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: { type: 'string', description: 'Name of the tool to open (e.g. Grid Architect, Image Generation).' },
        params: { type: 'object', description: 'Optional configuration parameters for the tool.' },
        project_name: { type: 'string', description: 'Name for the project (will reuse existing project with same campaign, or create new).' },
        campaign: { type: 'string', description: 'Campaign identifier for project matching (e.g., "ete-2026", "nouvelle-collection").' },
      },
      required: ['tool_name'],
    },
  },
  {
    name: 'flow_screenshot',
    description: 'Take a screenshot of the current Google Flow page.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Custom name for the screenshot file.', default: 'manual' },
      },
    },
  },
  {
    name: 'flow_queue_status',
    description: 'Check the job queue: active job, pending queue, completed and failed job history.',
    inputSchema: {
      type: 'object',
      properties: {
        history_limit: { type: 'number', description: 'Number of recent history entries to return.', default: 5 },
      },
    },
  },
  // ── New architecture tools ────────────────────────────────────────────
  {
    name: 'flow_is_logged',
    description: 'Deterministic login check: verifies Google session is active without full DOM scan. Returns account email and session file age. Call before any generation to avoid wasted operations on expired sessions.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'flow_current_state',
    description: 'Returns current UI state in a single browser call: page type (home/project/editor), generation mode (image/video), active model, generation status (idle/queued/generating/ready/failed), progress %, project ID. Use before any action to avoid redundant navigation. Much cheaper than flow_status (no screenshot by default).',
    inputSchema: {
      type: 'object',
      properties: {
        include_screenshot: { type: 'boolean', description: 'Include a screenshot in the response.', default: false },
        include_cache_stats: { type: 'boolean', description: 'Include selector cache stats.', default: false },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'flow_wait_generation',
    description: '⏳ AUTONOMOUS POLLER: waits until the current generation is Ready or Failed without calling the LLM at any point. Blocks the MCP call until done (up to timeout_ms). Use immediately after flow_generate_image or flow_generate_video instead of manually polling flow_current_state in a loop.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_ms: { type: 'number', description: 'Max wait time in ms.', default: 300000 },
        poll_interval_ms: { type: 'number', description: 'Polling interval in ms.', default: 5000 },
        take_screenshot: { type: 'boolean', description: 'Take a screenshot when done.', default: true },
      },
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: 'flow_cancel_generation',
    description: 'Cancel the generation currently in progress. Tries multi-locale cancel/stop buttons, falls back to Escape key.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'flow_save_session',
    description: 'Save the current browser session (cookies + localStorage + sessionStorage) to disk. Call after a successful login to persist the session across MCP restarts.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  {
    name: 'flow_restore_session',
    description: 'Restore a previously saved browser session from disk and navigate to Google Flow. Avoids re-login if a valid session exists.',
    inputSchema: {
      type: 'object',
      properties: {
        navigate: { type: 'boolean', description: 'Navigate to Google Flow after restoring session.', default: true },
      },
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
];

async function handleToolCall(name, args) {
  logger.info('Tool called', { tool: name, args: args ? JSON.stringify(args).substring(0, 200) : 'none' });

  switch (name) {
    case 'flow_connect': {
      const result = await launchKiaraProfile(args?.headless || false);
      if (result.browser) setBrowser(result.browser);
      const page = getPage();
      let oauthRequired = false;
      if (args?.open_flow !== false) {
        const navResult = await navigateToFlow(page);
        if (navResult && navResult.authenticated === false) {
          oauthRequired = true;
        }
      }
      const url = page.url();
      let accountCheck = null;
      try {
        accountCheck = await checkAccount(page);
      } catch (e) {
        accountCheck = { verified: false, error: e.message };
      }
      if (oauthRequired) {
        return { content: [{ type: 'text', text: JSON.stringify({
          status: 'oauth_required',
          message: 'Google Flow requires OAuth authentication. Open Chrome Profile 3 manually once:\n'
            + '  1. Launch: google-chrome --profile-directory="Profile 3"\n'
            + '  2. Navigate to: https://labs.google/fx/tools/flow/tools/grid-architect\n'
            + '  3. Complete the Google sign-in (one time)\n'
            + '  4. Retry this MCP tool in headless mode',
          browserType: 'Chrome Profile 3',
          account: accountCheck?.account || 'verified-account',
          url: page.url().substring(0, 100),
          accountVerified: accountCheck,
        }, null, 2) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({
        status: 'connected',
        browserType: 'Chrome Profile 3',
        account: accountCheck?.account || 'verified-account',
        url: page.url(),
        accountVerified: accountCheck,
      }, null, 2) }] };
    }

    case 'flow_disconnect': {
      await closeBrowserConnection();
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'disconnected' }) }] };
    }

    case 'flow_status': {
      const status = await handleFlowStatus();
      return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
    }

    case 'flow_account_check': {
      const page = getPage();
      const result = await checkAccount(page);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'flow_discover_ui': {
      const result = await handleDiscoverUi(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'flow_generate_image': {
      const result = await handleGenerateImage(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'flow_generate_video': {
      const result = await handleGenerateVideo(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'flow_download_latest': {
      const result = await handleDownloadLatest(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'flow_create_character': {
      const result = await handleCreateCharacter(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'flow_import_character': {
      const result = await handleImportCharacter(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'flow_open_characters': {
      const result = await handleOpenCharacters(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'flow_create_scene': {
      const result = await handleCreateScene(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'flow_open_tools_gallery': {
      const result = await handleOpenToolsGallery(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'flow_use_grid_architect': {
      const result = await handleUseGridArchitect(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'flow_use_tool': {
      const result = await handleUseFlowTool(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'flow_screenshot': {
      const { getPage } = await import('./browser/connect.js');
      const page = getPage();
      const ss = await takeScreenshot(page, args?.name || 'manual');
      return { content: [{ type: 'text', text: JSON.stringify({ screenshot: ss, message: 'Screenshot saved.' }) }] };
    }

    case 'flow_queue_status': {
      return { content: [{ type: 'text', text: JSON.stringify(jobQueue.getStatus(args?.history_limit), null, 2) }] };
    }

    // ── New architecture tools ────────────────────────────────────────────
    case 'flow_is_logged': {
      const result = await handleFlowIsLogged(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'flow_current_state': {
      const result = await handleFlowCurrentState(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'flow_wait_generation': {
      const result = await handleWaitGeneration(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'flow_cancel_generation': {
      const result = await handleCancelGeneration(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'flow_save_session': {
      const page = getPage();
      const context = getContext();
      const result = await saveSession(context, page);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'flow_restore_session': {
      const page = getPage();
      const context = getContext();
      const restoreResult = await restoreSession(context, page);
      let navResult = null;
      if (restoreResult.restored && args?.navigate !== false) {
        navResult = await navigateToFlow(page);
      }
      return { content: [{ type: 'text', text: JSON.stringify({ ...restoreResult, navigation: navResult }, null, 2) }] };
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: 'google-flow-browser-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    return await handleToolCall(request.params.name, request.params.arguments);
  } catch (error) {
    logger.error('Tool execution error', { tool: request.params.name, error: error.message });
    if (error instanceof McpError) throw error;
    const message = error.message || 'Unknown error';
    const isBlocking = message.includes('MUST') || message.includes('cannot') || message.includes('blocked');
    return {
      content: [{ type: 'text', text: JSON.stringify({
        error: true,
        message,
        code: isBlocking ? 'BLOCKING' : 'ERROR',
        needsManualIntervention: isBlocking,
      }, null, 2) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
logger.info('Google Flow Browser MCP server running on stdio');
