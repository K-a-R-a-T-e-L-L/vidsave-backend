import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";

const READINESS_TIMEOUT_MS = 1_500;

@Injectable()
export class HealthService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async isDatabaseReady(): Promise<boolean> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.dataSource.query("SELECT 1"),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("readiness timeout")),
            READINESS_TIMEOUT_MS,
          );
          timeout.unref();
        }),
      ]);
      return true;
    } catch {
      return false;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
