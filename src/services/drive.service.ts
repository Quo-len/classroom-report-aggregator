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
}

export interface DownloadedAsset {
  filename: string;
  mimeType: string;
  data: Buffer;
  driveFileId: string;
  authorName?: string;
}

export class DriveService {
  private static driveApi: drive_v3.Drive | null = null;

  private static async getClient(): Promise<drive_v3.Drive> {
    if (!this.driveApi) {
      const auth = await AuthService.getAuthClient();
      this.driveApi = google.drive({ version: 'v3', auth });
    }
    return this.driveApi;
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
      console.error(`❌ Failed to list files in Google Drive folder [${folderId}]:`, error);
      return results;
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
        fields: 'id, name, mimeType, webViewLink',
        supportsAllDrives: true,
      });

      return {
        id: res.data.id || fileId,
        name: res.data.name || 'unnamed_file',
        mimeType: res.data.mimeType || 'application/octet-stream',
        webViewLink: res.data.webViewLink || undefined,
      };
    } catch (error) {
      console.error(`⚠️ Failed to fetch metadata for file ID [${fileId}]:`, error);
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
        { responseType: 'arraybuffer' }
      );

      const buffer = Buffer.from(res.data as ArrayBuffer);
      console.log(`✅ Downloaded [${filename}] (${(buffer.length / 1024).toFixed(1)} KB)`);
      return buffer;
    } catch (error) {
      console.error(`❌ Error downloading file [${filename}] (ID: ${fileId}):`, error);
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
      console.error(`❌ Error exporting Google Doc [${fileId}]:`, error);
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
      console.error(`⚠️ Failed to move file [${fileId}] to folder [${folderId}]:`, error);
    }
  }

  /**
   * Collects all JPEG attachments from submissions, including from folders and zip archives
   */
  public static async collectJpegAttachments(
    submissions: { attachments: { id?: string; title?: string; alternateLink?: string; mimeType?: string }[]; studentName: string }[]
  ): Promise<DownloadedAsset[]> {
    const jpegs: DownloadedAsset[] = [];

    for (const sub of submissions) {
      for (const att of sub.attachments) {
        if (!att.id) continue;

        try {
          const meta = await this.getFileMetadata(att.id);
          const mimeType = meta?.mimeType || att.mimeType || '';
          const title = meta?.name || att.title || '';

          // 1. Direct JPEG
          if (/\.(jpe?g)$/i.test(title) || mimeType.includes('image/jpeg')) {
            const safeFilename = `${sub.studentName.replace(/[\/\\?%*:|"<>]/g, '_')}_${title || 'photo.jpg'}`;
            const buffer = await this.downloadFileBuffer(att.id, safeFilename);
            if (buffer) {
              jpegs.push({
                filename: safeFilename,
                mimeType: 'image/jpeg',
                data: buffer,
                driveFileId: att.id,
                authorName: sub.studentName,
              });
            }
          }
          // 2. Google Drive Folder
          else if (mimeType === 'application/vnd.google-apps.folder' || att.alternateLink?.includes('folders/')) {
            console.log(`📂 Scanning folder [${title}] for JPEG attachments (${sub.studentName})...`);
            const folderFiles = await this.listFilesInFolder(att.id, true);
            for (const f of folderFiles) {
              if (/\.(jpe?g)$/i.test(f.name) || (f.mimeType && f.mimeType.includes('image/jpeg'))) {
                const safeFilename = `${sub.studentName.replace(/[\/\\?%*:|"<>]/g, '_')}_${f.name}`;
                const buffer = await this.downloadFileBuffer(f.id, safeFilename);
                if (buffer) {
                  jpegs.push({
                    filename: safeFilename,
                    mimeType: 'image/jpeg',
                    data: buffer,
                    driveFileId: f.id,
                    authorName: sub.studentName,
                  });
                }
              }
            }
          }
        } catch (err) {
          console.error(`⚠️ Failed to collect JPEG attachments from [${att.title}] for ${sub.studentName}:`, err);
        }
      }
    }

    console.log(`🖼️ Total JPEG attachments collected: ${jpegs.length}`);
    return jpegs;
  }
}
