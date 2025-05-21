
// src/lib/firebase.ts
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
// Firebase Auth import no es necesario para el login simple actual
// import { getAuth, type Auth } from 'firebase/auth';

// Tu configuración de Firebase para la aplicación web
// IMPORTANTE: Estos valores DEBEN ser reemplazados por tus credenciales reales del proyecto Firebase,
// idealmente a través de variables de entorno.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "YOUR_API_KEY",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "YOUR_AUTH_DOMAIN",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "YOUR_PROJECT_ID",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "YOUR_STORAGE_BUCKET",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "YOUR_MESSAGING_SENDER_ID",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "YOUR_APP_ID",
};

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
// let auth: Auth | null = null; // Instancia de Auth no necesaria para el login simple

// Verifica si el projectId crítico (y apiKey) todavía son placeholders o están ausentes
const isPlaceholderConfig =
  !firebaseConfig.projectId ||
  firebaseConfig.projectId === "YOUR_PROJECT_ID" ||
  !firebaseConfig.apiKey ||
  firebaseConfig.apiKey === "YOUR_API_KEY";

if (isPlaceholderConfig) {
  // Cambiado de console.error a console.warn
  console.warn(
    "CRITICAL_FIREBASE_SETUP_WARNING: Firebase configuration is using placeholder values or is incomplete. " +
    "Firestore (and other Firebase services) will NOT be initialized correctly. " +
    "Please ensure all NEXT_PUBLIC_FIREBASE_... environment variables are correctly set in your hosting environment (e.g., Netlify) and/or your .env.local file."
  );
  // app, db (y auth si se usara) permanecerán como null si se entra en este bloque
} else {
  // Asegura que Firebase se inicialice solo en el lado del cliente
  if (typeof window !== 'undefined') {
    if (!getApps().length) {
      try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        // auth = getAuth(app); // No necesario para el login simple
        console.log("Firebase initialized successfully with Firestore.");
      } catch (error) {
        console.error("Error initializing Firebase:", error);
        // app, db, auth permanecen null si la inicialización falla
      }
    } else {
      app = getApp();
      try {
        db = getFirestore(app); // Obtener instancia de Firestore de la app existente
        // auth = getAuth(app); // No necesario para el login simple
        // console.log("Using existing Firebase app instance for Firestore.");
      } catch (error) {
        console.error("Error getting Firestore from existing Firebase app:", error);
        // db permanece null si falla la obtención de Firestore
      }
    }
  }
}

// Exporta app y db. Serán null si la inicialización falló o se usaron placeholders.
// El código que usa 'db' (ej. en firestore-service.ts) DEBE verificar si 'db' es null antes de usarlo.
export { app, db };
// export { app, db, auth }; // Exportar auth si/cuando se reimplemente Firebase Auth completo
