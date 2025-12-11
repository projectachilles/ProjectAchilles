/**
 * Payloads Service
 * Based on internal/api/payloads.go
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import {
  Credentials,
  UploadPayloadResponse,
  DownloadPayloadResponse,
} from '../../types/endpoints.js';
import { authService } from './auth.service.js';

const API_BASE_URL = process.env.LC_API_BASE_URL || 'https://api.limacharlie.io';

export class PayloadsService {
  /**
   * Upload payload to LimaCharlie storage
   * Two-step process: 1) Get pre-signed URL, 2) Upload file
   */
  async uploadPayload(
    credentials: Credentials,
    filePath: string
  ): Promise<UploadPayloadResponse> {
    try {
      // Verify file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const fileName = path.basename(filePath);
      const fileBuffer = fs.readFileSync(filePath);

      // Step 1: Get pre-signed upload URL
      const authHeader = await authService.getAuthHeader(credentials);
      const uploadUrl = `${API_BASE_URL}/v1/payload/${credentials.oid}/${fileName}`;

      const urlResponse = await axios.post<{ put_url: string }>(
        uploadUrl,
        null,
        {
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
        }
      );

      const presignedUrl = urlResponse.data.put_url;

      // Step 2: Upload file to pre-signed URL
      await axios.put(presignedUrl, fileBuffer, {
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      return {
        url: presignedUrl,
        name: fileName,
      };
    } catch (error) {
      if (authService.isAuthError(error)) {
        authService.clearToken(credentials);
        return this.uploadPayload(credentials, filePath);
      }
      throw this.handleError(error, 'Failed to upload payload');
    }
  }

  /**
   * Get download URL for payload
   */
  async getDownloadUrl(
    credentials: Credentials,
    payloadName: string
  ): Promise<DownloadPayloadResponse> {
    try {
      const authHeader = await authService.getAuthHeader(credentials);
      const url = `${API_BASE_URL}/v1/payload/${credentials.oid}/${payloadName}`;

      const response = await axios.get<{ get_url: string }>(url, {
        headers: { Authorization: authHeader },
      });

      return {
        url: response.data.get_url,
      };
    } catch (error) {
      if (authService.isAuthError(error)) {
        authService.clearToken(credentials);
        return this.getDownloadUrl(credentials, payloadName);
      }
      throw this.handleError(error, 'Failed to get download URL');
    }
  }

  /**
   * Download payload to local file
   */
  async downloadPayload(
    credentials: Credentials,
    payloadName: string,
    outputPath: string
  ): Promise<string> {
    try {
      // Get download URL
      const { url } = await this.getDownloadUrl(credentials, payloadName);

      // Download file
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
      });

      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Write file
      fs.writeFileSync(outputPath, response.data);

      return outputPath;
    } catch (error) {
      throw this.handleError(error, 'Failed to download payload');
    }
  }

  /**
   * List payloads in organization (if API supports it)
   * Note: This might not be available in all LC API versions
   */
  async listPayloads(credentials: Credentials): Promise<{ name: string }[]> {
    try {
      const authHeader = await authService.getAuthHeader(credentials);
      const url = `${API_BASE_URL}/v1/payload/${credentials.oid}`;

      const response = await axios.get(url, {
        headers: { Authorization: authHeader },
      });

      // Log the raw response for debugging
      console.log('[PayloadsService] Raw API response:', JSON.stringify(response.data));

      // Handle different response formats
      let payloadNames: string[] = [];

      if (Array.isArray(response.data)) {
        // Response is directly an array of strings
        payloadNames = response.data;
        console.log('[PayloadsService] Parsed as array:', payloadNames);
      } else if (response.data && Array.isArray(response.data.payloads)) {
        // Response is { payloads: string[] }
        payloadNames = response.data.payloads;
        console.log('[PayloadsService] Parsed from payloads field (array):', payloadNames);
      } else if (response.data && response.data.payloads && typeof response.data.payloads === 'object') {
        // Response is { payloads: { filename1: {...}, filename2: {...} } }
        // Extract full payload metadata
        const payloadsObj = response.data.payloads;
        const payloads = Object.keys(payloadsObj).map((name) => ({
          name,
          size: payloadsObj[name].size,
          uploadedAt: payloadsObj[name].created
            ? new Date(payloadsObj[name].created * 1000).toISOString()
            : undefined,
          uploadedBy: payloadsObj[name].by,
        }));
        console.log('[PayloadsService] Parsed from payloads field (object):', payloads);
        return payloads;
      } else if (response.data && typeof response.data === 'object') {
        // Response is an object with payload names as keys
        payloadNames = Object.keys(response.data);
        console.log('[PayloadsService] Parsed from object keys:', payloadNames);
      }

      // Transform string array to Payload objects (fallback for array responses)
      const payloads = payloadNames.map((name) => ({ name }));
      console.log('[PayloadsService] Returning payloads:', payloads);
      return payloads;
    } catch (error) {
      if (authService.isAuthError(error)) {
        authService.clearToken(credentials);
        return this.listPayloads(credentials);
      }
      // If endpoint doesn't exist, return empty array
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return [];
      }
      throw this.handleError(error, 'Failed to list payloads');
    }
  }

  /**
   * Delete payload from storage
   */
  async deletePayload(credentials: Credentials, payloadName: string): Promise<void> {
    try {
      const authHeader = await authService.getAuthHeader(credentials);
      const url = `${API_BASE_URL}/v1/payload/${credentials.oid}/${payloadName}`;

      await axios.delete(url, {
        headers: { Authorization: authHeader },
      });
    } catch (error) {
      if (authService.isAuthError(error)) {
        authService.clearToken(credentials);
        return this.deletePayload(credentials, payloadName);
      }
      throw this.handleError(error, 'Failed to delete payload');
    }
  }

  /**
   * Upload payload from buffer (for multipart form uploads)
   */
  async uploadPayloadFromBuffer(
    credentials: Credentials,
    fileName: string,
    buffer: Buffer
  ): Promise<UploadPayloadResponse> {
    try {
      // Step 1: Get pre-signed upload URL
      const authHeader = await authService.getAuthHeader(credentials);
      const uploadUrl = `${API_BASE_URL}/v1/payload/${credentials.oid}/${fileName}`;

      const urlResponse = await axios.post<{ put_url: string }>(
        uploadUrl,
        null,
        {
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
        }
      );

      const presignedUrl = urlResponse.data.put_url;

      // Step 2: Upload buffer to pre-signed URL
      await axios.put(presignedUrl, buffer, {
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      return {
        url: presignedUrl,
        name: fileName,
      };
    } catch (error) {
      if (authService.isAuthError(error)) {
        authService.clearToken(credentials);
        return this.uploadPayloadFromBuffer(credentials, fileName, buffer);
      }
      throw this.handleError(error, 'Failed to upload payload from buffer');
    }
  }

  /**
   * Upload payload from file stream (memory-efficient for large files)
   * Preferred over uploadPayloadFromBuffer for files > 100MB
   */
  async uploadPayloadFromStream(
    credentials: Credentials,
    fileName: string,
    filePath: string
  ): Promise<UploadPayloadResponse> {
    try {
      // Step 1: Get pre-signed upload URL
      const authHeader = await authService.getAuthHeader(credentials);
      const uploadUrl = `${API_BASE_URL}/v1/payload/${credentials.oid}/${fileName}`;

      const urlResponse = await axios.post<{ put_url: string }>(
        uploadUrl,
        null,
        {
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
        }
      );

      const presignedUrl = urlResponse.data.put_url;

      // Step 2: Upload file using stream for memory efficiency
      const fileStream = fs.createReadStream(filePath);
      const fileStats = fs.statSync(filePath);

      await axios.put(presignedUrl, fileStream, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': fileStats.size,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      return {
        url: presignedUrl,
        name: fileName,
      };
    } catch (error) {
      if (authService.isAuthError(error)) {
        authService.clearToken(credentials);
        return this.uploadPayloadFromStream(credentials, fileName, filePath);
      }
      throw this.handleError(error, 'Failed to upload payload from stream');
    }
  }

  /**
   * Handle errors and provide meaningful messages
   */
  private handleError(error: any, defaultMessage: string): Error {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.message || error.message;
      return new Error(`${defaultMessage}: ${status ? `[${status}] ` : ''}${message}`);
    }
    return error instanceof Error ? error : new Error(defaultMessage);
  }
}

// Singleton instance
export const payloadsService = new PayloadsService();
