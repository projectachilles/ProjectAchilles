// Service to read file contents

import * as fs from 'fs';
import * as path from 'path';
import { FileContent } from '../../types/test.js';

export class FileService {
  /**
   * Read file content safely
   */
  static readFileContent(filePath: string): FileContent {
    try {
      // Check file size before reading (limit to 5MB)
      const stats = fs.statSync(filePath);
      const maxSize = 5 * 1024 * 1024; // 5MB

      if (stats.size > maxSize) {
        throw new Error('File too large to display');
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const ext = path.extname(filePath).toLowerCase();

      let type = 'text';
      if (ext === '.go') type = 'go';
      else if (ext === '.ps1') type = 'powershell';
      else if (ext === '.md') type = 'markdown';
      else if (ext === '.html') type = 'html';
      else if (ext === '.sh') type = 'bash';
      else if (ext === '.json') type = 'json';
      else if (ext === '.yaml' || ext === '.yml') type = 'yaml';
      else if (ext === '.kql') type = 'kql';
      else if (ext === '.yar') type = 'yara';

      return {
        content,
        type,
      };
    } catch (error) {
      // Don't expose file path in error message - log it server-side only
      console.error(`Failed to read file: ${filePath}`, error);
      throw new Error('Failed to read file');
    }
  }

  /**
   * Check if file exists
   */
  static fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }
}
