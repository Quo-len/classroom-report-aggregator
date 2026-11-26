import { apiError } from './api-error';
import { accountContext } from '../core/account-context';
import fs from 'fs';
import path from 'path';
import { google, drive_v3 } from 'googleapis';
import { AuthService } from './auth.service';
import { env } from '../config/env';

export interface DriveFileInfo {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  size?: number;
}

export interface DownloadedAsset {
  filename: string;
  mimeType: string;
  data: Buffer;
  driveFileId: string;
  authorName?: string;
  webViewLink?: string;
}

export class DriveService {
  private static async getClient(): Promise<drive_v3.Drive> {
    const auth = await AuthService.getAuthClient();
    return google.drive({ version: 'v3', auth });
  }

  /**
   * Extracts a Google Drive Folder ID from a URL, markdown link, or plain text
   */
  public static extractDriveFolderId(input?: string): string | null {
    if (!input) return null;
    const str = input.trim();
    // 1. Match Google Drive folder URLs
    const folderMatch =
      str.match(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/i) ||
      str.match(/drive\.google\.com\/(?:open|folderview)\?id=([a-zA-Z0-9_-]+)/i);
    if (folderMatch) {
      return folderMatch[1];
    }
    // 2. Direct folder ID string (alphanumeric with underscores/dashes, length 20 to 50)
    if (/^[a-zA-Z0-9_-]{20,50}$/.test(str)) {
      return str;
    }
    return null;
  }

  /**
   * Lists all files inside a Google Drive folder, optionally traversing subfolders recursively
   */
  public static async listFilesInFolder(folderId: string, recursive: boolean = true): Promise<DriveFileInfo[]> {
    const drive = await this.getClient();
    const results: DriveFileInfo[] = [];
    try {
      console.log(`📂 Scanning Google Drive folder [${folderId}] (recursive=${recursive})...`);
      let pageToken: string | undefined = undefined;

      do {
        const res: any = await drive.files.list({
          q: `'${folderId}' in parents and trashed = false`,
          fields: 'nextPageToken, files(id, name, mimeType, webViewLink, parents)',
          pageSize: 100,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          pageToken,
        });

        const files = res.data.files || [];
        for (const file of files) {
          if (!file.id) continue;
          const info: DriveFileInfo = {
            id: file.id,
            name: file.name || 'unnamed',
            mimeType: file.mimeType || 'application/octet-stream',
            webViewLink: file.webViewLink || undefined,
          };

          if (file.mimeType === 'application/vnd.google-apps.folder') {
            if (recursive) {
              console.log(`📁 Entering subfolder: "${file.name}" [${file.id}]...`);
              const subFiles = await this.listFilesInFolder(file.id, recursive);
              results.push(...subFiles);
            }
          } else {
            results.push(info);
          }
        }

        pageToken = res.data.nextPageToken || undefined;
      } while (pageToken);

      console.log(`✅ Found ${results.length} files in Google Drive folder [${folderId}]`);
      return results;
    } catch (error) {
      console.error(`❌ Failed to list files in Google Drive folder [${folderId}]:`, apiError(error));
      throw error;
    }
  }

  /**
   * Retrieves file metadata
   */
  public static async getFileMetadata(fileId: string): Promise<DriveFileInfo | null> {
    const drive = await this.getClient();
    try {
      const res = await drive.files.get({
        fileId,
        fields: 'id, name, mimeType, webViewLink, size',
        supportsAllDrives: true,
      });

      return {
        id: res.data.id || fileId,
        name: res.data.name || 'unnamed_file',
        mimeType: res.data.mimeType || 'application/octet-stream',
        webViewLink: res.data.webViewLink || undefined,
        size: res.data.size ? Number(res.data.size) : undefined,
      };
    } catch (error) {
      console.error(`⚠️ Failed to fetch metadata for file ID [${fileId}]:`, apiError(error));
      return null;
    }
  }

  /**
   * Downloads a binary file (e.g. JPEG image) as a Buffer
   */
  public static async downloadFileBuffer(fileId: string, filename: string): Promise<Buffer | null> {
    const drive = await this.getClient();
    try {
      console.log(`⬇️ Downloading file [${filename}] (ID: ${fileId})...`);
      const res = await drive.files.get(
        {
          fileId,
          alt: 'media',
          supportsAllDrives: true,
        },
        { responseType: 'arraybuffer', maxContentLength: 50 * 1024 * 1024 }
      );

      const buffer = Buffer.from(res.data as ArrayBuffer);
      console.log(`✅ Downloaded [${filename}] (${(buffer.length / 1024).toFixed(1)} KB)`);
      return buffer;
    } catch (error) {
      console.error(`❌ Error downloading file [${filename}] (ID: ${fileId}):`, apiError(error));
      return null;
    }
  }

