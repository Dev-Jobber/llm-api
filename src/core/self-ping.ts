import axios from "axios";

export class SelfPingScheduler {
  private interval: NodeJS.Timeout | null = null;
  private readonly healthUrl: string;
  private readonly intervalMs: number;

  constructor(healthUrl: string, intervalMinutes: number = 30) {
    this.healthUrl = healthUrl;
    this.intervalMs = intervalMinutes * 60 * 1000;
  }

  async ping(): Promise<void> {
    try {
      const response = await axios.get(this.healthUrl, {
        timeout: 10000,
        headers: {
          "User-Agent": "Self-Ping-Scheduler/1.0"
        }
      });
      
      console.log(`[self-ping] Successfully pinged ${this.healthUrl} - Status: ${response.status}`);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(`[self-ping] Failed to ping ${this.healthUrl}:`, {
          status: error.response?.status,
          statusText: error.response?.statusText,
          message: error.message
        });
      } else {
        console.error(`[self-ping] Unexpected error pinging ${this.healthUrl}:`, error);
      }
    }
  }

  start(): void {
    if (this.interval) {
      console.log("[self-ping] Scheduler already running");
      return;
    }

    console.log(`[self-ping] Starting scheduler - Pinging ${this.healthUrl} every ${this.intervalMs / 60000} minutes`);
    
    this.ping();
    
    this.interval = setInterval(() => {
      this.ping();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log("[self-ping] Scheduler stopped");
    }
  }

  isRunning(): boolean {
    return this.interval !== null;
  }
}
