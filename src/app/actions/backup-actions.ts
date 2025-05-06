
// src/app/actions/backup-actions.ts
'use server';

import type { DisplayProduct } from '@/types/product';
import { format } from 'date-fns';

/**
 * Backs up counting list data by sending it to a Google Apps Script Web App URL.
 *
 * IMPORTANT SETUP:
 * 1. Create a Google Sheet for the backup.
 * 2. Create a Google Apps Script bound to that sheet (Tools > Script editor).
 * 3. Paste the provided `doPost(e)` function into the script editor.
 * 4. Deploy the script as a Web App:
 *    - Click Deploy > New deployment.
 *    - Select Type: "Web app".
 *    - Configure:
 *        - Description: StockCounter Pro Backup Receiver (or similar)
 *        - Execute as: "Me (your_email@example.com)"
 *        - Who has access: "Anyone" (Be aware of security implications. For stricter control, consider "Anyone within [Your Organization]" or using OAuth, which is more complex.)
 *    - Click Deploy.
 *    - Authorize the script if prompted (Review permissions carefully).
 *    - Copy the generated Web app URL (ends in /exec).
 * 5. Paste the Web app URL into the input field in the StockCounter Pro app.
 *
 * @param countingListData The array of products currently in the counting list.
 * @param warehouseName The name of the current warehouse.
 * @param appsScriptUrl The URL of the deployed Google Apps Script Web App.
 * @returns Promise<{ success: boolean; message: string }>
 */
export const backupToGoogleSheet = async (
  countingListData: DisplayProduct[],
  warehouseName: string,
  appsScriptUrl: string // Expecting the Apps Script Web App URL now
): Promise<{ success: boolean; message: string }> => {
  console.log("Starting backupToGoogleSheet Server Action (Apps Script method)...");
  console.log(`Target Apps Script URL: ${appsScriptUrl}`);
  console.log(`Warehouse Name: ${warehouseName}`);
  console.log(`Data Rows to Backup: ${countingListData.length}`);

  // Basic URL validation (can be improved)
  if (!appsScriptUrl || !appsScriptUrl.startsWith('https://script.google.com/macros/s/')) {
    console.error("Backup Error: Invalid Google Apps Script URL provided.");
    return { success: false, message: 'Se requiere una URL válida de Google Apps Script.' };
  }

  if (!countingListData || countingListData.length === 0) {
    console.log("Backup skipped: No data provided.");
    return { success: false, message: 'No hay datos en el inventario actual para respaldar.' };
  }

  try {
    // Prepare the data payload to send to the Apps Script
    // Ensure only necessary and serializable fields are sent
    const payload = {
      warehouseName: warehouseName,
      countingListData: countingListData.map(product => ({
         barcode: product.barcode || 'N/A',
         description: product.description || 'N/A',
         provider: product.provider || 'N/A',
         stock: product.stock ?? 0,
         count: product.count ?? 0,
         // Convert date to ISO string or handle potential non-serializable date objects
         lastUpdated: product.lastUpdated ? new Date(product.lastUpdated).toISOString() : null,
       })),
    };

    console.log("Sending POST request to Apps Script URL...");

    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: {
        // Sending as text/plain and parsing JSON in Apps Script is often more reliable
        // than application/json for simple doPost triggers.
         'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(payload), // Send the JSON string as the body
      // IMPORTANT: Remove 'no-cors' mode. Apps Script Web Apps deployed to run as "Anyone"
      // should handle CORS correctly by default for simple POST requests with text/plain.
      // If you encounter CORS issues, ensure the deployment setting "Who has access" is correct.
      // Using 'no-cors' prevents reading the response.
      // mode: 'no-cors',
      redirect: 'follow', // Follow redirects if any occur
    });

     console.log("Apps Script response status:", response.status);

     // Check if the request was successful
     if (!response.ok) {
       let errorBody = `HTTP error ${response.status}`;
       try {
         // Try to read the error response from Apps Script (might be HTML or JSON)
         errorBody = await response.text();
       } catch (e) {
         console.error("Could not read error response body.");
       }
       console.error("Apps Script request failed:", errorBody);
       // Provide a more user-friendly message based on common statuses
       if (response.status === 401 || response.status === 403) {
           return { success: false, message: "Error de autorización. Verifique los permisos de la hoja o del script." };
       } else if (response.status === 404) {
           return { success: false, message: "Error: Script no encontrado. Verifique la URL." };
       } else if (response.status === 429) {
            return { success: false, message: "Demasiadas solicitudes. Inténtelo de nuevo más tarde." };
       }
       return { success: false, message: `Error al contactar el script de respaldo: ${response.status} ${response.statusText}. Detalles: ${errorBody.substring(0,100)}` };
     }

     // Parse the JSON response from the Apps Script
     const result = await response.json();
     console.log("Apps Script response data:", result);

     if (result.success) {
       console.log("Backup successful via Apps Script.");
       return { success: true, message: result.message || "Respaldo exitoso." };
     } else {
       console.error("Apps Script reported an error:", result.message);
       return { success: false, message: `Error en el script de respaldo: ${result.message || 'Error desconocido.'}` };
     }

  } catch (error: any) {
    console.error('Error during backupToGoogleSheet (Apps Script) Server Action:', error.name, error.message, error.stack);
    let errorMessage = `Error inesperado: ${error.message || 'Error de red o desconocido.'}`;
     if (error.cause) {
        errorMessage += ` Causa: ${String(error.cause).substring(0,100)}`; // Limit cause length
     }
    return { success: false, message: errorMessage };
  }
};

