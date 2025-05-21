// src/lib/firebase.ts
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
// import { getAuth, type Auth } from 'firebase/auth'; // Commented out if not using Firebase Auth

// Your web app's Firebase configuration
// IMPORTANT: Replace with your actual Firebase config values
// Consider using environment variables for security
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "YOUR_API_KEY",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "YOUR_AUTH_DOMAIN",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "YOUR_PROJECT_ID",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "YOUR_STORAGE_BUCKET",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "YOUR_MESSAGING_SENDER_ID",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "YOUR_APP_ID",
  // measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "YOUR_MEASUREMENT_ID" // Optional
};

// Initialize Firebase only if it hasn't been initialized yet
let app: FirebaseApp;
let db: Firestore;
// let auth: Auth; // Commented out if not using Firebase Auth

if (!getApps().length) {
  app = initializeApp(firebaseConfig);
  if (firebaseConfig.projectId !== "YOUR_PROJECT_ID" && firebaseConfig.apiKey !== "YOUR_API_KEY") {
    db = getFirestore(app);
    // auth = getAuth(app); // Commented out if not using Firebase Auth
    console.log("Firebase initialized with Firestore.");
  } else {
    console.warn("Firebase configuration is using placeholder values. Firestore (and Auth) will not be initialized.");
    // @ts-ignore - Assign a dummy object to db and auth if not initialized
    db = {} as Firestore;
    // auth = {} as Auth; // Commented out
  }
} else {
  app = getApp();
  if (firebaseConfig.projectId !== "YOUR_PROJECT_ID" && firebaseConfig.apiKey !== "YOUR_API_KEY") {
    db = getFirestore(app);
    // auth = getAuth(app); // Commented out
  } else {
     console.warn("Firebase configuration is using placeholder values. Firestore (and Auth) will not be initialized.");
    // @ts-ignore
    db = {} as Firestore;
    // auth = {} as Auth; // Commented out
  }
}


export { app, db }; // Export 'auth' only if you re-enable it
