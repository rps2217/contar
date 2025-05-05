// src/app/actions/backup-actions.ts
'use server';

import type { DisplayProduct } from '@/types/product';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { format } from 'date-fns';

// --- Configuration ---
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
// Replace escaped newlines in the private key if stored as a single line env var
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const DEFAULT_SHEET_NAME = 'Inventario'; // Default sheet name if needed, but appending works without it

// --- Helper Function to Authenticate ---
const authenticate = async () => {
  console.log("Attempting Google Sheets API authentication...");
  console.log(`Service Account Email: ${SERVICE_ACCOUNT_EMAIL ? 'Set' : 'MISSING!'}`);
  console.log(`Private Key: ${PRIVATE_KEY && PRIVATE_KEY !== '\n' ? 'Set (potentially valid)' : 'MISSING or Invalid!'}`);

  if (!SERVICE_ACCOUNT_EMAIL) {
    console.error("Authentication Error: Missing GOOGLE_SERVICE_ACCOUNT_EMAIL environment variable.");
    throw new Error("Configuración incompleta: Falta el email de la cuenta de servicio (GOOGLE_SERVICE_ACCOUNT_EMAIL).");
  }
  // Check if private key is truly missing or just consists of the newline character replacement artifact
  if (!PRIVATE_KEY || PRIVATE_KEY.trim().length <= '-----BEGIN PRIVATE KEY-----\n-----END PRIVATE KEY-----\n'.length) {
    console.error("Authentication Error: Missing or invalid GOOGLE_PRIVATE_KEY environment variable.");
    throw new Error("Configuración incompleta: Falta la clave privada de la cuenta de servicio (GOOGLE_PRIVATE_KEY). Asegúrate de que esté completa y bien formateada.");
  }

  try {
    const jwtClient = new JWT({
      email: SERVICE_ACCOUNT_EMAIL,
      key: PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'], // Scope needed to edit sheets
    });
    await jwtClient.authorize();
    console.log("Google Sheets API authentication successful.");
    return jwtClient;
  } catch (authError: any) {
    console.error("Error during Google Sheets API authentication:", authError.message, authError.stack);
    // Provide specific feedback based on common auth errors
    if (authError.message?.includes('private key') || authError.message?.includes('invalid_grant')) {
         throw new Error("Error de Autenticación: La clave privada o el email de la cuenta de servicio son incorrectos. Verifica las variables de entorno.");
    } else if (authError.message?.includes('PEM routines') || authError.message?.includes('bad base64 decode')) {
         throw new Error("Error de Autenticación: El formato de la clave privada es incorrecto. Asegúrate de copiarla completa, incluyendo las líneas BEGIN/END.");
    }
    throw new Error(`Error de Autenticación con Google: ${authError.message}`);
  }
};

