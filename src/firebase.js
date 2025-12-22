import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBWjEXj1f1hZf6UDFd2N4g5H1R6m4SK0j4",
  authDomain: "royce-valet.firebaseapp.com",
  projectId: "royce-valet",
  storageBucket: "royce-valet.firebasestorage.app",
  messagingSenderId: "504699516610",
  appId: "1:504699516610:web:89899849c1740d9d956d5b"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);