// src/components/product-database.worker.ts
// Use the 'no-use-before-define' ESLint rule to disable this warning.
/* eslint-disable no-use-before-define */

interface Product {
  barcode: string;
  description: string;
  provider: string;
  stock: number;
  count: number;
}

const CHUNK_SIZE = 200;

const openDB = (dbName: string, dbVersion: number, objectStoreName: string): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);

    request.onerror = () => {
      console.error("Error opening IndexedDB", request.error);
      reject(request.error);
    };

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(objectStoreName)) {
        db.createObjectStore(objectStoreName, { keyPath: "barcode" });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
};

const addProductsToDB = async (dbName: string, objectStoreName: string, products: Product[]): Promise<void> => {
  const db = await openDB(dbName, 1, objectStoreName);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(objectStoreName, "readwrite");
    const objectStore = transaction.objectStore(objectStoreName);

    products.forEach(product => {
      objectStore.put(product);
    });

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      console.error("Error adding products to IndexedDB", transaction.error);
      reject(transaction.error);
    };
  });
};


const parseCSV = (csvData: string): Product[] => {
  const lines = csvData.split("\n");
  const headers = lines[0].split(",");
  const products: Product[] = [];

  for (let i = 1; i < lines.length; i++) {
    const data = lines[i].split(",");
    if (data.length === headers.length) {
      const barcode = data[0] || "";
      const description = data[1] || "";
      const provider = data[2] || "";
      const stockValue = parseInt(data[3]);
      const stock = isNaN(stockValue) ? 0 : stockValue;

      const product: Product = {
        barcode,
        description,
        provider,
        stock,
        count: 0,
      };
      products.push(product);
    }
  }

  return products;
};

// Listen for messages from the main thread
self.onmessage = async (event) => {
  if (event.data.type === 'processCSV') {
    try {
      const { csvData, dbName, objectStoreName } = event.data;
      const lines = csvData.split("\n");
        const totalProducts = lines.length - 1;
        let uploadedCount = 0;
         // Process chunks sequentially
         for (let i = 1; i < lines.length; i += CHUNK_SIZE) {
          const start = i;
          const end = Math.min(i + CHUNK_SIZE, lines.length);
          const chunk = lines.slice(start, end);
          const parsedProducts = parseCSV(chunk.join("\n"));
            await addProductsToDB(dbName, objectStoreName, parsedProducts);
            uploadedCount += parsedProducts.length;
            const progress = Math.min(
              100,
              Math.round((uploadedCount / totalProducts) * 100)
            ); // Ensure progress doesn't exceed 100
             // Send progress update to the main thread
             self.postMessage({ type: 'updateProgress', progress });
          }

        // Send completion message to the main thread
        self.postMessage({ type: 'uploadComplete', count: uploadedCount });
    } catch (error: any) {
      // Send error message to the main thread
      self.postMessage({ type: 'error', message: error.message });
    }
  }
};
