import { describe, expect, it, vi } from 'vitest';
import { runPocketBaseActionHandler } from './pocketbase-handler';

describe('runPocketBaseActionHandler', () => {
  it('handles collection operation and writes file when filePath exists', async () => {
    const runFileAction = vi.fn().mockResolvedValue(undefined);
    const onPocketBaseAlert = vi.fn();

    const result = await runPocketBaseActionHandler({
      action: {
        type: 'pocketbase',
        operation: 'collection',
        content: '{"name":"posts"}',
        filePath: '/home/project/pb-setup.js',
      } as any,
      logger: { debug: vi.fn() },
      onPocketBaseAlert,
      runFileAction,
    });

    expect(result).toEqual({ success: true });
    expect(onPocketBaseAlert).toHaveBeenCalledOnce();
    expect(runFileAction).toHaveBeenCalledOnce();
  });

  it('handles query operation as pending', async () => {
    const result = await runPocketBaseActionHandler({
      action: {
        type: 'pocketbase',
        operation: 'query',
        content: 'select * from users',
      } as any,
      logger: { debug: vi.fn() },
      onPocketBaseAlert: vi.fn(),
      runFileAction: vi.fn().mockResolvedValue(undefined),
    });

    expect(result).toEqual({ pending: true });
  });
});
