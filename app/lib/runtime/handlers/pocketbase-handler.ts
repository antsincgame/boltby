import type { PocketBaseAction } from '~/types/actions';

interface PocketBaseAlertLike {
  (alert: { type: 'info'; title: string; description: string; content: string; source: 'pocketbase' }): void;
}

interface LoggerLike {
  debug: (...messages: any[]) => void;
}

interface RunFileActionLike {
  (action: { type: 'file'; filePath: string; content: string }): Promise<void>;
}

export async function runPocketBaseActionHandler(params: {
  action: PocketBaseAction;
  logger: LoggerLike;
  onPocketBaseAlert?: PocketBaseAlertLike;
  runFileAction: RunFileActionLike;
}): Promise<{ success: true } | { pending: true }> {
  const { action, logger, onPocketBaseAlert, runFileAction } = params;
  const { operation, content, filePath } = action;
  logger.debug('[PocketBase Action]:', { operation, filePath, content });

  switch (operation) {
    case 'collection':
      onPocketBaseAlert?.({
        type: 'info',
        title: 'PocketBase Collection',
        description: 'Create or update collection',
        content,
        source: 'pocketbase',
      });

      if (filePath) {
        await runFileAction({
          type: 'file',
          filePath,
          content,
        });
      }

      return { success: true };

    case 'query':
      onPocketBaseAlert?.({
        type: 'info',
        title: 'PocketBase Query',
        description: 'Execute database query',
        content,
        source: 'pocketbase',
      });
      return { pending: true };

    default:
      throw new Error(`Unknown PocketBase operation: ${operation}`);
  }
}
