import pino from 'pino';

export function createLogger(level: pino.LevelWithSilent) {
  const isDev = process.env['NODE_ENV'] !== 'production';
  return pino({
    level,
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
          },
        }
      : {}),
  });
}

export type Logger = pino.Logger;
