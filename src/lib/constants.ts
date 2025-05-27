
// src/lib/constants.ts

// For ProductDatabase component
export const GOOGLE_SHEET_URL_LOCALSTORAGE_KEY = 'stockCounterPro_googleSheetUrlOrId';

// For Home page component (src/app/page.tsx)
export const LOCAL_STORAGE_USER_ID_KEY = 'stockCounterPro_userId';
export const LOCAL_STORAGE_ACTIVE_SECTION_KEY = 'stockCounterPro_activeSection';
export const LOCAL_STORAGE_SIDEBAR_COLLAPSED_KEY = 'stockCounterPro_sidebarCollapsed';
export const LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX = 'stockCounterPro_currentWarehouseId_';
export const LOCAL_STORAGE_WAREHOUSE_LIST_KEY_PREFIX = 'stockCounterPro_warehouseList_'; // Added for warehouse list

export const LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX = 'stockCounterPro_countingList_';

export const LOGIN_USER = "rps";
export const LOGIN_PASSWORD = "2217";

export const LAST_SCANNED_BARCODE_TIMEOUT_MS = 300;

// Default Warehouse constants
export const DEFAULT_WAREHOUSE_ID = 'main';
export const DEFAULT_WAREHOUSE_NAME = 'Almacén Principal';
    