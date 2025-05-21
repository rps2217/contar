// src/lib/constants.ts

// For ProductDatabase component
export const GOOGLE_SHEET_URL_LOCALSTORAGE_KEY = 'stockCounterPro_googleSheetUrlOrId';

// For Home page component (src/app/page.tsx)
export const LOCAL_STORAGE_USER_ID_KEY = 'stockCounterPro_userId';
export const LOCAL_STORAGE_ACTIVE_SECTION_KEY = 'stockCounterPro_activeSection';
export const LOCAL_STORAGE_SIDEBAR_COLLAPSED_KEY = 'stockCounterPro_sidebarCollapsed';

// Note: LOCAL_STORAGE_WAREHOUSE_KEY was used in page.tsx before it was made dynamic with userId
// We now use a dynamic key for currentWarehouseId in page.tsx
// For clarity, if it was previously named LOCAL_STORAGE_WAREHOUSE_KEY and used for currentWarehouseId:
export const LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX = 'stockCounterPro_currentWarehouseId_'; // For dynamic keys like `${prefix}${userId}`

export const LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX = 'stockCounterPro_countingList_'; // For dynamic keys like `${prefix}${warehouseId}_${userId}`
export const LOCAL_STORAGE_WAREHOUSES_KEY = 'stockCounterPro_warehouses'; // Key for the list of all warehouses

export const LOGIN_USER = "rps";
export const LOGIN_PASSWORD = "2217";

export const LAST_SCANNED_BARCODE_TIMEOUT_MS = 300;