// --- Google Apps Script Code (doPost function) ---
// Paste this code into the Google Apps Script editor bound to your target Google Sheet:
/*
function doPost(e) {
  // --- Configuration ---
  var sheetName = "Backup"; // CHANGE THIS to your desired sheet name
  var lockTimeout = 30000; // Wait up to 30 seconds for lock

  var lock = LockService.getScriptLock();
  var lockAcquired = lock.waitLock(lockTimeout);

  if (!lockAcquired) {
    Logger.log("Could not acquire lock after " + lockTimeout + "ms.");
    return ContentService
          .createTextOutput(JSON.stringify({ success: false, message: "No se pudo adquirir el bloqueo para escribir en la hoja. Inténtelo de nuevo." }))
          .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);

    // Create sheet if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      // Set headers for the new sheet
      sheet.appendRow([
        "Fecha Respaldo", // A
        "Almacén",        // B
        "Código Barras",  // C
        "Descripción",    // D
        "Proveedor",      // E
        "Stock Sistema",  // F
        "Cantidad Contada", // G
        "Última Actualización Producto" // H
      ]);
      // Optional: Freeze header row
      sheet.setFrozenRows(1);
       SpreadsheetApp.flush(); // Ensure sheet creation and header writing is committed
       sheet = ss.getSheetByName(sheetName); // Get the reference again just in case
       if (!sheet) {
            throw new Error("Failed to create or find backup sheet: " + sheetName);
       }
       Logger.log("Created new sheet: " + sheetName);
    }

    // --- Parse Request Data ---
    var requestData;
    try {
      // Check if data is sent as text/plain JSON in the POST body
      if (e && e.postData && e.postData.contents) {
         requestData = JSON.parse(e.postData.contents);
         Logger.log("Parsed JSON data from request body.");
      } else {
         Logger.log("No valid POST data found in e.postData.contents.");
         throw new Error("No se encontraron datos válidos en la solicitud.");
      }
    } catch (parseError) {
      Logger.log("Error parsing request data: " + parseError + "\nRaw data: " + (e && e.postData ? e.postData.contents : "N/A"));
      return ContentService
            .createTextOutput(JSON.stringify({ success: false, message: "Error al analizar los datos de la solicitud: " + parseError }))
            .setMimeType(ContentService.MimeType.JSON);
    }


    var warehouseName = requestData.warehouseName || "Desconocido";
    var countingListData = requestData.countingListData || [];

    if (countingListData.length === 0) {
       Logger.log("No product data received in countingListData array.");
      return ContentService
            .createTextOutput(JSON.stringify({ success: false, message: "No se recibieron datos de productos para respaldar." }))
            .setMimeType(ContentService.MimeType.JSON);
    }

    Logger.log("Received " + countingListData.length + " products for warehouse: " + warehouseName);

    // --- Prepare Data for Sheet ---
    var backupTimestamp = new Date();
    var valuesToAppend = countingListData.map(function(product) {
       var lastUpdatedDate = 'N/A';
        try {
          if (product.lastUpdated) {
            // Attempt to parse the ISO string
            var parsedDate = new Date(product.lastUpdated);
            // Check if the parsed date is valid before formatting
            if (!isNaN(parsedDate.getTime())) {
               lastUpdatedDate = parsedDate; // Keep as Date object for direct sheet insertion
            }
          }
        } catch(dateError){
            Logger.log("Error parsing lastUpdated date for barcode " + product.barcode + ": " + dateError);
            // Keep lastUpdatedDate as 'N/A'
        }

      // Ensure correct order matching the headers
      return [
        backupTimestamp,                        // Column A: Fecha Respaldo
        warehouseName,                          // Column B: Almacén
        product.barcode || 'N/A',               // Column C: Código Barras
        product.description || 'N/A',           // Column D: Descripción
        product.provider || 'N/A',              // Column E: Proveedor
        product.stock !== undefined ? product.stock : 0, // Column F: Stock Sistema
        product.count !== undefined ? product.count : 0, // Column G: Cantidad Contada
        lastUpdatedDate                         // Column H: Última Actualización (as Date object or 'N/A')
      ];
    });

    // --- Append Data ---
    // Find the last row with content to append after it
    var lastRow = sheet.getLastRow();
    var rangeToAppend = sheet.getRange(lastRow + 1, 1, valuesToAppend.length, valuesToAppend[0].length);
    rangeToAppend.setValues(valuesToAppend);

    SpreadsheetApp.flush(); // Ensure data is written

    Logger.log("Successfully appended " + valuesToAppend.length + " rows to sheet '" + sheetName + "'.");

    // --- Return Success Response ---
    return ContentService
          .createTextOutput(JSON.stringify({ success: true, message: "Respaldo exitoso. " + valuesToAppend.length + " filas agregadas a '" + sheetName + "'." }))
          .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    Logger.log("Error in doPost: " + error + "\nStack: " + (error.stack ? error.stack : 'No stack available'));
    // --- Return Error Response ---
    return ContentService
          .createTextOutput(JSON.stringify({ success: false, message: "Error interno del script: " + error }))
          .setMimeType(ContentService.MimeType.JSON);
  } finally {
    if (lockAcquired) {
      lock.releaseLock(); // Release the lock
      Logger.log("Script lock released.");
    }
  }
}

// Optional: Add a simple doGet function for testing the deployment
function doGet(e) {
  Logger.log("doGet function executed.");
  return HtmlService.createHtmlOutput("<html><body><h1>StockCounter Pro Backup Script</h1><p>This script receives POST requests to back up data.</p></body></html>");
}

*/
// Ensure no characters exist after the closing comment marker
