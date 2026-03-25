/**
 * Rate limiter для контроля количества одновременных запросов к API
 */
export class RateLimiter {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(
    private maxConcurrent: number,
    private delayMs: number
  ) {}

  /**
   * Выполняет функцию с учетом лимита одновременных запросов
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Ждем, пока освободится слот
    while (this.running >= this.maxConcurrent) {
      await new Promise<void>(resolve => {
        this.queue.push(resolve);
      });
    }

    this.running++;
    try {
      const result = await fn();
      
      // Добавляем задержку между запросами
      if (this.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, this.delayMs));
      }
      
      return result;
    } finally {
      this.running--;
      
      // Освобождаем следующий запрос из очереди
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }

  /**
   * Возвращает количество запросов в процессе выполнения
   */
  getRunningCount(): number {
    return this.running;
  }

  /**
   * Возвращает количество запросов в очереди
   */
  getQueueLength(): number {
    return this.queue.length;
  }
}
