// src/app/actions/backup-actions.ts
'use server';

import type { DisplayProduct } from '@/types/product';
import { format } from 'date-fns';

// --- Main Server Action ---
export const backupToGoogleSheet = async (
    countingListData: DisplayProduct[],
    warehouseName: string,
    googleScriptUrl: string // Expecting the Apps Script Web App URL now
): Promise<{ success: boolean; message: string }> => {
  console.log("Starting backupToGoogleSheet Server Action via Apps Script...");
  console.log(`Target Google Apps Script URL: ${googleScriptUrl}`);
  console.log(`Warehouse Name: ${warehouseName}`);
  console.log(`Data Rows to Backup: ${countingListData.length}`);

  if (!countingListData || countingListData.length === 0) {
    console.log("Backup skipped: No data provided.");
    return { success: false, message: 'No hay datos en el inventario actual para respaldar.' };
  }
  if (!googleScriptUrl || !googleScriptUrl.trim().startsWith('https://script.google.com/macros/s/')) {
      console.error("Backup Error: Invalid or missing Google Apps Script URL.");
      return { success: false, message: 'Se requiere una URL válida de Google Apps Script para el respaldo.' };
  }

  try {
    // --- Prepare Data for Apps Script ---
    const backupTimestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
    // IMPORTANT: The order must match the HEADERS array in the Google Apps Script
    // HEADERS = ["Fecha Respaldo", "Almacén", "Código Barras", "Descripción", "Proveedor", "Stock Sistema", "Cantidad Contada", "Última Actualización Producto"];
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

    const payload = {
      data: values // The Apps Script expects the data under a "data" key
    };

    // --- Send Data to Google Apps Script ---
    console.log(`Sending ${values.length} rows to Google Apps Script...`);
    const response = await fetch(googleScriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      // Google Apps Script doPost often redirects, follow redirects is usually needed
      // but fetch might handle it by default depending on context.
      // redirect: 'follow', // Optional: Explicitly handle redirects if needed
      cache: 'no-store', // Ensure fresh request
    });

    console.log("Apps Script response status:", response.status);
    console.log("Apps Script response headers:", response.headers.get('content-type'));


    if (!response.ok) {
        let errorBody = await response.text().catch(() => `Status: ${response.status}`);
        console.error("Error response from Google Apps Script:", response.status, response.statusText, errorBody.substring(0, 500));
         // Check if the error is likely HTML (e.g., Google login page)
         if (errorBody.trim().startsWith('<')) {
             errorBody = "Error: La URL del script podría requerir autenticación o ser incorrecta.";
             if (response.status === 401 || response.status === 403) {
                 errorBody += " Verifica que el script esté desplegado para 'Cualquier usuario'.";
             }
         } else {
             // Try parsing as JSON if it's not HTML
             try {
                 const errorJson = JSON.parse(errorBody);
                 errorBody = errorJson.message || errorJson.error || JSON.stringify(errorJson);
             } catch (parseError) {
                 // Keep the raw text if it's not valid JSON
             }
         }

        return { success: false, message: `Error al contactar el script de respaldo (${response.status}): ${errorBody}` };
    }

    // Attempt to parse the response from the Apps Script
    let result;
    try {
        result = await response.json();
    } catch (e) {
        const textResponse = await response.text().catch(() => "No se pudo leer la respuesta.");
        console.error("Failed to parse JSON response from Apps Script:", e, "Raw Response:", textResponse.substring(0, 500));
        return { success: false, message: "Error: Respuesta inesperada del script de respaldo. Verifique los logs del script." };
    }


    console.log("Parsed response from Apps Script:", result);

    if (result.success) {
      console.log(`Backup via Google Apps Script successful. Message: ${result.message}`);
      return { success: true, message: result.message || "Respaldo exitoso via Apps Script." };
    } else {
      console.error("Apps Script reported failure:", result.message);
      return { success: false, message: `Error en el script de respaldo: ${result.message || 'Error desconocido.'}` };
    }

  } catch (error: any) {
    console.error('Error during backupToGoogleSheet (Apps Script) Server Action:', error.name, error.message, error.stack);
    let errorMessage = 'Error desconocido durante el respaldo.';

    // Check for specific fetch errors
    if (error.cause && error.cause.code) {
       // Node.js fetch specific errors
       if (error.cause.code === 'ENOTFOUND') {
           errorMessage = 'Error de red: No se pudo conectar a la URL del script de Google. Verifica la URL y tu conexión.';
       } else if (error.cause.code === 'ECONNREFUSED') {
           errorMessage = 'Error de conexión: El servidor del script rechazó la conexión.';
       } else {
           errorMessage = `Error de red (${error.cause.code}): ${error.message}`;
       }
    } else if (error instanceof TypeError && error.message.includes('fetch failed')) {
        // Generic fetch failure (could be CORS in browser, network issue, DNS issue)
        errorMessage = 'Error de red al intentar contactar el script de respaldo. Verifica la URL y la conectividad.';
    } else if (error.message) {
        errorMessage = `Error inesperado: ${error.message}`;
    }

    return { success: false, message: errorMessage };
  }
};
