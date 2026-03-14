import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
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

    let lastNavigationTarget: string | null = null;
    let lastResizeTarget: { width: number; height: number; target?: string } | null = null;
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

    const initializeResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      }),
    });

    const initializePayload = (await initializeResponse.json()) as {
      result: {
        serverInfo: {
          name: string;
        };
      };
    };
    expect(initializeResponse.status).toBe(200);
    expect(initializePayload.result.serverInfo.name).toBe('agent-browser');

    const toolsResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
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
    expect(toolsPayload.result.tools.map((tool) => tool.name)).toContain('feedback.getState');
    expect(toolsPayload.result.tools.map((tool) => tool.name)).toContain('page.viewAsMarkdown');
    expect(toolsPayload.result.tools.map((tool) => tool.name)).toContain('page.screenshot');
    expect(toolsPayload.result.tools.map((tool) => tool.name)).toContain('artifacts.get');

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
    expect(
      feedbackStatePayload.result.structuredContent.feedback.annotations[0]?.replies[0]?.author,
    ).toBe('agent');

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

    const registrationStats = await stat(connection.registrationFile);
    expect(registrationStats.isFile()).toBe(true);

    const selfTestDiagnostics = await server.runSelfTest();
    expect(selfTestDiagnostics.lastSelfTest.status).toBe('passed');
    expect(selfTestDiagnostics.lastSelfTest.healthOk).toBe(true);
    expect(selfTestDiagnostics.lastSelfTest.initializeOk).toBe(true);
    expect(selfTestDiagnostics.lastSelfTest.toolsListOk).toBe(true);

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
        executeFeedbackCommand: async () => createEmptyFeedbackState(),
        getFeedbackState: () => createEmptyFeedbackState(),
        getMarkdownForCurrentPage: async () => createEmptyMarkdownViewState(),
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
});
