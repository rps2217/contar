// src/app/actions/backup-actions.ts
'use server';

import type { DisplayProduct } from '@/types/product';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { format } from 'date-fns';

// --- Configuration ---
// Ensure these environment variables are set in your .env.local file or hosting environment
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID!; // The ID of your Google Sheet
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Inventario'; // The name of the sheet (tab) to append to
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'); // Replace escaped newlines

if (!SPREADSHEET_ID) {
    console.error("Missing environment variable: GOOGLE_SHEET_ID");
}
if (!SERVICE_ACCOUNT_EMAIL) {
    console.error("Missing environment variable: GOOGLE_SERVICE_ACCOUNT_EMAIL");
}
if (!PRIVATE_KEY || PRIVATE_KEY === '\n') {
    console.error("Missing or invalid environment variable: GOOGLE_PRIVATE_KEY");
}

// --- Helper Function to Authenticate ---
const authenticate = async () => {
  if (!SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY || PRIVATE_KEY === '\n') {
    throw new Error("Google Sheets API credentials are not configured in environment variables.");
  }

  const jwtClient = new JWT({
    email: SERVICE_ACCOUNT_EMAIL,
    key: PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'], // Scope needed to edit sheets
  });

  await jwtClient.authorize();
  return jwtClient;
};

// --- Main Server Action ---
export const backupToGoogleSheet = async (
    countingListData: DisplayProduct[],
    warehouseName: string // Add warehouseName for context
): Promise<{ success: boolean; message: string }> => {
  console.log("Starting backupToGoogleSheet Server Action...");

  if (!countingListData || countingListData.length === 0) {
    console.log("No data provided for backup.");
    return { success: false, message: 'No hay datos para respaldar.' };
  }
   if (!SPREADSHEET_ID) {
      return { success: false, message: 'GOOGLE_SHEET_ID no está configurado en el servidor.' };
  }

  try {
    const auth = await authenticate();
    const sheets = google.sheets({ version: 'v4', auth });

    // --- Prepare Data for Sheets API ---
    // Define headers (optional, but good for clarity if sheet is empty)
    // const headers = ["BackupTimestamp", "WarehouseName", "Barcode", "Description", "Provider", "Stock", "Count", "Last Updated"];

    const backupTimestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');

    const values = countingListData.map(product => [
      backupTimestamp,
      warehouseName, // Include warehouse name
      product.barcode,
      product.description,
      product.provider ?? 'N/A',
      product.stock ?? 0,
      product.count ?? 0,
      product.lastUpdated ? format(new Date(product.lastUpdated), 'yyyy-MM-dd HH:mm:ss') : 'N/A',
    ]);

    // --- Append Data to the Sheet ---
    console.log(`Appending ${values.length} rows to sheet: ${SPREADSHEET_ID} - ${SHEET_NAME}`);
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1`, // Append starting from cell A1 of the specified sheet
      valueInputOption: 'USER_ENTERED', // How the input data should be interpreted
      insertDataOption: 'INSERT_ROWS', // Insert new rows for the data
      requestBody: {
        values: values,
      },
    });

    console.log("Google Sheets API append response:", response.data);

    if (response.status === 200) {
      console.log("Backup to Google Sheet successful.");
      return { success: true, message: `Respaldo exitoso. ${values.length} filas agregadas a ${SHEET_NAME}.` };
    } else {
      console.error("Error response from Google Sheets API:", response.status, response.statusText);
      return { success: false, message: `Error al respaldar: ${response.statusText}` };
    }
  } catch (error: any) {
    console.error('Error during backupToGoogleSheet Server Action:', error);
    let errorMessage = 'Error desconocido durante el respaldo.';
    if (error.message) {
        errorMessage = `Error: ${error.message}`;
    }
     // Provide more specific error messages if possible
     if (error.code === 'ENOTFOUND' || error.message?.includes('getaddrinfo ENOTFOUND')) {
        errorMessage = 'Error de red: No se pudo conectar a la API de Google Sheets.';
     } else if (error.response?.data?.error?.message) {
         errorMessage = `Error de API de Google Sheets: ${error.response.data.error.message}`;
     } else if (error.message?.includes('permission') || error.message?.includes('PERMISSION_DENIED')) {
          errorMessage = 'Error de Permiso: Verifica que la cuenta de servicio tenga permisos de edición en la hoja.';
     } else if (error.message?.includes('credentials')) {
         errorMessage = 'Error de Credenciales: Verifica las variables de entorno de la cuenta de servicio.';
     }
    return { success: false, message: errorMessage };
  }
};
