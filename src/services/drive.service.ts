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
   * Collects all JPEG attachments from submissions
   */
  public static async collectJpegAttachments(
    submissions: { attachments: { id?: string; title?: string }[]; studentName: string }[]
  ): Promise<DownloadedAsset[]> {
    const jpegs: DownloadedAsset[] = [];

    for (const sub of submissions) {
      for (const att of sub.attachments) {
        if (!att.id) continue;

        const isJpegName = att.title && /\.(jpe?g)$/i.test(att.title);
        if (!isJpegName) {
          // Check mimeType via metadata if not explicit in filename
          const meta = await this.getFileMetadata(att.id);
          if (!meta || (!meta.mimeType.includes('image/jpeg') && !/\.(jpe?g)$/i.test(meta.name))) {
            continue;
          }
        }

        const safeFilename = `${sub.studentName.replace(/[\/\\?%*:|"<>]/g, '_')}_${att.title || 'photo.jpg'}`;
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
    }

    console.log(`🖼️ Total JPEG attachments collected: ${jpegs.length}`);
    return jpegs;
  }
}
