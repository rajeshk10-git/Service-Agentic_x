import { getPool } from "../db/pool";

export type ChatHistoryRole = "user" | "assistant";

export class ChatHistoryService {
  async append(args: {
    userId: string;
    sessionId: string;
    role: ChatHistoryRole;
    message: string;
  }): Promise<number> {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO chat_history (user_id, session_id, role, message)
       VALUES ($1, $2::uuid, $3, $4)
       RETURNING chat_id`,
      [args.userId, args.sessionId, args.role, args.message],
    );
    return Number(rows[0]?.chat_id);
  }
}

export const chatHistoryService = new ChatHistoryService();
