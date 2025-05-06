// src/app/actions/backup-actions.ts
'use server';

import type { DisplayProduct } from '@/types/product';
import { format } from 'date-fns';
import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';

// --- Configuration ---
// Scopes required for Google Sheets API access
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// --- Authentication ---
// Function to get authenticated Google Sheets API client
async function getSheetsClient() {
  // Ensure environment variables are set
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const projectId = process.env.GOOGLE_PROJECT_ID; // Optional, but good practice

  if (!privateKey || !clientEmail) {
    console.error("Missing Google Cloud credentials environment variables (GOOGLE_PRIVATE_KEY, GOOGLE_CLIENT_EMAIL).");
    throw new Error('Missing Google Cloud credentials.');
  }

  const auth = new GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
      project_id: projectId, // Include project ID if available
    },
    scopes: SCOPES,
  });

  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  return sheets;
}

// --- Helper to Extract Spreadsheet ID ---
const GOOGLE_SHEET_ID_PATTERN = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;
const extractSpreadsheetId = (url: string): string | null => {
  const match = url.match(GOOGLE_SHEET_ID_PATTERN);
  return match ? match[1] : null;
};

// --- Main Server Action ---
export const backupToGoogleSheet = async (
  countingListData: DisplayProduct[],
  warehouseName: string,
  googleSheetUrl: string // Expecting the full Google Sheet URL now
): Promise<{ success: boolean; message: string }> => {
  console.log("Starting backupToGoogleSheet Server Action...");
  console.log(`Target Google Sheet URL: ${googleSheetUrl}`);
  console.log(`Warehouse Name: ${warehouseName}`);
  console.log(`Data Rows to Backup: ${countingListData.length}`);

  const spreadsheetId = extractSpreadsheetId(googleSheetUrl);

  if (!spreadsheetId) {
    console.error("Backup Error: Invalid Google Sheet URL provided.");
    return { success: false, message: 'Se requiere una URL válida de Google Sheets.' };
  }

  if (!countingListData || countingListData.length === 0) {
    console.log("Backup skipped: No data provided.");
    return { success: false, message: 'No hay datos en el inventario actual para respaldar.' };
  }

  try {
    const sheets = await getSheetsClient();

    // --- Prepare Data ---
    const backupTimestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
    // Define headers (adjust order as needed in your sheet)
    const headers = ["Fecha Respaldo", "Almacén", "Código Barras", "Descripción", "Proveedor", "Stock Sistema", "Cantidad Contada", "Última Actualización Producto"];
    // Map data to the correct order
    const values = countingListData.map(product => [
      backupTimestamp,
      warehouseName,
      product.barcode || 'N/A',
      product.description || 'N/A',
      product.provider || 'N/A',
      product.stock ?? 0,
      product.count ?? 0,
      product.lastUpdated ? format(new Date(product.lastUpdated), 'yyyy-MM-dd HH:mm:ss') : 'N/A',
    ]);

    // Prepend headers to the data
    const dataToAppend = [headers, ...values];

    // --- Append Data to Sheet ---
    // Assume data should be appended to the first sheet (Sheet1) or specify a sheet name
    const sheetName = 'Sheet1'; // Change if your sheet name is different
    const range = `${sheetName}!A1`; // Append starting from cell A1 of the specified sheet

    console.log(`Appending ${values.length} rows to spreadsheet ${spreadsheetId}, sheet ${sheetName}...`);

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId,
      range: range,
      valueInputOption: 'USER_ENTERED', // Treat data as if the user typed it in
      insertDataOption: 'INSERT_ROWS', // Insert new rows for the data
      requestBody: {
        values: dataToAppend,
      },
    });

    console.log("Google Sheets API append response status:", response.status);
    // console.log("Google Sheets API append response data:", response.data); // Optional: Log detailed response

    if (response.status === 200 && response.data.updates) {
      const updatedRange = response.data.updates.updatedRange;
      console.log(`Backup successful. Data appended to range: ${updatedRange}`);
      return { success: true, message: `Respaldo exitoso. Datos agregados a ${updatedRange}.` };
    } else {
      console.error("Google Sheets API append failed:", response.statusText, response.data);
      return { success: false, message: `Error al respaldar en Google Sheets: ${response.statusText}` };
    }

  } catch (error: any) {
    console.error('Error during backupToGoogleSheet Server Action:', error.name, error.message, error.stack);
    let errorMessage = 'Error desconocido durante el respaldo.';

     if (error.code === 'PERMISSION_DENIED' || (error.errors && error.errors[0]?.reason === 'forbidden')) {
         errorMessage = 'Error de Permiso: La cuenta de servicio no tiene permiso para editar la Hoja de Google. Asegúrate de compartir la hoja con el email de la cuenta de servicio y darle permisos de editor.';
     } else if (error.code === 404 || (error.errors && error.errors[0]?.reason === 'notFound')) {
          errorMessage = 'Error: Hoja de Google no encontrada. Verifica la URL.';
     } else if (error.message.includes('Missing Google Cloud credentials')) {
         errorMessage = 'Error de Configuración: Faltan las credenciales de Google Cloud en el servidor.';
     } else if (error.message) {
        errorMessage = `Error inesperado: ${error.message}`;
    }

    return { success: false, message: errorMessage };
  }
};
