
import { initializeApp, FirebaseApp } from "firebase/app";
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut 
} from "firebase/auth";
import { getFirestore, Firestore } from "firebase/firestore";

const firebaseConfig = {

  apiKey: "AIzaSyDRN6UAMov4_Dum0YAB8pDc9CoKBgPg5bw",

  authDomain: "research-chatbot-364e7.firebaseapp.com",

  projectId: "research-chatbot-364e7",

  storageBucket: "research-chatbot-364e7.firebasestorage.app",

  messagingSenderId: "360420938048",

  appId: "1:360420938048:web:6e0deba744c34001f6eaa5"

};
let app: FirebaseApp;
let auth: ReturnType<typeof getAuth>;
let db: Firestore;

if (typeof window !== 'undefined') {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

export { auth, db, signInWithPopup, signOut, GoogleAuthProvider };