// --- Main Server Action ---
export const backupToGoogleSheet = async (
    countingListData: DisplayProduct[],
    warehouseName: string,
    spreadsheetId: string
): Promise<{ success: boolean; message: string }> => {
  console.log("Starting backupToGoogleSheet Server Action...");
  console.log(`Target Spreadsheet ID: ${spreadsheetId}`);
  console.log(`Warehouse Name: ${warehouseName}`);
  console.log(`Data Rows to Backup: ${countingListData.length}`);


  if (!countingListData || countingListData.length === 0) {
    console.log("Backup skipped: No data provided.");
    return { success: false, message: 'No hay datos en el inventario actual para respaldar.' };
  }
  if (!spreadsheetId || !spreadsheetId.trim()) {
      console.error("Backup Error: Missing spreadsheetId.");
      return { success: false, message: 'Se requiere el ID de la Hoja de Google para el respaldo.' };
  }

  try {
    const auth = await authenticate(); // Authentication handles its own specific errors now
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetName = DEFAULT_SHEET_NAME; // Specify the sheet *name* to append to

    // --- Prepare Data for Sheets API ---
    const backupTimestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
    // IMPORTANT: Define headers in the order you want them in the sheet.
    // The first row of your sheet should ideally match these headers.
    // The `append` operation won't add headers, it just adds data rows.
    // If the sheet is empty, you might want to add headers first (separate operation).
    const headers = ["Fecha Respaldo", "Almacén", "Código Barras", "Descripción", "Proveedor", "Stock Sistema", "Cantidad Contada", "Última Actualización Producto"];

    const values = countingListData.map(product => [
      backupTimestamp,
      warehouseName,
      product.barcode || 'N/A', // Provide default for barcode
      product.description || 'N/A', // Provide default for description
      product.provider || 'N/A', // Provide default for provider
      product.stock ?? 0,
      product.count ?? 0,
      product.lastUpdated ? format(new Date(product.lastUpdated), 'yyyy-MM-dd HH:mm:ss') : 'N/A',
    ]);

    // Optional: Add headers as the first row if you want to ensure they exist
    // const dataToWrite = [headers, ...values];
    const dataToWrite = values; // Assuming headers already exist or you don't need them written by the action

    // --- Append Data to the Sheet ---
    console.log(`Appending ${dataToWrite.length} rows to sheet: ${spreadsheetId} -> ${sheetName}`);
    const request = {
        spreadsheetId: spreadsheetId,
        // Append to the first empty row found in the specified sheet.
        range: `${sheetName}!A1`, // Sheets API automatically finds the next empty row starting from A1 in this sheet.
        valueInputOption: 'USER_ENTERED', // How the input data should be interpreted (like typing in the UI)
        insertDataOption: 'INSERT_ROWS', // Insert new rows for the data
        requestBody: {
          values: dataToWrite,
        },
      };

    const response = await sheets.spreadsheets.values.append(request);

    console.log("Google Sheets API append response status:", response.status);

    if (response.status === 200 && response.data.updates?.updatedRows) {
      const addedRows = response.data.updates.updatedRows - (dataToWrite.length === values.length + 1 ? 1 : 0); // Adjust if headers were written
      console.log(`Backup to Google Sheet successful. Added ${addedRows} data rows.`);
      return { success: true, message: `Respaldo exitoso. ${addedRows} filas agregadas a la hoja '${sheetName}'.` };
    } else {
      // Handle cases where status might be 200 but something went wrong (e.g., 0 rows added)
      console.error("Unexpected response from Google Sheets API:", response.status, response.statusText, response.data);
      const errorDetail = response.data?.error?.message || response.statusText || 'Respuesta inesperada de la API.';
      return { success: false, message: `Error al respaldar: ${errorDetail}` };
    }
  } catch (error: any) {
    console.error('Error during backupToGoogleSheet Server Action:', error.message, error.stack);
    let errorMessage = 'Error desconocido durante el respaldo.';

     // Check for specific Google API errors structure
     if (error.errors && Array.isArray(error.errors) && error.errors.length > 0) {
         const apiError = error.errors[0];
         console.error("Google API Specific Error Details:", apiError);
         errorMessage = `Error de API de Google: ${apiError.message} (Razón: ${apiError.reason})`;
         if (apiError.reason === 'notFound') {
             errorMessage = `Error: Hoja de cálculo no encontrada con ID: ${spreadsheetId}. Verifica el ID.`;
         } else if (apiError.reason === 'forbidden' || error.code === 403) {
             errorMessage = `Error de Permiso (403): Asegúrate de que la cuenta de servicio (${SERVICE_ACCOUNT_EMAIL}) tenga permisos de 'Editor' en la Hoja de Google y que la API de Google Sheets esté habilitada en tu proyecto de Google Cloud.`;
         } else if (apiError.message?.toLowerCase().includes('permission denied')) {
             errorMessage = `Error de Permiso: ${apiError.message}. Verifica los permisos de la cuenta de servicio en la hoja.`;
         } else if (apiError.message?.toLowerCase().includes('unable to parse range')) {
              errorMessage = `Error: No se pudo encontrar la pestaña llamada '${DEFAULT_SHEET_NAME}' en la hoja con ID: ${spreadsheetId}. Asegúrate de que la pestaña exista.`;
         }
     }
     // Check for authentication errors thrown by our helper
     else if (error.message?.startsWith('Configuración incompleta') || error.message?.startsWith('Error de Autenticación')) {
          errorMessage = error.message; // Use the specific message from authenticate()
     }
     // Check for generic network errors
     else if (error.code === 'ENOTFOUND' || error.message?.includes('getaddrinfo ENOTFOUND')) {
        errorMessage = 'Error de red: No se pudo conectar a la API de Google Sheets. Verifica tu conexión a internet.';
     }
     // Check for other response status codes or specific errors
     else if (error.response?.status === 404) {
         errorMessage = `Error: Hoja de cálculo no encontrada con ID: ${spreadsheetId} (404). Verifica el ID.`;
     } else if (error.response?.status === 403) {
         errorMessage = `Error de Permiso (403): Asegúrate de que la cuenta de servicio (${SERVICE_ACCOUNT_EMAIL}) tenga permisos de 'Editor' en la hoja y que la API esté habilitada.`;
     } else if (error.response?.data?.error?.message) {
         // Fallback for other structured API errors from Google
         errorMessage = `Error de API de Google Sheets: ${error.response.data.error.message}`;
     }
     // Use generic message if nothing else matched
     else if (error.message) {
         errorMessage = `Error inesperado: ${error.message}`;
     }

    return { success: false, message: errorMessage };
  }
};
