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
 *        - Execute as: "Me (your_email@example.com)"
 *        - Who has access: "Anyone" (Be aware of security implications)
 *    - Click Deploy.
 *    - Authorize the script if prompted.
 *    - Copy the generated Web app URL.
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
    const payload = {
      warehouseName: warehouseName,
      countingListData: countingListData.map(product => ({ // Send only necessary fields if needed
         barcode: product.barcode || 'N/A',
         description: product.description || 'N/A',
         provider: product.provider || 'N/A',
         stock: product.stock ?? 0,
         count: product.count ?? 0,
         lastUpdated: product.lastUpdated || null, // Send as ISO string or null
       })),
    };

    console.log("Sending POST request to Apps Script URL...");

    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      // Apps Script doPost expects a specific content type for parameters by default,
      // but sending JSON and parsing it in the script is more robust.
      // Option 1: Send as JSON (requires JSON.parse in Apps Script doPost)
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      // Option 2: Send as form data (simpler Apps Script, harder JS)
      // headers: {
      //   'Content-Type': 'application/x-www-form-urlencoded',
      // },
      // body: new URLSearchParams({ data: JSON.stringify(payload) }) // Send JSON string as a parameter
    });

    console.log("Apps Script response status:", response.status);

    if (!response.ok) {
      // Try to get more specific error from response body if possible
      let errorBody = `HTTP error ${response.status}`;
      try {
        const errorJson = await response.json();
        errorBody = errorJson.message || errorJson.error || JSON.stringify(errorJson);
      } catch (e) {
        // If response is not JSON, try text
        try {
          errorBody = await response.text();
        } catch (textError) {
          console.error("Could not read error response body.");
        }
      }
      console.error("Apps Script request failed:", errorBody);
      return { success: false, message: `Error al contactar el script de respaldo: ${errorBody}` };
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
    // Network errors or other fetch-related issues
    let errorMessage = `Error inesperado: ${error.message || 'Error de red o desconocido.'}`;
     if (error.cause) { // Fetch often includes more details in error.cause
        errorMessage += ` Causa: ${error.cause}`;
     }

    return { success: false, message: errorMessage };
  }
};

// --- Google Apps Script Code (doPost function) ---
/*
Paste this code into the Google Apps Script editor bound to your target Google Sheet:

```javascript
/**
 * Handles POST requests to back up inventory data to the Google Sheet.
 * Expects a JSON payload in the request body with:
 * {
 *   "warehouseName": "string",
 *   "countingListData": [ { "barcode": "...", "description": "...", ... } ]
 * }
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // Wait up to 30 seconds for lock

  try {
    // --- Configuration ---
    var sheetName = "Backup"; // CHANGE THIS to your desired sheet name
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);

    // Create sheet if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      // Set headers for the new sheet
      sheet.appendRow([
        "Fecha Respaldo",
        "Almacén",
        "Código Barras",
        "Descripción",
        "Proveedor",
        "Stock Sistema",
        "Cantidad Contada",
        "Última Actualización Producto" // Corrected Header
      ]);
       SpreadsheetApp.flush(); // Ensure sheet creation is committed
       sheet = ss.getSheetByName(sheetName); // Get the reference again
       if (!sheet) {
            throw new Error("Failed to create backup sheet: " + sheetName);
       }
    }

    // Get headers from the sheet to ensure correct order (optional but good practice)
    // var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    // Logger.log("Sheet Headers: " + headers.join(", ")); // Log headers for debugging

    // --- Parse Request Data ---
    var requestData;
    try {
       // Check if data is sent as JSON in the body
       if (e.postData && e.postData.type === "application/json") {
            requestData = JSON.parse(e.postData.contents);
       } else if (e.parameter && e.parameter.data) {
           // Fallback: Check if data is sent as a 'data' parameter (e.g., from x-www-form-urlencoded)
            requestData = JSON.parse(e.parameter.data);
       } else {
           throw new Error("No valid POST data found. Send JSON body or 'data' parameter.");
       }

    } catch (parseError) {
      Logger.log("Error parsing request data: " + parseError + "\\nRaw data: " + (e.postData ? e.postData.contents : "N/A"));
      return ContentService
            .createTextOutput(JSON.stringify({ success: false, message: "Error al analizar los datos de la solicitud: " + parseError }))
            .setMimeType(ContentService.MimeType.JSON);
    }


    var warehouseName = requestData.warehouseName || "Desconocido";
    var countingListData = requestData.countingListData || [];

    if (countingListData.length === 0) {
      return ContentService
            .createTextOutput(JSON.stringify({ success: false, message: "No se recibieron datos de productos para respaldar." }))
            .setMimeType(ContentService.MimeType.JSON);
    }

    // --- Prepare Data for Sheet ---
    var backupTimestamp = new Date();
    var valuesToAppend = countingListData.map(function(product) {
      // Ensure correct order matching the headers
      return [
        backupTimestamp, // Column A: Fecha Respaldo
        warehouseName,    // Column B: Almacén
        product.barcode || 'N/A',      // Column C: Código Barras
        product.description || 'N/A', // Column D: Descripción
        product.provider || 'N/A',    // Column E: Proveedor
        product.stock !== undefined ? product.stock : 0,       // Column F: Stock Sistema
        product.count !== undefined ? product.count : 0,       // Column G: Cantidad Contada
        product.lastUpdated ? new Date(product.lastUpdated) : 'N/A' // Column H: Última Actualización
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
    Logger.log("Error in doPost: " + error + "\\nStack: " + error.stack);
    // --- Return Error Response ---
    return ContentService
          .createTextOutput(JSON.stringify({ success: false, message: "Error interno del script: " + error }))
          .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock(); // Release the lock
  }
}

// Optional: Add a simple doGet function for testing the deployment
function doGet(e) {
  return HtmlService.createHtmlOutput("Apps Script for StockCounter Backup is running.");
}
```
*/
