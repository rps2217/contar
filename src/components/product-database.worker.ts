// src/components/product-database.worker.ts
/* eslint-disable no-use-before-define */

interface Product {
  barcode: string;
  description: string;
  provider: string;
  stock: number;
  count: number;
}

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

async function streamReadCSV(csvData: string, dbName: string, objectStoreName: string): Promise<number> {
  const lines = csvData.split("\n");
    let uploadedCount = 0;

     // Process chunks sequentially
     const parsedProducts = parseCSV(csvData);
     await addProductsToDB(dbName, objectStoreName, parsedProducts);
     uploadedCount += parsedProducts.length;
     // Send completion message to the main thread
     return uploadedCount;
}

// Listen for messages from the main thread
self.onmessage = async (event) => {
  if (event.data.type === 'processCSV') {
    try {
      const { csvData, dbName, objectStoreName } = event.data;

        const totalProducts = csvData.length;
        let uploadedCount = 0;
         uploadedCount = await streamReadCSV(csvData, dbName, objectStoreName);
        // Send completion message to the main thread
        self.postMessage({ type: 'uploadComplete', count: uploadedCount });
    } catch (error: any) {
      // Send error message to the main thread
      self.postMessage({ type: 'error', message: error.message });
    }
  }
};
