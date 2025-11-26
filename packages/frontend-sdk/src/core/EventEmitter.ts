/**
 * 轻量级事件系统
 * 框架无关的事件发射器，用于实现响应式更新
 */

type EventCallback = (...args: any[]) => void;

export class EventEmitter {
  private events: Map<string, Set<EventCallback>> = new Map();

  /**
   * 订阅事件
   * @param event 事件名称
   * @param callback 回调函数
   * @returns 取消订阅的函数
   */
  on(event: string, callback: EventCallback): () => void {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add(callback);

    // 返回取消订阅的函数
    return () => {
      this.off(event, callback);
    };
  }

  /**
   * 取消订阅事件
   * @param event 事件名称
   * @param callback 回调函数
   */
  off(event: string, callback: EventCallback): void {
    const callbacks = this.events.get(event);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.events.delete(event);
      }
    }
  }

  /**
   * 触发事件
   * @param event 事件名称
   * @param args 参数
   */
  emit(event: string, ...args: any[]): void {
    const callbacks = this.events.get(event);
    if (callbacks) {
      // 使用 Array.from 创建副本，避免在回调中修改 Set 导致的问题
      Array.from(callbacks).forEach((callback) => {
        try {
          callback(...args);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  /**
   * 一次性订阅
   * @param event 事件名称
   * @param callback 回调函数
   */
  once(event: string, callback: EventCallback): void {
    const onceCallback = (...args: any[]) => {
      callback(...args);
      this.off(event, onceCallback);
    };
    this.on(event, onceCallback);
  }

  /**
   * 移除所有事件监听器
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
  }

  /**
   * 获取事件监听器数量
   */
  listenerCount(event: string): number {
    return this.events.get(event)?.size || 0;
  }
}