  /** Exports Google Docs as Word so the existing parser can read tables. */
  public static async exportDocAsDocx(fileId: string): Promise<Buffer | null> {
    try {
      const drive = await this.getClient();
      console.log(`Exporting Google Doc [${fileId}] as DOCX...`);
      const res = await drive.files.export(
        { fileId, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { responseType: 'arraybuffer', maxContentLength: 50 * 1024 * 1024 }
      );
      return Buffer.from(res.data as ArrayBuffer);
    } catch (error) {
      console.error(`Failed to export Google Doc [${fileId}] as DOCX:`, apiError(error));
      return null;
    }
  }

  /**
   * Exports a Google Docs file as plain text
   */
  public static async exportDocAsText(fileId: string): Promise<string | null> {
    const drive = await this.getClient();
    try {
      console.log(`📄 Exporting Google Doc [${fileId}] as plain text...`);
      const res = await drive.files.export(
        {
          fileId,
          mimeType: 'text/plain',
        },
        { responseType: 'text' }
      );
      return res.data as string;
    } catch (error) {
      console.error(`❌ Error exporting Google Doc [${fileId}]:`, apiError(error));
      return null;
    }
  }

  /**
   * Moves a file to the destination folder MASTER_OUTPUT_FOLDER_ID
   */
  public static async moveFileToMasterFolder(fileId: string, folderId: string = env.MASTER_OUTPUT_FOLDER_ID): Promise<void> {
    const drive = await this.getClient();
    try {
      // Retrieve existing parents
      const file = await drive.files.get({
        fileId,
        fields: 'parents',
        supportsAllDrives: true,
      });

      if (file.data.parents?.includes(folderId)) return;
      const previousParents = (file.data.parents || []).join(',');

      await drive.files.update({
        fileId,
        addParents: folderId,
        removeParents: previousParents,
        fields: 'id, parents',
        supportsAllDrives: true,
      });

      console.log(`📁 File [${fileId}] placed into master folder [${folderId}]`);
    } catch (error) {
      console.error(`⚠️ Failed to move file [${fileId}] to folder [${folderId}]:`, apiError(error));
      if (accountContext.getStore()) throw error;
    }
  }

  /**
   * Collects all JPEG attachments from submissions, including from folders and zip archives
   */
  public static async collectJpegAttachments(
    submissions: { attachments: { id?: string; title?: string; alternateLink?: string; mimeType?: string }[]; studentName: string }[]
  ): Promise<DownloadedAsset[]> {
    const jpegs: DownloadedAsset[] = [];
    const seen = new Set<string>();
    let totalBytes = 0;
    let attachedCount = 0;
    let evidenceFolder: string | undefined;
    const collect = async (file: DriveFileInfo, author: string) => {
      if (seen.has(file.id)) return;
      seen.add(file.id);
      if (!/\.jpe?g$/i.test(file.name) && file.mimeType !== 'image/jpeg') return;
      const meta = file.size === undefined ? await this.getFileMetadata(file.id) : file;
      const filename = `${author}_${file.name}`.replace(/[\/\\?%*:|"<>]/g, '_');
      // Leave room for MIME and both base64 encodings; never fetch overflow photos into memory.
      if (meta?.size !== undefined && meta.size <= 5 * 1024 * 1024 && totalBytes + meta.size <= 12 * 1024 * 1024 && attachedCount < 20) {
        const data = await this.downloadFileBuffer(file.id, filename);
        if (data && totalBytes + data.length <= 12 * 1024 * 1024) {
          totalBytes += data.length;
          attachedCount++;
          jpegs.push({ filename, mimeType: 'image/jpeg', data, driveFileId: file.id, authorName: author });
          return;
        }
      }
      const drive = await this.getClient();
      if (!evidenceFolder) {
        const folder = await drive.files.create({ requestBody: { name: 'Підтвердження', mimeType: 'application/vnd.google-apps.folder', parents: [env.MASTER_OUTPUT_FOLDER_ID] }, fields: 'id' });
        evidenceFolder = folder.data.id || undefined;
        if (!evidenceFolder) throw new Error('Не вдалося створити папку підтверджень');
      }
      const copy = await drive.files.copy({ fileId: file.id, requestBody: { name: filename, parents: [evidenceFolder] }, fields: 'id,webViewLink', supportsAllDrives: true });
      if (!copy.data.id) throw new Error('Не вдалося скопіювати підтвердження');
      jpegs.push({ filename, mimeType: 'image/jpeg', data: Buffer.alloc(0), driveFileId: copy.data.id,
        webViewLink: `https://drive.google.com/drive/folders/${evidenceFolder}`, authorName: author });
    };
    for (const sub of submissions) {
      for (const attachment of sub.attachments) {
        if (!attachment.id) continue;
        const meta = await this.getFileMetadata(attachment.id);
        if (!meta) throw new Error(`Не вдалося прочитати вкладення: ${attachment.title}`);
        if (meta.mimeType === 'application/vnd.google-apps.folder') {
          for (const file of await this.listFilesInFolder(meta.id, true)) await collect(file, sub.studentName);
        } else await collect(meta, sub.studentName);
      }
    }
    return jpegs;
  }
}
