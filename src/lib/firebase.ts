// src/lib/firebase.ts
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';

// Your web app's Firebase configuration
// IMPORTANT: These values MUST be replaced by your actual Firebase project credentials,
// ideally through environment variables.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "YOUR_API_KEY",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "YOUR_AUTH_DOMAIN",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "YOUR_PROJECT_ID",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "YOUR_STORAGE_BUCKET",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "YOUR_MESSAGING_SENDER_ID",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "YOUR_APP_ID",
};

let app: FirebaseApp | null = null; // Initialize as null
let db: Firestore | null = null; // Initialize as null

// Check if the critical projectId is still a placeholder or missing
const isPlaceholderConfig = !firebaseConfig.projectId || firebaseConfig.projectId === "YOUR_PROJECT_ID";

if (isPlaceholderConfig) {
  console.error(
    "CRITICAL_FIREBASE_SETUP_ERROR: Firebase configuration is using placeholder values or is incomplete. " +
    "Firestore will NOT be initialized. " +
    "Please ensure all NEXT_PUBLIC_FIREBASE_... environment variables are correctly set in your hosting environment (e.g., Netlify) and/or your .env.local file."
  );
} else {
  if (!getApps().length) {
    try {
      app = initializeApp(firebaseConfig);
      db = getFirestore(app);
      console.log("Firebase initialized successfully with Firestore.");
    } catch (error) {
      console.error("Error initializing Firebase:", error);
      // app and db remain null if initialization fails
    }
  } else {
    app = getApp();
    try {
      db = getFirestore(app); // Get Firestore instance from existing app
      // console.log("Using existing Firebase app instance for Firestore.");
    } catch (error) {
      console.error("Error getting Firestore from existing Firebase app:", error);
      // db remains null if getting Firestore fails
    }
  }
}

// Export app and db. They will be null if initialization failed or used placeholders.
// Code using 'db' (e.g., in firestore-service.ts) MUST check if 'db' is null before using it.
export { app, db };
