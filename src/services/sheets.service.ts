import { google, sheets_v4 } from 'googleapis';
import { AuthService } from './auth.service';
import { DriveService } from './drive.service';
import { env } from '../config/env';

export class SheetsService {
  private static sheetsApi: sheets_v4.Sheets | null = null;

  private static async getClient(): Promise<sheets_v4.Sheets> {
    if (!this.sheetsApi) {
      const auth = await AuthService.getAuthClient();
      this.sheetsApi = google.sheets({ version: 'v4', auth });
    }
    return this.sheetsApi;
  }

  /**
   * Reads all rows from a spreadsheet ID
   */
  public static async readSheetRows(spreadsheetId: string, range: string = 'A1:Z500'): Promise<any[][]> {
    const sheets = await this.getClient();
    try {
      console.log(`📊 Reading Google Sheet [${spreadsheetId}], range: ${range}...`);
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
        valueRenderOption: 'UNFORMATTED_VALUE',
      });

      return response.data.values || [];
    } catch (error) {
      console.error(`⚠️ Failed to read sheet [${spreadsheetId}]:`, error);
      return [];
    }
  }

  /**
   * Fetches metadata for a spreadsheet
   */
  public static async getSpreadsheetMeta(spreadsheetId: string): Promise<sheets_v4.Schema$Spreadsheet | null> {
    const sheets = await this.getClient();
    try {
      const res = await sheets.spreadsheets.get({ spreadsheetId });
      return res.data;
    } catch (error) {
      console.error(`⚠️ Failed to get spreadsheet metadata [${spreadsheetId}]:`, error);
      return null;
    }
  }

  /**
   * Creates a new Master Google Sheet or updates an existing one
   */
  public static async createOrUpdateMasterSheet(
    title: string,
    gridData: any[][],
    existingSpreadsheetId?: string
  ): Promise<{ spreadsheetId: string; webViewLink: string }> {
    const sheets = await this.getClient();
    let spreadsheetId = existingSpreadsheetId;

    if (!spreadsheetId) {
      console.log(`✨ Creating new Master Spreadsheet: "${title}"...`);
      const createRes = await sheets.spreadsheets.create({
        requestBody: {
          properties: {
            title,
          },
          sheets: [
            {
              properties: {
                title: 'Зведений звіт кафедри',
                gridProperties: {
                  rowCount: Math.max(gridData.length + 20, 100),
                  columnCount: Math.max(
                    gridData.reduce((max, row) => Math.max(max, row.length), 0) + 5,
                    20
                  ),
                  frozenRowCount: 4,
                },
              },
            },
          ],
        },
      });

      spreadsheetId = createRes.data.spreadsheetId || '';
      if (!spreadsheetId) {
        throw new Error('Failed to create Master Google Sheet: empty spreadsheet ID returned.');
      }

      // Move into destination folder
      await DriveService.moveFileToMasterFolder(spreadsheetId, env.MASTER_OUTPUT_FOLDER_ID);
    } else {
      console.log(`🔄 Updating existing Master Spreadsheet ID: [${spreadsheetId}]...`);
      // Clear old values first
      try {
        await sheets.spreadsheets.values.clear({
          spreadsheetId,
          range: 'Зведений звіт кафедри!A1:ZZ1000',
        });
      } catch (err) {
        // Fallback clear
        await sheets.spreadsheets.values.clear({
          spreadsheetId,
          range: 'A1:ZZ1000',
        });
      }
    }

    // Write grid data
    console.log(`✍️ Writing ${gridData.length} rows to Master Sheet [${spreadsheetId}]...`);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: gridData,
      },
    });

    // Apply aesthetic formatting (header colors, borders, column sizes)
    await this.applyFormatting(spreadsheetId, gridData.length);

    const webViewLink = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    console.log(`🔗 Master Sheet ready: ${webViewLink}`);
    return { spreadsheetId, webViewLink };
  }

  /**
   * Applies formatting and styling to the master sheet
   */
  private static async applyFormatting(spreadsheetId: string, totalRows: number): Promise<void> {
    const sheets = await this.getClient();
    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const sheetId = meta.data.sheets?.[0]?.properties?.sheetId || 0;

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            // Header Title styling (Row 1)
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 10,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.12, green: 0.31, blue: 0.54 }, // Dark Navy
                    textFormat: {
                      foregroundColor: { red: 1, green: 1, blue: 1 },
                      fontSize: 14,
                      bold: true,
                    },
                  },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)',
              },
            },
            // Subtitle / Metadata styling (Rows 2-4)
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: 4,
                  startColumnIndex: 0,
                  endColumnIndex: 10,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.93, green: 0.95, blue: 0.98 },
                    textFormat: {
                      fontSize: 10,
                      italic: true,
                    },
                  },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)',
              },
            },
            // Auto resize columns
            {
              autoResizeDimensions: {
                dimensions: {
                  sheetId,
                  dimension: 'COLUMNS',
                  startIndex: 0,
                  endIndex: 15,
                },
              },
            },
          ],
        },
      });
    } catch (error) {
      console.warn('⚠️ Warning: Non-fatal error while applying sheet styling:', error);
    }
  }
}
