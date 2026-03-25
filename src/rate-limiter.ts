/**
 * Rate limiter to control concurrent API requests
 */
export class RateLimiter {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(
    private maxConcurrent: number,
    private delayMs: number
  ) {}

  /**
   * Executes function with concurrent request limit
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Wait until a slot is available
    while (this.running >= this.maxConcurrent) {
      await new Promise<void>(resolve => {
        this.queue.push(resolve);
      });
    }

    this.running++;
    try {
      const result = await fn();
      
      // Add delay between requests
      if (this.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, this.delayMs));
      }
      
      return result;
    } finally {
      this.running--;
      
      // Release next request from queue
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }

  /**
   * Returns number of requests in progress
   */
  getRunningCount(): number {
    return this.running;
  }

  /**
   * Returns number of requests in queue
   */
  getQueueLength(): number {
    return this.queue.length;
  }
}
