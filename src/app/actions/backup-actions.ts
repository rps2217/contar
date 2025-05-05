
// src/app/actions/backup-actions.ts
'use server';

import type { DisplayProduct } from '@/types/product';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { format } from 'date-fns';

// --- Configuration ---
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'); // Replace escaped newlines
const DEFAULT_SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Inventario'; // Default sheet name

// --- Helper Function to Authenticate ---
const authenticate = async () => {
  if (!SERVICE_ACCOUNT_EMAIL) {
    console.error("Missing environment variable: GOOGLE_SERVICE_ACCOUNT_EMAIL");
    throw new Error("Configuración incompleta: Falta el email de la cuenta de servicio (GOOGLE_SERVICE_ACCOUNT_EMAIL).");
  }
  if (!PRIVATE_KEY || PRIVATE_KEY === '\n') {
    console.error("Missing or invalid environment variable: GOOGLE_PRIVATE_KEY");
    throw new Error("Configuración incompleta: Falta la clave privada de la cuenta de servicio (GOOGLE_PRIVATE_KEY).");
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
    console.error("Error during Google Sheets API authentication:", authError);
    // Provide specific feedback based on common auth errors
    if (authError.message?.includes('private key') || authError.message?.includes('invalid_grant')) {
         throw new Error("Error de Autenticación: La clave privada o el email de la cuenta de servicio son incorrectos. Verifica las variables de entorno.");
    }
    throw new Error(`Error de Autenticación: ${authError.message}`);
  }
};

// --- Main Server Action ---
export const backupToGoogleSheet = async (
    countingListData: DisplayProduct[],
    warehouseName: string,
    spreadsheetId: string
): Promise<{ success: boolean; message: string }> => {
  console.log("Starting backupToGoogleSheet Server Action...");
  console.log(`Service Account Email: ${SERVICE_ACCOUNT_EMAIL ? 'Set' : 'Not Set'}`);
  console.log(`Private Key: ${PRIVATE_KEY && PRIVATE_KEY !== '\n' ? 'Set' : 'Not Set or Invalid'}`);
  console.log(`Spreadsheet ID: ${spreadsheetId}`);
  console.log(`Warehouse Name: ${warehouseName}`);
  console.log(`Data Rows: ${countingListData.length}`);


  if (!countingListData || countingListData.length === 0) {
    console.log("No data provided for backup.");
    return { success: false, message: 'No hay datos para respaldar.' };
  }
  if (!spreadsheetId || !spreadsheetId.trim()) {
      console.error("Missing spreadsheetId for backup.");
      return { success: false, message: 'Se requiere el ID de la Hoja de Google para el respaldo.' };
  }

  try {
    const auth = await authenticate(); // Authentication handles its own specific errors now
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetName = DEFAULT_SHEET_NAME;

    // --- Prepare Data for Sheets API ---
    const backupTimestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
    // Define headers that match the expected order in the sheet
    // Note: This won't *write* headers, but ensures data order matches assumed header order
    // const headers = ["BackupTimestamp", "WarehouseName", "Barcode", "Description", "Provider", "Stock", "Count", "Last Updated"];

    const values = countingListData.map(product => [
      backupTimestamp,
      warehouseName,
      product.barcode,
      product.description,
      product.provider ?? 'N/A', // Use 'N/A' if provider is null/undefined
      product.stock ?? 0,     // Use 0 if stock is null/undefined
      product.count ?? 0,     // Use 0 if count is null/undefined
      product.lastUpdated ? format(new Date(product.lastUpdated), 'yyyy-MM-dd HH:mm:ss') : 'N/A', // Format date or use 'N/A'
    ]);

    // --- Append Data to the Sheet ---
    console.log(`Appending ${values.length} rows to sheet: ${spreadsheetId} - ${sheetName}`);
    const request = {
        spreadsheetId: spreadsheetId,
        range: `${sheetName}!A1`, // Append starting from cell A1 of the specified sheet
        valueInputOption: 'USER_ENTERED', // How the input data should be interpreted
        insertDataOption: 'INSERT_ROWS', // Insert new rows for the data
        requestBody: {
          values: values,
        },
      };

    const response = await sheets.spreadsheets.values.append(request);

    console.log("Google Sheets API append response status:", response.status);
    // console.log("Google Sheets API append response data:", response.data); // Be careful logging potentially large data

    if (response.status === 200 && response.data.updates?.updatedRows) {
      const addedRows = response.data.updates.updatedRows;
      console.log(`Backup to Google Sheet successful. Added ${addedRows} rows.`);
      return { success: true, message: `Respaldo exitoso. ${addedRows} filas agregadas a ${sheetName} en la hoja ${spreadsheetId}.` };
    } else {
      // Handle cases where status might be 200 but something went wrong (e.g., 0 rows added)
      console.error("Unexpected response from Google Sheets API:", response.status, response.statusText, response.data);
      const errorDetail = response.data?.error?.message || response.statusText || 'Respuesta inesperada de la API.';
      return { success: false, message: `Error al respaldar: ${errorDetail}` };
    }
  } catch (error: any) {
    console.error('Error during backupToGoogleSheet Server Action:', error);
    let errorMessage = 'Error desconocido durante el respaldo.';

     // Check for specific Google API errors (error.errors is common for Google API client errors)
     if (error.errors && Array.isArray(error.errors) && error.errors.length > 0) {
         const apiError = error.errors[0];
         console.error("Google API Specific Error:", apiError);
         errorMessage = `Error de API de Google: ${apiError.message} (${apiError.reason})`;
         if (apiError.reason === 'notFound') {
             errorMessage = `Error: Hoja de cálculo no encontrada. Verifica el ID: ${spreadsheetId}.`;
         } else if (apiError.reason === 'forbidden' || error.code === 403) {
             errorMessage = `Error de Permiso (403): Asegúrate de que la cuenta de servicio (${SERVICE_ACCOUNT_EMAIL}) tenga permisos de 'Editor' en la Hoja de Google compartida.`;
         } else if (apiError.message?.toLowerCase().includes('permission')) {
             errorMessage = `Error de Permiso: ${apiError.message}. Verifica los permisos de la cuenta de servicio en la hoja.`;
         }
     }
     // Check for authentication errors thrown by our helper
     else if (error.message?.startsWith('Configuración incompleta') || error.message?.startsWith('Error de Autenticación')) {
          errorMessage = error.message; // Use the specific message from authenticate()
     }
     // Check for generic network errors
     else if (error.code === 'ENOTFOUND' || error.message?.includes('getaddrinfo ENOTFOUND')) {
        errorMessage = 'Error de red: No se pudo conectar a la API de Google Sheets.';
     }
     // Check for other response status codes
     else if (error.response?.status === 404) {
         errorMessage = `Error: Hoja de cálculo no encontrada (404). Verifica el ID: ${spreadsheetId}.`;
     } else if (error.response?.status === 403) {
         errorMessage = `Error de Permiso (403): Verifica que la cuenta de servicio (${SERVICE_ACCOUNT_EMAIL}) tenga permisos de edición en la hoja.`;
     } else if (error.response?.data?.error?.message) {
         // Fallback for other structured API errors
         errorMessage = `Error de API de Google Sheets: ${error.response.data.error.message}`;
     }
     // Use generic message if nothing else matched
     else if (error.message) {
         errorMessage = `Error: ${error.message}`;
     }

    return { success: false, message: errorMessage };
  }
};
      