// src/hooks/use-local-storage.ts
import { useState, useEffect, useCallback } from 'react';
import { getLocalStorageItem, setLocalStorageItem } from '@/lib/utils';

/**
 * Custom hook to manage state that persists in localStorage.
 * @param key The localStorage key.
 * @param initialValue The initial value if the key is not found in localStorage.
 * @returns A stateful value, and a function to update it.
 */
export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] {
  // Initialize state from localStorage or use initialValue
  const [storedValue, setStoredValue] = useState<T>(() => {
    return getLocalStorageItem<T>(key, initialValue);
  });

  // Update localStorage whenever the state changes
  useEffect(() => {
    setLocalStorageItem<T>(key, storedValue);
  }, [key, storedValue]);

  // Define a setter function that updates both state and localStorage
  const setValue = useCallback((value: T | ((val: T) => T)) => {
    try {
      // Allow value to be a function so we have same API as useState
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      // Save state
      setStoredValue(valueToStore);
      // Save to local storage (handled by useEffect)
    } catch (error) {
      console.error(`Error setting localStorage key “${key}”:`, error);
    }
  }, [key, storedValue]); // Include storedValue in dependencies for the function variant

  return [storedValue, setValue];
}
