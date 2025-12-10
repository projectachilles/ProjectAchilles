// Service to read file contents

import * as fs from 'fs/promises';

const MAX_FILE_SIZE = 1024 * 1024; // 1MB max

export class FileService {
  /**
   * Read file content with size limit
   */
  async readFile(filePath: string): Promise<string> {
    try {
      const stat = await fs.stat(filePath);

      if (stat.size > MAX_FILE_SIZE) {
        return `[File too large to display: ${(stat.size / 1024).toFixed(2)} KB]`;
      }

      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to read file: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Check if file exists
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get file stats
   */
  async getStats(filePath: string): Promise<{ size: number; modified: Date }> {
    const stat = await fs.stat(filePath);
    return {
      size: stat.size,
      modified: stat.mtime,
    };
  }
}
