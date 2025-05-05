
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
  const item = window.localStorage.getItem(key);
  if (item === null) {
    return defaultValue;
  }
  try {
    // Attempt to parse the item only if it's not null
    return JSON.parse(item);
  } catch (error) {
    console.error(`Error reading and parsing localStorage key “${key}”:`, error);
    console.warn(`Invalid data found for key "${key}", returning default value. Data was:`, item);
    // Optionally, remove the invalid item
    // window.localStorage.removeItem(key);
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
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Error setting localStorage key “${key}”:`, error);
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

    