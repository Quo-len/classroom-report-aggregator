import { accountContext } from '../core/account-context';
import { database } from './database.service';
import { google, sheets_v4 } from 'googleapis';
import { AuthService } from './auth.service';
import { DriveService } from './drive.service';
import { env } from '../config/env';
import { TEMPLATE_MERGES } from '../config/official-template';

export class SheetsService {
  private static async getClient(): Promise<sheets_v4.Sheets> {
    const auth = await AuthService.getAuthClient();
    return google.sheets({ version: 'v4', auth });
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
   * Creates a new Master Google Sheet or updates an existing one:
   * Sheet 1 ("Підсумковий звіт"): Exact 1-to-1 table from 2_Інформ._про_наук.роб_(бланк)_2026.xlsx (Cols A, B, C only).
   * Sheet 2 ("Деталізація по викладачах"): Breakdown by individual teachers (Cols D, E, F...), static plans, and registry.
   */
  public static async createOrUpdateMasterSheet(
    title: string,
    summaryGrid: any[][],
    detailGrid?: any[][],
    existingSpreadsheetId?: string
  ): Promise<{ spreadsheetId: string; webViewLink: string }> {
    const sheets = await this.getClient();
    let spreadsheetId = existingSpreadsheetId;
    const context = accountContext.getStore();
    if (context?.assignmentId && !context.dryRun) {
      const existing = await database().query('SELECT spreadsheet_id FROM bird.reports WHERE user_id = $1 AND course_id = $2 AND assignment_id = $3',
        [context.userId, env.CLASSROOM_COURSE_ID, context.assignmentId]);
      spreadsheetId = existing.rows[0]?.spreadsheet_id || spreadsheetId;
    }
    const summarySheetTitle = 'Підсумковий звіт';
    const detailSheetTitle = 'Деталізація по викладачах';

    let summarySheetId = 0;
    let detailSheetId = 1;

    if (!spreadsheetId) {
      console.log(`✨ Creating new Master Spreadsheet: "${title}"...`);
      const sheetDefs: sheets_v4.Schema$Sheet[] = [
        {
          properties: {
            sheetId: 0,
            title: summarySheetTitle,
            gridProperties: {
              rowCount: Math.max(summaryGrid.length + 5, 135),
              columnCount: 3, // EXACTLY 3 COLUMNS: A, B, C
            },
          },
        },
      ];

      if (detailGrid && detailGrid.length > 0) {
        sheetDefs.push({
          properties: {
            sheetId: 1,
            title: detailSheetTitle,
            gridProperties: {
              rowCount: Math.max(detailGrid.length + 20, 150),
              columnCount: Math.max(
                detailGrid.reduce((max, row) => Math.max(max, row.length), 0) + 5,
                10
              ),
              frozenRowCount: 11,
            },
          },
        });
      }

      const createRes = await sheets.spreadsheets.create({
        requestBody: {
          properties: {
            title,
          },
          sheets: sheetDefs,
        },
      });

      spreadsheetId = createRes.data.spreadsheetId || '';
      if (!spreadsheetId) {
        throw new Error('Failed to create Master Google Sheet: empty spreadsheet ID returned.');
      }

      if (context?.assignmentId && !context.dryRun) {
        await database().query(`INSERT INTO bird.reports (user_id, course_id, assignment_id, spreadsheet_id) VALUES ($1, $2, $3, $4)
          ON CONFLICT (user_id, course_id, assignment_id) DO UPDATE SET spreadsheet_id = EXCLUDED.spreadsheet_id`,
          [context.userId, env.CLASSROOM_COURSE_ID, context.assignmentId, spreadsheetId]);
      }

    } else {
      console.log(`🔄 Updating existing Master Spreadsheet ID: [${spreadsheetId}]...`);
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const existingSheets = meta.data.sheets || [];

      const foundSummary = existingSheets.find(
        (s) => s.properties?.title === summarySheetTitle || s.properties?.sheetId === 0
      );
      if (foundSummary?.properties?.sheetId !== undefined && foundSummary.properties.sheetId !== null) {
        summarySheetId = foundSummary.properties.sheetId;
      }

      const foundDetail = existingSheets.find((s) => s.properties?.title === detailSheetTitle);
      if (foundDetail?.properties?.sheetId !== undefined && foundDetail.properties.sheetId !== null) {
        detailSheetId = foundDetail.properties.sheetId;
      } else if (detailGrid && detailGrid.length > 0) {
        // Create second sheet if it doesn't exist
        const addSheetRes = await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: detailSheetTitle,
                    gridProperties: {
                      rowCount: Math.max(detailGrid.length + 20, 150),
                      columnCount: Math.max(
                        detailGrid.reduce((max, row) => Math.max(max, row.length), 0) + 5,
                        10
                      ),
                      frozenRowCount: 11,
                    },
                  },
                },
              },
            ],
          },
        });
        detailSheetId = addSheetRes.data.replies?.[0]?.addSheet?.properties?.sheetId || 1;
      }

      const resize: sheets_v4.Schema$Request[] = [{ updateSheetProperties: {
        properties: { sheetId: summarySheetId, gridProperties: { rowCount: Math.max(summaryGrid.length + 5, 135) } },
        fields: 'gridProperties.rowCount',
      } }, { unmergeCells: { range: { sheetId: summarySheetId } } }];
      if (detailGrid?.length) resize.push({ updateSheetProperties: {
        properties: { sheetId: detailSheetId, gridProperties: {
          rowCount: Math.max(detailGrid.length + 20, 150),
          columnCount: Math.max(...detailGrid.map(row => row.length), 10) + 5,
        } }, fields: 'gridProperties.rowCount,gridProperties.columnCount',
      } });
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: resize } });

      // Clear values on both sheets
      try {
        await sheets.spreadsheets.values.clear({
          spreadsheetId,
          range: `'${summarySheetTitle}'!A1:Z1000`,
        });
      } catch {
        await sheets.spreadsheets.values.clear({ spreadsheetId, range: 'A1:Z1000' });
      }

      if (detailGrid && detailGrid.length > 0) {
        try {
          await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: `'${detailSheetTitle}'!A1:ZZ1000`,
          });
        } catch {}
      }
    }

    await DriveService.moveFileToMasterFolder(spreadsheetId, env.MASTER_OUTPUT_FOLDER_ID);

    // 1. Write Sheet 1: 1-to-1 Summary Grid (Columns A, B, C only)
    console.log(`✍️ Writing ${summaryGrid.length} rows to Sheet 1 [${summarySheetTitle}]...`);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${summarySheetTitle}'!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: summaryGrid,
      },
    });

    // 2. Write Sheet 2: Detail Grid (Breakdown by teachers)
    if (detailGrid && detailGrid.length > 0) {
      console.log(`✍️ Writing ${detailGrid.length} rows to Sheet 2 [${detailSheetTitle}]...`);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${detailSheetTitle}'!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: detailGrid,
        },
      });
    }

    // 3. Apply formatting
    await this.applySummaryFormatting(spreadsheetId, summarySheetId, summaryGrid.length);

    if (detailGrid && detailGrid.length > 0) {
      await this.applyDetailFormatting(spreadsheetId, detailSheetId, detailGrid.length);
    }

    const webViewLink = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    console.log(`🔗 Master Sheet ready: ${webViewLink}`);
    return { spreadsheetId, webViewLink };
  }

  /**
   * Applies clean 1-to-1 official template formatting to Sheet 1 ("Підсумковий звіт"):
   * Exactly 3 columns (A, B, C), official merges, clean neutral borders, no aggressive background colors.
   */
  private static async applySummaryFormatting(spreadsheetId: string, sheetId: number, totalRows: number): Promise<void> {
    const sheets = await this.getClient();
    try {
      const requests: sheets_v4.Schema$Request[] = [
        // 1. Exact Column Widths matching Excel template 1-to-1
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
            properties: { pixelSize: 55 }, // Col A: №
            fields: 'pixelSize',
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
            properties: { pixelSize: 580 }, // Col B: Зміст інформації
            fields: 'pixelSize',
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 },
            properties: { pixelSize: 180 }, // Col C: Разом по кафедрі
            fields: 'pixelSize',
          },
        },

        // 2. Document Title styling (Row 2, 0-indexed row 1)
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex: 2,
              startColumnIndex: 1,
              endColumnIndex: 3,
            },
            cell: {
              userEnteredFormat: {
                textFormat: { fontSize: 13, bold: true },
                horizontalAlignment: 'CENTER',
              },
            },
            fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
          },
        },

        // 3. Document Subtitle styling (Rows 3-4, 0-indexed rows 2-4)
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 2,
              endRowIndex: 4,
              startColumnIndex: 1,
              endColumnIndex: 3,
            },
            cell: {
              userEnteredFormat: {
                textFormat: { fontSize: 11 },
                horizontalAlignment: 'CENTER',
              },
            },
            fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
          },
        },

        // 4. Contact Info Notice styling (Row 6, 0-indexed row 5)
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 5,
              endRowIndex: 6,
              startColumnIndex: 1,
              endColumnIndex: 3,
            },
            cell: {
              userEnteredFormat: {
                textFormat: { fontSize: 10, bold: true, italic: true },
              },
            },
            fields: 'userEnteredFormat(textFormat)',
          },
        },

        // 5. Col A alignment (Center, Bold) for indicator rows 12..132
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 11,
              endRowIndex: Math.min(totalRows, 133),
              startColumnIndex: 0,
              endColumnIndex: 1,
            },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'TOP',
                textFormat: { bold: true },
              },
            },
            fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)',
          },
        },

        // 6. Col B alignment (Left, Wrap) for indicator rows 12..132
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 11,
              endRowIndex: Math.min(totalRows, 133),
              startColumnIndex: 1,
              endColumnIndex: 2,
            },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: 'LEFT',
                verticalAlignment: 'MIDDLE',
                wrapStrategy: 'WRAP',
              },
            },
            fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)',
          },
        },

        // 7. Col C alignment (Center, Middle, Bold) for indicator rows 12..132
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 11,
              endRowIndex: Math.min(totalRows, 133),
              startColumnIndex: 2,
              endColumnIndex: 3,
            },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'MIDDLE',
                textFormat: { bold: true },
              },
            },
            fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)',
          },
        },

        // 8. Clean Table Borders matching the blank template
        {
          updateBorders: {
            range: {
              sheetId,
              startRowIndex: 11,
              endRowIndex: Math.min(totalRows, 133),
              startColumnIndex: 0,
              endColumnIndex: 3,
            },
            top: { style: 'SOLID', width: 1, color: { red: 0.65, green: 0.65, blue: 0.65 } },
            bottom: { style: 'SOLID', width: 1, color: { red: 0.65, green: 0.65, blue: 0.65 } },
            left: { style: 'SOLID', width: 1, color: { red: 0.65, green: 0.65, blue: 0.65 } },
            right: { style: 'SOLID', width: 1, color: { red: 0.65, green: 0.65, blue: 0.65 } },
            innerHorizontal: { style: 'SOLID', width: 1, color: { red: 0.8, green: 0.8, blue: 0.8 } },
            innerVertical: { style: 'SOLID', width: 1, color: { red: 0.8, green: 0.8, blue: 0.8 } },
          },
        },
      ];

      // 9. Official template section merges (A12:A17, A18:A20, A21:A42, etc.)
      for (const tm of TEMPLATE_MERGES) {
        requests.push({
          mergeCells: {
            range: {
              sheetId,
              startRowIndex: tm.startRow - 1,
              endRowIndex: tm.endRow,
              startColumnIndex: tm.startCol,
              endColumnIndex: tm.endCol,
            },
            mergeType: 'MERGE_ALL',
          },
        });
      }

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests },
      });
      console.log(`🎨 Applied 1-to-1 official template styling to Sheet 1 ("Підсумковий звіт")`);
    } catch (error) {
      console.warn('⚠️ Warning: Non-fatal error while applying summary sheet styling:', error);
    }
  }

  /**
   * Applies formatting to Sheet 2 ("Деталізація по викладачах"):
   * Freezes 11 rows, sets column widths, styles header row and adds table borders.
   */
  private static async applyDetailFormatting(spreadsheetId: string, sheetId: number, totalRows: number): Promise<void> {
    const sheets = await this.getClient();
    try {
      const requests: sheets_v4.Schema$Request[] = [
        // 1. Freeze top 11 rows
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: {
                frozenRowCount: 11,
              },
            },
            fields: 'gridProperties.frozenRowCount',
          },
        },

        // 2. Column Widths
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
            properties: { pixelSize: 48 }, // Col A: №
            fields: 'pixelSize',
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
            properties: { pixelSize: 480 }, // Col B: Показники
            fields: 'pixelSize',
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 },
            properties: { pixelSize: 160 }, // Col C: Разом
            fields: 'pixelSize',
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 30 },
            properties: { pixelSize: 140 }, // Col D+: Teachers
            fields: 'pixelSize',
          },
        },

        // 3. Header row 11 styling (Subtle soft gray header)
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 10,
              endRowIndex: 11,
              startColumnIndex: 0,
              endColumnIndex: 25,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.92, green: 0.94, blue: 0.97 },
                textFormat: { fontSize: 10, bold: true },
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'MIDDLE',
                wrapStrategy: 'WRAP',
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
          },
        },

        // 4. Borders for detail table
        {
          updateBorders: {
            range: {
              sheetId,
              startRowIndex: 10,
              endRowIndex: Math.min(totalRows, 133),
              startColumnIndex: 0,
              endColumnIndex: 25,
            },
            top: { style: 'SOLID', width: 1, color: { red: 0.7, green: 0.7, blue: 0.7 } },
            bottom: { style: 'SOLID', width: 1, color: { red: 0.7, green: 0.7, blue: 0.7 } },
            left: { style: 'SOLID', width: 1, color: { red: 0.7, green: 0.7, blue: 0.7 } },
            right: { style: 'SOLID', width: 1, color: { red: 0.7, green: 0.7, blue: 0.7 } },
            innerHorizontal: { style: 'SOLID', width: 1, color: { red: 0.85, green: 0.85, blue: 0.85 } },
            innerVertical: { style: 'SOLID', width: 1, color: { red: 0.85, green: 0.85, blue: 0.85 } },
          },
        },
      ];

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests },
      });
      console.log(`🎨 Applied detail formatting to Sheet 2 ("Деталізація по викладачах")`);
    } catch (error) {
      console.warn('⚠️ Warning: Non-fatal error while applying detail sheet styling:', error);
    }
  }
}
