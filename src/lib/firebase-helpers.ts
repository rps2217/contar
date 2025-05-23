// src/lib/firebase-helpers.ts

import { Timestamp } from 'firebase/firestore';

/**
 * Converts a Firestore Timestamp to a JavaScript Date object.
 * Returns null if the input is not a valid Timestamp.
 */
export function timestampToDate(timestamp: any): Date | null {
  if (timestamp instanceof Timestamp) {
    return timestamp.toDate();
  }
  // Check if it's an object that looks like a Timestamp (from server-side rendering perhaps)
  if (timestamp && typeof timestamp.seconds === 'number' && typeof timestamp.nanoseconds === 'number') {
    return new Timestamp(timestamp.seconds, timestamp.nanoseconds).toDate();
  }
  return null;
}

/**
 * Converts a JavaScript Date object or a date string to a Firestore Timestamp.
 * Returns null if the input is not a valid Date or date string.
 */
export function dateToTimestamp(date: Date | string | null | undefined): Timestamp | null {
  if (date instanceof Date) {
    return Timestamp.fromDate(date);
  }
  if (typeof date === 'string') {
    const parsedDate = new Date(date);
    if (!isNaN(parsedDate.getTime())) {
      return Timestamp.fromDate(parsedDate);
    }
  }
  return null;
}
