import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEmptyChromeAppearanceState,
  createEmptyFeedbackState,
  createEmptyMarkdownViewState,
  createEmptyNavigationState,
  createEmptyPickerState,
} from '@agent-browser/protocol';
import { ToolServer } from '../src/main/tool-server';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe('ToolServer', () => {
  it('requires auth and serves initialize plus tool calls', async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), 'agent-browser-tool-server-'));
    tempDirs.push(storageDir);

    let lastNavigationAction: string | null = null;
    let lastNavigationTarget: string | null = null;
    let lastResizeTarget: { width: number; height: number; target?: string } | null = null;
    let lastScrollRequest:
      | { selector?: string; block?: string; byX?: number; byY?: number }
      | null = null;
    let chromeAppearanceState = {
      ...createEmptyChromeAppearanceState(),
      projectRoot: '/tmp/project',
      configPath: '/tmp/project/.loop-browser.json',
    };
    let screenshotCounter = 0;
    const currentPickerState = {
      ...createEmptyPickerState(),
      lastSelection: {
        selector: '#cta',
        xpath: '//*[@id="cta"]',
        tag: 'button',
        id: 'cta',
        classList: ['primary'],
        role: 'button',
        accessibleName: 'Launch',
        playwrightLocator: "getByRole('button', { name: 'Launch' })",
        textSnippet: 'Launch',
        bbox: {
          x: 10,
          y: 12,
          width: 120,
          height: 32,
          devicePixelRatio: 2,
        },
        attributes: {
          role: 'button',
          'data-testid': 'cta',
        },
        outerHTMLExcerpt: '<button id="cta">Launch</button>',
        frame: {
          url: 'https://example.com',
          isMainFrame: true,
        },
      },
    };
    let feedbackState = createEmptyFeedbackState();
    const sessionSummary = {
      sessionId: 'project-session-1',
      projectRoot: '/tmp/project',
      projectName: 'project',
      chromeColor: '#FAFBFD',
      projectIconPath: '',
      isFocused: true,
      isHome: false,
      dockIconStatus: 'idle' as const,
      status: 'ready' as const,
    };

    const server = new ToolServer({
      runtime: {
        listTabs: () => [
          {
            tabId: 'tab-1',
            url: 'https://example.com',
            title: 'Example Domain',
            isLoading: false,
          },
        ],
        executeNavigationCommand: async (command) => {
          lastNavigationAction = command.action;
          lastNavigationTarget = command.action === 'navigate' ? command.target : null;
          return {
            ...createEmptyNavigationState(),
            url: command.action === 'navigate' ? command.target : '',
          };
        },
        executePickerCommand: async (command) => ({
          ...currentPickerState,
          enabled: command.action === 'enable',
        }),
        getPickerState: () => currentPickerState,
        executeChromeAppearanceCommand: async (command) => {
          switch (command.action) {
            case 'set':
              chromeAppearanceState = {
                ...chromeAppearanceState,
                chromeColor: command.chromeColor ?? chromeAppearanceState.chromeColor,
                accentColor: command.accentColor ?? chromeAppearanceState.accentColor,
                projectIconPath: command.projectIconPath ?? chromeAppearanceState.projectIconPath,
              };
              break;
            case 'reset':
              chromeAppearanceState = {
                ...chromeAppearanceState,
                chromeColor: createEmptyChromeAppearanceState().chromeColor,
                accentColor: createEmptyChromeAppearanceState().accentColor,
                projectIconPath: '',
                resolvedProjectIconPath: null,
              };
              break;
            default:
              break;
          }

          return chromeAppearanceState;
        },
        getChromeAppearanceState: () => chromeAppearanceState,
        executeFeedbackCommand: async (command) => {
          switch (command.action) {
            case 'startDraftFromSelection':
              feedbackState = {
                ...feedbackState,
                draft: {
                  ...feedbackState.draft,
                  selection: command.selection,
                  summary: 'button: Launch',
                  sourceUrl: 'https://example.com',
                  sourceTitle: 'Example Domain',
                },
              };
              break;
            case 'updateDraft':
              feedbackState = {
                ...feedbackState,
                draft: {
                  ...feedbackState.draft,
                  summary:
                    typeof command.summary === 'string'
                      ? command.summary
                      : feedbackState.draft.summary,
                  note:
                    typeof command.note === 'string'
                      ? command.note
                      : feedbackState.draft.note,
                  kind: command.kind ?? feedbackState.draft.kind,
                  priority: command.priority ?? feedbackState.draft.priority,
                },
              };
              break;
            case 'submitDraft':
              if (feedbackState.draft.selection) {
                feedbackState = {
                  ...feedbackState,
                  annotations: [
                    {
                      id: 'annotation-1',
                      selection: feedbackState.draft.selection,
                      summary: feedbackState.draft.summary,
                      note: feedbackState.draft.note,
                      kind: feedbackState.draft.kind,
                      priority: feedbackState.draft.priority,
                      intent: feedbackState.draft.intent,
                      styleTweaks: feedbackState.draft.styleTweaks,
                      status: 'open',
                      createdAt: '2026-03-14T00:00:00.000Z',
                      updatedAt: '2026-03-14T00:00:00.000Z',
                      url: 'https://example.com',
                      pageTitle: 'Example Domain',
                      replies: [],
                    },
                  ],
                  draft: createEmptyFeedbackState().draft,
                  activeAnnotationId: 'annotation-1',
                };
              }
              break;
            case 'reply':
              feedbackState = {
                ...feedbackState,
                annotations: feedbackState.annotations.map((annotation) =>
                  annotation.id === command.annotationId
                    ? {
                        ...annotation,
                        replies: [
                          ...annotation.replies,
                          {
                            id: 'reply-1',
                            author: command.author ?? 'agent',
                            body: command.body,
                            createdAt: '2026-03-14T00:00:01.000Z',
                          },
                        ],
                      }
                    : annotation,
                ),
              };
              break;
            case 'setStatus':
              feedbackState = {
                ...feedbackState,
                annotations: feedbackState.annotations.map((annotation) =>
                  annotation.id === command.annotationId
                    ? {
                        ...annotation,
                        status: command.status,
                      }
                    : annotation,
                ),
              };
              break;
            default:
              break;
          }

          return feedbackState;
        },
        getFeedbackState: () => feedbackState,
        getMarkdownForCurrentPage: async () => ({
          ...createEmptyMarkdownViewState(),
          status: 'ready',
          sourceUrl: 'https://example.com',
          title: 'Example Domain',
          markdown: '# Example Domain',
          site: 'example.com',
          wordCount: 2,
        }),
        executePageScroll: async (request) => {
          lastScrollRequest = request;
          return {
            scrollX: request.byX ?? 0,
            scrollY: request.byY ?? 480,
            maxScrollX: 1200,
            maxScrollY: 3600,
            url: 'https://example.com/tall',
          };
        },
        getWindowState: () => ({
          outerBounds: { x: 20, y: 20, width: 1480, height: 960 },
          contentBounds: { x: 20, y: 48, width: 1480, height: 932 },
          pageViewportBounds: { x: 0, y: 152, width: 1280, height: 720 },
          chromeHeight: 152,
          deviceScaleFactor: 2,
        }),
        resizeWindow: async (request) => {
          lastResizeTarget = request;
          return {
            outerBounds: { x: 20, y: 20, width: 1480, height: 960 },
            contentBounds: { x: 20, y: 48, width: 1480, height: 932 },
            pageViewportBounds: {
              x: 0,
              y: 152,
              width: request.width,
              height: request.height,
            },
            chromeHeight: 152,
            deviceScaleFactor: 2,
          };
        },
        captureScreenshot: async (request) => {
          screenshotCounter += 1;
          return {
            target: request.target,
            format: request.format ?? 'png',
            mimeType: request.format === 'jpeg' ? 'image/jpeg' : 'image/png',
            data: Buffer.from(`fixture-image-${request.target}-${screenshotCounter}`),
            pixelWidth: request.target === 'element' ? 320 : 1280,
            pixelHeight: request.target === 'element' ? 180 : 720,
            fileNameHint: request.fileNameHint ?? request.selector ?? request.target,
          };
        },
        listSessions: () => [sessionSummary],
        getCurrentSession: () => sessionSummary,
      },
      storageDir,
      port: 0,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    });

    const connection = await server.start();
    expect(server.getDiagnostics().lifecycle).toBe('listening');
    expect(server.getDiagnostics().tools).toContain('page.viewAsMarkdown');
    expect(server.getDiagnostics().tools).toContain('page.scroll');
    expect(server.getDiagnostics().tools).toContain('chrome.getAppearance');

    const unauthorized = await fetch(connection.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      }),
    });
    expect(unauthorized.status).toBe(401);

    const sseProbe = await fetch(connection.url, {
      method: 'GET',
    });
    expect(sseProbe.status).toBe(405);

    const initializeResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: {
            name: 'tool-server-test',
            version: '1.0.0',
          },
        },
      }),
    });

    const initializePayload = (await initializeResponse.json()) as {
      result: {
        protocolVersion: string;
        serverInfo: {
          name: string;
        };
        capabilities: {
          resources: Record<string, never>;
        };
      };
    };
    expect(initializeResponse.status).toBe(200);
    expect(initializePayload.result.serverInfo.name).toBe('agent-browser');
    expect(initializePayload.result.protocolVersion).toBe('2025-11-25');
    expect(initializePayload.result.capabilities.resources).toEqual({});
    const negotiatedProtocolVersion = initializePayload.result.protocolVersion;
    const mcpHeaders = {
      authorization: `Bearer ${connection.token}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': negotiatedProtocolVersion,
    };

    const toolsResponse = await fetch(connection.url, {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      }),
    });

    const toolsPayload = (await toolsResponse.json()) as {
      result: {
        tools: Array<{ name: string }>;
      };
    };
    expect(toolsPayload.result.tools.map((tool) => tool.name)).toContain('page.navigate');
    expect(toolsPayload.result.tools.map((tool) => tool.name)).toContain('page.reload');
    expect(toolsPayload.result.tools.map((tool) => tool.name)).toContain('feedback.getState');
    expect(toolsPayload.result.tools.map((tool) => tool.name)).toContain('feedback.progress');
    expect(toolsPayload.result.tools.map((tool) => tool.name)).toContain('page.viewAsMarkdown');
    expect(toolsPayload.result.tools.map((tool) => tool.name)).toContain('page.scroll');
    expect(toolsPayload.result.tools.map((tool) => tool.name)).toContain('page.screenshot');
    expect(toolsPayload.result.tools.map((tool) => tool.name)).toContain('artifacts.get');

    const resourcesListResponse = await fetch(connection.url, {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'resources-list',
        method: 'resources/list',
      }),
    });
    expect(resourcesListResponse.status).toBe(200);
    const resourcesListPayload = (await resourcesListResponse.json()) as {
      result: {
        resources: Array<{ uri: string }>;
      };
    };
    expect(resourcesListPayload.result.resources.map((resource) => resource.uri)).toContain(
      'loop-browser:///sessions',
    );
    expect(resourcesListPayload.result.resources.map((resource) => resource.uri)).toContain(
      `loop-browser:///session/${sessionSummary.sessionId}/summary`,
    );
    expect(resourcesListPayload.result.resources.map((resource) => resource.uri)).toContain(
      `loop-browser:///session/${sessionSummary.sessionId}/feedback`,
    );

    const resourceTemplatesResponse = await fetch(connection.url, {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'resource-templates-list',
        method: 'resources/templates/list',
      }),
    });
    expect(resourceTemplatesResponse.status).toBe(200);
    const resourceTemplatesPayload = (await resourceTemplatesResponse.json()) as {
      result: {
        resourceTemplates: Array<{ uriTemplate: string }>;
      };
    };
    expect(
      resourceTemplatesPayload.result.resourceTemplates.map(
        (resourceTemplate) => resourceTemplate.uriTemplate,
      ),
    ).toContain('loop-browser:///session/{sessionId}/summary');

    const sessionsResourceResponse = await fetch(connection.url, {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'sessions-resource',
        method: 'resources/read',
        params: {
          uri: 'loop-browser:///sessions',
        },
      }),
    });
    expect(sessionsResourceResponse.status).toBe(200);
    const sessionsResourcePayload = (await sessionsResourceResponse.json()) as {
      result: {
        contents: Array<{ text: string }>;
      };
    };
    expect(
      JSON.parse(sessionsResourcePayload.result.contents[0]?.text ?? '{}').sessions[0]?.sessionId,
    ).toBe(sessionSummary.sessionId);

    const summaryResourceResponse = await fetch(connection.url, {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'summary-resource',
        method: 'resources/read',
        params: {
          uri: `loop-browser:///session/${sessionSummary.sessionId}/summary`,
        },
      }),
    });
    expect(summaryResourceResponse.status).toBe(200);
    const summaryResourcePayload = (await summaryResourceResponse.json()) as {
      result: {
        contents: Array<{ text: string }>;
      };
    };
    expect(
      JSON.parse(summaryResourcePayload.result.contents[0]?.text ?? '{}').session?.sessionId,
    ).toBe(sessionSummary.sessionId);

    const tabsResourceResponse = await fetch(connection.url, {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'tabs-resource',
        method: 'resources/read',
        params: {
          uri: `loop-browser:///session/${sessionSummary.sessionId}/tabs`,
        },
      }),
    });
    expect(tabsResourceResponse.status).toBe(200);
    const tabsResourcePayload = (await tabsResourceResponse.json()) as {
      result: {
        contents: Array<{ text: string }>;
      };
    };
    expect(JSON.parse(tabsResourcePayload.result.contents[0]?.text ?? '{}').tabs[0]?.url).toBe(
      'https://example.com',
    );

    const markdownResourceResponse = await fetch(connection.url, {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'markdown-resource',
        method: 'resources/read',
        params: {
          uri: `loop-browser:///session/${sessionSummary.sessionId}/page/markdown`,
        },
      }),
    });
    expect(markdownResourceResponse.status).toBe(200);
    const markdownResourcePayload = (await markdownResourceResponse.json()) as {
      result: {
        contents: Array<{ text: string }>;
      };
    };
    expect(JSON.parse(markdownResourcePayload.result.contents[0]?.text ?? '{}').title).toBe(
      'Example Domain',
    );

    const missingResourceResponse = await fetch(connection.url, {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'missing-resource',
        method: 'resources/read',
        params: {
          uri: 'loop-browser:///session/missing/summary',
        },
      }),
    });
    expect(missingResourceResponse.status).toBe(404);
    const missingResourcePayload = (await missingResourceResponse.json()) as {
      error: {
        code: number;
      };
    };
    expect(missingResourcePayload.error.code).toBe(-32002);

    const feedbackCreateResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'feedback-create',
        method: 'tools/call',
        params: {
          name: 'feedback.create',
          arguments: {
            summary: 'Button copy is vague',
            note: 'This CTA should explain what happens next.',
            kind: 'change',
            priority: 'high',
          },
        },
      }),
    });

    const feedbackCreatePayload = (await feedbackCreateResponse.json()) as {
      result: {
        structuredContent: {
          annotation: {
            id: string;
            summary: string;
            priority: string;
          };
        };
      };
    };
    expect(feedbackCreateResponse.status).toBe(200);
    expect(feedbackCreatePayload.result.structuredContent.annotation.summary).toBe(
      'Button copy is vague',
    );
    expect(feedbackCreatePayload.result.structuredContent.annotation.priority).toBe('high');

    const feedbackReplyResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'feedback-reply',
        method: 'tools/call',
        params: {
          name: 'feedback.reply',
          arguments: {
            annotationId: 'annotation-1',
            body: 'I can tighten the CTA copy in the next pass.',
            author: 'agent',
          },
        },
      }),
    });
    expect(feedbackReplyResponse.status).toBe(200);

    const feedbackStatusResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'feedback-status',
        method: 'tools/call',
        params: {
          name: 'feedback.setStatus',
          arguments: {
            annotationId: 'annotation-1',
            status: 'in_progress',
          },
        },
      }),
    });
    expect(feedbackStatusResponse.status).toBe(200);

    feedbackState = {
      ...feedbackState,
      annotations: feedbackState.annotations.map((annotation) => ({
        ...annotation,
        intent: 'style',
        styleTweaks: [
          {
            property: 'color',
            value: '#ffffff',
            previousValue: 'rgb(0, 0, 0)',
          },
        ],
      })),
    };

    const feedbackStateResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'feedback-state',
        method: 'tools/call',
        params: {
          name: 'feedback.getState',
          arguments: {},
        },
      }),
    });

    const feedbackStatePayload = (await feedbackStateResponse.json()) as {
      result: {
        structuredContent: {
          feedback: {
            annotations: Array<{
              id: string;
              status: string;
              intent: string;
              styleTweaks: Array<{ property: string; value: string; previousValue: string }>;
              replies: Array<{ author: string }>;
            }>;
          };
        };
      };
    };
    expect(feedbackStateResponse.status).toBe(200);
    expect(feedbackStatePayload.result.structuredContent.feedback.annotations[0]?.status).toBe(
      'in_progress',
    );
    expect(feedbackStatePayload.result.structuredContent.feedback.annotations[0]?.intent).toBe(
      'style',
    );
    expect(
      feedbackStatePayload.result.structuredContent.feedback.annotations[0]?.styleTweaks[0],
    ).toEqual({
      property: 'color',
      value: '#ffffff',
      previousValue: 'rgb(0, 0, 0)',
    });
    expect(
      feedbackStatePayload.result.structuredContent.feedback.annotations[0]?.replies[0]?.author,
    ).toBe('agent');

    const feedbackResourceResponse = await fetch(connection.url, {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'feedback-resource',
        method: 'resources/read',
        params: {
          uri: `loop-browser:///session/${sessionSummary.sessionId}/feedback`,
        },
      }),
    });
    expect(feedbackResourceResponse.status).toBe(200);
    const feedbackResourcePayload = (await feedbackResourceResponse.json()) as {
      result: {
        contents: Array<{ text: string }>;
      };
    };
    expect(
      JSON.parse(feedbackResourcePayload.result.contents[0]?.text ?? '{}').feedback.annotations[0]
        ?.styleTweaks[0],
    ).toEqual({
      property: 'color',
      value: '#ffffff',
      previousValue: 'rgb(0, 0, 0)',
    });

    const feedbackProgressResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'feedback-progress',
        method: 'tools/call',
        params: {
          name: 'feedback.progress',
          arguments: {
            annotationId: 'annotation-1',
            phase: 'done',
          },
        },
      }),
    });

    const feedbackProgressPayload = (await feedbackProgressResponse.json()) as {
      result: {
        structuredContent: {
          annotation: {
            id: string;
            status: string;
            replies: Array<{ body: string }>;
          };
          agentActivity: {
            phase: string;
          };
        };
      };
    };
    expect(feedbackProgressResponse.status).toBe(200);
    expect(feedbackProgressPayload.result.structuredContent.annotation.status).toBe('resolved');
    expect(
      feedbackProgressPayload.result.structuredContent.annotation.replies.at(-1)?.body,
    ).toBe('Agent marked this complete.');
    expect(feedbackProgressPayload.result.structuredContent.agentActivity.phase).toBe('done');

    const chromeAppearanceResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'chrome-get',
        method: 'tools/call',
        params: {
          name: 'chrome.getAppearance',
          arguments: {},
        },
      }),
    });

    const chromeAppearancePayload = (await chromeAppearanceResponse.json()) as {
      result: {
        structuredContent: {
          appearance: {
            chromeColor: string;
          };
        };
      };
    };
    expect(chromeAppearanceResponse.status).toBe(200);
    expect(chromeAppearancePayload.result.structuredContent.appearance.chromeColor).toBe(
      '#FAFBFD',
    );

    const chromeSetResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'chrome-set',
        method: 'tools/call',
        params: {
          name: 'chrome.setAppearance',
          arguments: {
            accentColor: '#112233',
          },
        },
      }),
    });

    const chromeSetPayload = (await chromeSetResponse.json()) as {
      result: {
        structuredContent: {
          appearance: {
            accentColor: string;
          };
        };
      };
    };
    expect(chromeSetResponse.status).toBe(200);
    expect(chromeSetPayload.result.structuredContent.appearance.accentColor).toBe('#112233');

    const navigateResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'page.navigate',
          arguments: {
            target: 'https://nodesnodesnodes.com',
          },
        },
      }),
    });

    const navigatePayload = (await navigateResponse.json()) as {
      result: {
        structuredContent: {
          navigation: {
            url: string;
          };
        };
      };
    };
    expect(navigatePayload.result.structuredContent.navigation.url).toBe(
      'https://nodesnodesnodes.com',
    );
    expect(lastNavigationTarget).toBe('https://nodesnodesnodes.com');

    const reloadResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'page-reload',
        method: 'tools/call',
        params: {
          name: 'page.reload',
          arguments: {},
        },
      }),
    });
    expect(reloadResponse.status).toBe(200);
    expect(lastNavigationAction).toBe('reload');

    const markdownResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'page.viewAsMarkdown',
          arguments: {
            forceRefresh: true,
          },
        },
      }),
    });

    const markdownPayload = (await markdownResponse.json()) as {
      result: {
        structuredContent: {
          title: string;
          markdown: string;
        };
      };
    };
    expect(markdownPayload.result.structuredContent.title).toBe('Example Domain');
    expect(markdownPayload.result.structuredContent.markdown).toContain('# Example Domain');

    const windowStateResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'browser.getWindowState',
          arguments: {},
        },
      }),
    });

    const windowStatePayload = (await windowStateResponse.json()) as {
      result: {
        structuredContent: {
          window: {
            pageViewportBounds: {
              width: number;
              height: number;
            };
          };
        };
      };
    };
    expect(windowStateResponse.status).toBe(200);
    expect(windowStatePayload.result.structuredContent.window.pageViewportBounds.width).toBe(1280);

    const resizeResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'browser.resizeWindow',
          arguments: {
            width: 1024,
            height: 640,
            target: 'pageViewport',
          },
        },
      }),
    });

    const resizePayload = (await resizeResponse.json()) as {
      result: {
        structuredContent: {
          window: {
            pageViewportBounds: {
              width: number;
              height: number;
            };
          };
        };
      };
    };
    expect(resizeResponse.status).toBe(200);
    expect(lastResizeTarget).toEqual({ width: 1024, height: 640, target: 'pageViewport' });
    expect(resizePayload.result.structuredContent.window.pageViewportBounds).toMatchObject({
      width: 1024,
      height: 640,
    });

    const scrollResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'page-scroll',
        method: 'tools/call',
        params: {
          name: 'page.scroll',
          arguments: {
            selector: '.deadlines-grid',
            block: 'center',
          },
        },
      }),
    });

    const scrollPayload = (await scrollResponse.json()) as {
      result: {
        structuredContent: {
          scrollY: number;
          maxScrollY: number;
          url: string;
        };
      };
    };
    expect(scrollResponse.status).toBe(200);
    expect(lastScrollRequest).toEqual({
      selector: '.deadlines-grid',
      block: 'center',
    });
    expect(scrollPayload.result.structuredContent.scrollY).toBe(480);
    expect(scrollPayload.result.structuredContent.maxScrollY).toBe(3600);
    expect(scrollPayload.result.structuredContent.url).toBe('https://example.com/tall');

    const pageScreenshotResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'page.screenshot',
          arguments: {
            target: 'page',
            fullPage: true,
            fileNameHint: 'fixture-page',
          },
        },
      }),
    });

    const pageScreenshotPayload = (await pageScreenshotResponse.json()) as {
      result: {
        structuredContent: {
          artifactId: string;
          fileName: string;
          pixelWidth: number;
        };
      };
    };
    expect(pageScreenshotResponse.status).toBe(200);
    expect(pageScreenshotPayload.result.structuredContent.pixelWidth).toBe(1280);
    expect(pageScreenshotPayload.result.structuredContent.fileName).toContain('fixture-page');

    const elementScreenshotResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'page.screenshot',
          arguments: {
            target: 'element',
            selector: '.card',
            format: 'jpeg',
          },
        },
      }),
    });

    const elementScreenshotPayload = (await elementScreenshotResponse.json()) as {
      result: {
        structuredContent: {
          artifactId: string;
          mimeType: string;
          pixelWidth: number;
          pixelHeight: number;
        };
      };
    };
    expect(elementScreenshotResponse.status).toBe(200);
    expect(elementScreenshotPayload.result.structuredContent.mimeType).toBe('image/jpeg');
    expect(elementScreenshotPayload.result.structuredContent.pixelWidth).toBe(320);
    expect(elementScreenshotPayload.result.structuredContent.pixelHeight).toBe(180);

    const windowScreenshotResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'page.screenshot',
          arguments: {
            target: 'window',
          },
        },
      }),
    });

    const windowScreenshotPayload = (await windowScreenshotResponse.json()) as {
      result: {
        structuredContent: {
          artifactId: string;
        };
      };
    };
    expect(windowScreenshotResponse.status).toBe(200);

    const artifactGetResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'artifacts.get',
          arguments: {
            artifactId: pageScreenshotPayload.result.structuredContent.artifactId,
          },
        },
      }),
    });

    const artifactGetPayload = (await artifactGetResponse.json()) as {
      result: {
        structuredContent: {
          artifact: {
            artifactId: string;
            filePath: string;
          };
        };
      };
    };
    expect(artifactGetResponse.status).toBe(200);
    expect(artifactGetPayload.result.structuredContent.artifact.artifactId).toBe(
      pageScreenshotPayload.result.structuredContent.artifactId,
    );
    const artifactStats = await stat(
      artifactGetPayload.result.structuredContent.artifact.filePath,
    );
    expect(artifactStats.isFile()).toBe(true);

    const artifactListResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'artifacts.list',
          arguments: {},
        },
      }),
    });

    const artifactListPayload = (await artifactListResponse.json()) as {
      result: {
        structuredContent: {
          artifacts: Array<{ artifactId: string }>;
        };
      };
    };
    expect(artifactListResponse.status).toBe(200);
    expect(artifactListPayload.result.structuredContent.artifacts).toHaveLength(3);

    const artifactDeleteResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'artifacts.delete',
          arguments: {
            artifactId: windowScreenshotPayload.result.structuredContent.artifactId,
          },
        },
      }),
    });

    const artifactDeletePayload = (await artifactDeleteResponse.json()) as {
      result: {
        structuredContent: {
          artifact: {
            artifactId: string;
            deleted: boolean;
          };
        };
      };
    };
    expect(artifactDeleteResponse.status).toBe(200);
    expect(artifactDeletePayload.result.structuredContent.artifact.deleted).toBe(true);

    const diagnosticsAfterCalls = server.getDiagnostics();
    expect(diagnosticsAfterCalls.requestCount).toBeGreaterThanOrEqual(12);
    expect(diagnosticsAfterCalls.recentRequests[0]?.detail).toBe('artifacts.delete');
    expect(diagnosticsAfterCalls.activeToolCalls).toBe(0);
    expect(diagnosticsAfterCalls.agentActivity?.phase).toBe('done');

    const registrationStats = await stat(connection.registrationFile);
    expect(registrationStats.isFile()).toBe(true);

    const selfTestDiagnostics = await server.runSelfTest();
    expect(selfTestDiagnostics.lastSelfTest.status).toBe('passed');
    expect(selfTestDiagnostics.lastSelfTest.healthOk).toBe(true);
    expect(selfTestDiagnostics.lastSelfTest.initializeOk).toBe(true);
    expect(selfTestDiagnostics.lastSelfTest.toolsListOk).toBe(true);
    expect(selfTestDiagnostics.lastSelfTest.resourcesListOk).toBe(true);
    expect(selfTestDiagnostics.lastSelfTest.resourceTemplatesListOk).toBe(true);
    expect(selfTestDiagnostics.lastSelfTest.resourceReadOk).toBe(true);

    await server.stop();
  });

  it('records a failed self-test when the server is offline', async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), 'agent-browser-tool-server-'));
    tempDirs.push(storageDir);

    const server = new ToolServer({
      runtime: {
        listTabs: () => [],
        executeNavigationCommand: async () => createEmptyNavigationState(),
        executePickerCommand: async () => createEmptyPickerState(),
        getPickerState: () => createEmptyPickerState(),
        executeChromeAppearanceCommand: async () => createEmptyChromeAppearanceState(),
        getChromeAppearanceState: () => createEmptyChromeAppearanceState(),
        executeFeedbackCommand: async () => createEmptyFeedbackState(),
        getFeedbackState: () => createEmptyFeedbackState(),
        getMarkdownForCurrentPage: async () => createEmptyMarkdownViewState(),
        executePageScroll: async () => ({
          scrollX: 0,
          scrollY: 0,
          maxScrollX: 0,
          maxScrollY: 0,
          url: 'https://example.com',
        }),
        getWindowState: () => ({
          outerBounds: { x: 0, y: 0, width: 1200, height: 800 },
          contentBounds: { x: 0, y: 24, width: 1200, height: 776 },
          pageViewportBounds: { x: 0, y: 152, width: 1200, height: 624 },
          chromeHeight: 152,
          deviceScaleFactor: 2,
        }),
        resizeWindow: async () => ({
          outerBounds: { x: 0, y: 0, width: 1200, height: 800 },
          contentBounds: { x: 0, y: 24, width: 1200, height: 776 },
          pageViewportBounds: { x: 0, y: 152, width: 1200, height: 624 },
          chromeHeight: 152,
          deviceScaleFactor: 2,
        }),
        captureScreenshot: async () => ({
          target: 'page',
          format: 'png',
          mimeType: 'image/png',
          data: Buffer.from('fixture'),
          pixelWidth: 1200,
          pixelHeight: 624,
          fileNameHint: 'page',
        }),
      },
      storageDir,
      port: 0,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    });

    const diagnostics = await server.runSelfTest();
    expect(diagnostics.lastSelfTest.status).toBe('failed');
    expect(diagnostics.lastSelfTest.summary).toContain('not listening');
  });

  it('exposes session tools and requires sessionId for broker-routed session tools', async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), 'agent-browser-tool-server-'));
    tempDirs.push(storageDir);

    const sessionSummary = {
      sessionId: 'client-a-1234abcd',
      projectRoot: '/tmp/client-a',
      projectName: 'client-a',
      chromeColor: '#F297E7',
      projectIconPath: './icon.svg',
      isFocused: true,
      isHome: false,
      dockIconStatus: 'applied' as const,
      status: 'ready' as const,
    };
    const proxiedCalls: Array<{
      sessionId: string;
      toolName: string;
      args: Record<string, unknown>;
    }> = [];
    const proxiedResourceReads: Array<{
      sessionId: string;
      uri: string;
    }> = [];

    const server = new ToolServer({
      runtime: {
        listTabs: () => [],
        executeNavigationCommand: async () => createEmptyNavigationState(),
        executePickerCommand: async () => createEmptyPickerState(),
        getPickerState: () => createEmptyPickerState(),
        executeChromeAppearanceCommand: async () => createEmptyChromeAppearanceState(),
        getChromeAppearanceState: () => createEmptyChromeAppearanceState(),
        executeFeedbackCommand: async () => createEmptyFeedbackState(),
        getFeedbackState: () => createEmptyFeedbackState(),
        getMarkdownForCurrentPage: async () => createEmptyMarkdownViewState(),
        executePageScroll: async () => ({
          scrollX: 0,
          scrollY: 0,
          maxScrollX: 0,
          maxScrollY: 0,
          url: 'https://example.com',
        }),
        getWindowState: () => ({
          outerBounds: { x: 0, y: 0, width: 1200, height: 800 },
          contentBounds: { x: 0, y: 24, width: 1200, height: 776 },
          pageViewportBounds: { x: 0, y: 152, width: 1200, height: 624 },
          chromeHeight: 152,
          deviceScaleFactor: 2,
        }),
        resizeWindow: async () => ({
          outerBounds: { x: 0, y: 0, width: 1200, height: 800 },
          contentBounds: { x: 0, y: 24, width: 1200, height: 776 },
          pageViewportBounds: { x: 0, y: 152, width: 1200, height: 624 },
          chromeHeight: 152,
          deviceScaleFactor: 2,
        }),
        captureScreenshot: async () => ({
          target: 'page',
          format: 'png',
          mimeType: 'image/png',
          data: Buffer.from('fixture'),
          pixelWidth: 1200,
          pixelHeight: 624,
          fileNameHint: 'page',
        }),
        listSessions: () => [sessionSummary],
        getCurrentSession: () => sessionSummary,
        openSession: async () => [sessionSummary],
        focusSession: async () => sessionSummary,
        closeSession: async () => [],
        proxyToolCall: async (sessionId, toolName, args) => {
          proxiedCalls.push({ sessionId, toolName, args });
          return {
            content: [],
            structuredContent: {
              proxied: true,
              sessionId,
              toolName,
            },
          };
        },
        proxyResourceRead: async (sessionId, uri) => {
          proxiedResourceReads.push({ sessionId, uri });
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: `${JSON.stringify({ proxied: true, sessionId, uri }, null, 2)}\n`,
              },
            ],
          };
        },
      },
      storageDir,
      port: 0,
      requireSessionId: true,
      includeSessionTools: true,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    });

    const connection = await server.start();

    const toolsResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'tools-list',
        method: 'tools/list',
      }),
    });
    expect(toolsResponse.status).toBe(200);
    const toolsPayload = (await toolsResponse.json()) as {
      result: {
        tools: Array<{
          name: string;
          inputSchema?: {
            required?: string[];
          };
        }>;
      };
    };
    expect(toolsPayload.result.tools.map((tool) => tool.name)).toContain('session.list');
    expect(toolsPayload.result.tools.map((tool) => tool.name)).toContain('session.open');
    const navigateDefinition = toolsPayload.result.tools.find(
      (tool) => tool.name === 'page.navigate',
    );
    expect(navigateDefinition?.inputSchema?.required).toContain('sessionId');

    const missingSessionIdResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'missing-session',
        method: 'tools/call',
        params: {
          name: 'chrome.getAppearance',
          arguments: {},
        },
      }),
    });
    expect(missingSessionIdResponse.status).toBe(500);
    const missingSessionIdPayload = (await missingSessionIdResponse.json()) as {
      error: {
        message: string;
      };
    };
    expect(missingSessionIdPayload.error.message).toContain('requires sessionId');

    const sessionListResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'session-list',
        method: 'tools/call',
        params: {
          name: 'session.list',
          arguments: {},
        },
      }),
    });
    expect(sessionListResponse.status).toBe(200);
    const sessionListPayload = (await sessionListResponse.json()) as {
      result: {
        structuredContent: {
          sessions: Array<{ sessionId: string }>;
        };
      };
    };
    expect(sessionListPayload.result.structuredContent.sessions[0]?.sessionId).toBe(
      sessionSummary.sessionId,
    );

    const proxiedResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'proxied-call',
        method: 'tools/call',
        params: {
          name: 'page.navigate',
          arguments: {
            sessionId: sessionSummary.sessionId,
            target: 'https://example.com',
          },
        },
      }),
    });
    expect(proxiedResponse.status).toBe(200);
    expect(proxiedCalls).toEqual([
      {
        sessionId: sessionSummary.sessionId,
        toolName: 'page.navigate',
        args: {
          sessionId: sessionSummary.sessionId,
          target: 'https://example.com',
        },
      },
    ]);

    const proxiedResourceResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': '2025-11-25',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'proxied-resource-read',
        method: 'resources/read',
        params: {
          uri: `loop-browser:///session/${sessionSummary.sessionId}/summary`,
        },
      }),
    });
    expect(proxiedResourceResponse.status).toBe(200);
    expect(proxiedResourceReads).toEqual([
      {
        sessionId: sessionSummary.sessionId,
        uri: `loop-browser:///session/${sessionSummary.sessionId}/summary`,
      },
    ]);

    await server.stop();
  });

  it('tracks only external tool calls as active MCP work', async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), 'agent-browser-tool-server-'));
    tempDirs.push(storageDir);

    let releaseNavigation!: () => void;
    const navigationStarted = new Promise<void>((resolve) => {
      releaseNavigation = () => resolve();
    });
    let navigationStartedResolve!: () => void;
    const navigationEntered = new Promise<void>((resolve) => {
      navigationStartedResolve = () => resolve();
    });

    const server = new ToolServer({
      runtime: {
        listTabs: () => [],
        executeNavigationCommand: async (command) => {
          navigationStartedResolve();
          await navigationStarted;
          return {
            ...createEmptyNavigationState(),
            url: command.action === 'navigate' ? command.target : '',
          };
        },
        executePickerCommand: async () => createEmptyPickerState(),
        getPickerState: () => createEmptyPickerState(),
        executeChromeAppearanceCommand: async () => createEmptyChromeAppearanceState(),
        getChromeAppearanceState: () => createEmptyChromeAppearanceState(),
        executeFeedbackCommand: async () => createEmptyFeedbackState(),
        getFeedbackState: () => createEmptyFeedbackState(),
        getMarkdownForCurrentPage: async () => createEmptyMarkdownViewState(),
        executePageScroll: async () => ({
          scrollX: 0,
          scrollY: 0,
          maxScrollX: 0,
          maxScrollY: 0,
          url: 'https://example.com',
        }),
        getWindowState: () => ({
          outerBounds: { x: 0, y: 0, width: 1200, height: 800 },
          contentBounds: { x: 0, y: 24, width: 1200, height: 776 },
          pageViewportBounds: { x: 0, y: 152, width: 1200, height: 624 },
          chromeHeight: 152,
          deviceScaleFactor: 2,
        }),
        resizeWindow: async () => ({
          outerBounds: { x: 0, y: 0, width: 1200, height: 800 },
          contentBounds: { x: 0, y: 24, width: 1200, height: 776 },
          pageViewportBounds: { x: 0, y: 152, width: 1200, height: 624 },
          chromeHeight: 152,
          deviceScaleFactor: 2,
        }),
        captureScreenshot: async () => ({
          target: 'page',
          format: 'png',
          mimeType: 'image/png',
          data: Buffer.from('fixture'),
          pixelWidth: 1200,
          pixelHeight: 624,
          fileNameHint: 'page',
        }),
      },
      storageDir,
      port: 0,
      busyHoldMs: 10,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    });

    const connection = await server.start();

    const pendingNavigate = fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'busy-navigate',
        method: 'tools/call',
        params: {
          name: 'page.navigate',
          arguments: {
            target: 'https://slow.example.com',
          },
        },
      }),
    });

    await navigationEntered;
    expect(server.getDiagnostics().activeToolCalls).toBe(1);
    expect(server.getDiagnostics().busySince).not.toBeNull();

    releaseNavigation();
    const navigateResponse = await pendingNavigate;
    expect(navigateResponse.status).toBe(200);
    expect(server.getDiagnostics().activeToolCalls).toBe(0);
    expect(server.getDiagnostics().busySince).not.toBeNull();

    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
    expect(server.getDiagnostics().busySince).toBeNull();

    const toolsResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'tools-list',
        method: 'tools/list',
      }),
    });
    expect(toolsResponse.status).toBe(200);
    expect(server.getDiagnostics().activeToolCalls).toBe(0);
    expect(server.getDiagnostics().busySince).toBeNull();

    await server.stop();
  });
});
