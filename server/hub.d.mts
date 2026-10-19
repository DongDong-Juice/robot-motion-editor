import type { IncomingMessage, ServerResponse } from 'node:http'
export function hubHandler(dir: string): (req: IncomingMessage, res: ServerResponse, next?: () => void) => Promise<void>
