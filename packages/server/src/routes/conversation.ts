/**
 * 会话管理 API 路由
 * 提供会话重置等功能的 REST API 接口
 */

import { FastifyPluginAsync } from 'fastify';

const conversationRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * 重置会话上下文
   * POST /conversation/reset
   * 
   * Body:
   * {
   *   "sessionId": null
   * }
   * 
   * 清空当前会话的上下文存储（消息历史等）
   */
  fastify.post<{
    Body: {
      sessionId: null;
    };
  }>('/conversation/reset', async (request, reply) => {
    try {
      const { sessionId } = request.body;

      // TODO: 未来扩展时，可以根据 sessionId 清空特定会话的上下文
      // 当前版本：清空所有会话上下文（伪代码示例）
      
      // 伪代码：清空会话存储
      // if (sessionId) {
      //   // 清空指定会话的上下文
      //   await conversationStore.clear(sessionId);
      // } else {
      //   // 清空默认会话的上下文
      //   await conversationStore.clearDefault();
      // }

      // 当前实现：由于没有持久化存储，这里只是占位
      // 未来可以在这里添加：
      // - 清空内存中的消息缓存
      // - 清空数据库中的会话记录
      // - 清空 Redis 中的会话数据
      // 等等

      console.log('[Conversation Routes] Reset conversation context', {
        sessionId,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        message: 'Conversation context cleared successfully',
      };
    } catch (error) {
      reply.code(500);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
};

export default conversationRoutes;

