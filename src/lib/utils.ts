// src/lib/utils.ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Helper function to safely get item from localStorage
export const getLocalStorageItem = <T>(key: string, defaultValue: T): T => {
  if (typeof window === 'undefined') {
    return defaultValue;
  }
  let item: string | null = null;
  try {
    item = window.localStorage.getItem(key);
  } catch (storageError) {
      console.error(`Error reading localStorage key “${key}” from storage:`, storageError);
      return defaultValue; // Return default if storage access fails
  }

  // Check if item is null, undefined, or an empty string before attempting to parse
  if (item === null || item === 'undefined' || item === '') {
    return defaultValue;
  }

  try {
    // Attempt to parse the item only if it's not null/empty/undefined string
    const parsedItem = JSON.parse(item);
    // Basic type check: Ensure the parsed item is not null or undefined,
    // and if defaultValue is an array, check if parsedItem is also an array.
    // Add more checks here if needed based on expected T types.
    if (parsedItem === null || typeof parsedItem === 'undefined') {
        console.warn(`Parsed item for key "${key}" is null or undefined, returning default value.`);
        return defaultValue;
    }
    if (Array.isArray(defaultValue) && !Array.isArray(parsedItem)) {
        console.warn(`Expected array for key "${key}" but received different type, returning default value.`);
        return defaultValue;
    }
    // Consider adding more specific type checks based on T if possible/necessary

    return parsedItem;
  } catch (parseError) {
    console.error(`Error parsing JSON for localStorage key “${key}”:`, parseError);
    // Log the problematic data (first 100 chars) for debugging
    console.warn(`Invalid JSON data found for key "${key}", returning default value. Data was:`, item?.substring(0, 100));
    // Optionally, remove the invalid item to prevent future errors
    // try { window.localStorage.removeItem(key); } catch (removeError) { console.error(`Error removing invalid item for key "${key}":`, removeError); }
    return defaultValue;
  }
};


// Helper function to safely set item in localStorage
export const setLocalStorageItem = <T>(key: string, value: T): void => {
  if (typeof window === 'undefined') {
    console.warn('localStorage is not available.');
    return;
  }
  try {
    // Ensure the value being stored is not undefined, as JSON.stringify(undefined) is undefined
    if (typeof value === 'undefined') {
        console.warn(`Attempted to store undefined for key "${key}". Removing item instead.`);
        window.localStorage.removeItem(key);
        return;
    }
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Error setting localStorage key “${key}”:`, error);
     // Consider more specific error handling, e.g., QuotaExceededError
     if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        alert(`Error: Local storage quota exceeded. Cannot save data for key "${key}". Please clear some storage space.`);
     }
  }
};


// Debounce function to limit the frequency of calls
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const debounce = <F extends (...args: any[]) => any>(func: F, waitFor: number) => {
  let timeoutId: NodeJS.Timeout | null = null;

  return (...args: Parameters<F>): Promise<ReturnType<F>> => {
    return new Promise((resolve) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(() => {
        timeoutId = null; // Clear timeoutId after execution
        resolve(func(...args));
      }, waitFor);
    });
  };
};
