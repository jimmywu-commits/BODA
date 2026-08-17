<<<<<<< HEAD
/* JBP 使用反饋 Firebase 設定
 * 管理頁使用 Firebase Authentication 的「電子郵件/密碼」登入。
 * 一般使用者送出反饋時使用 Anonymous Authentication。
 * 此版本僅使用 Authentication + Cloud Firestore，不使用 Firebase Storage。
 */
window.BN_FEEDBACK_CONFIG = {
  firebaseConfig: {
    apiKey: "AIzaSyBV8PTY4sZGRTbQTNDMyqUEB1Eqnwkw6BA",
    authDomain: "jbp-ed.firebaseapp.com",
    projectId: "jbp-ed",
    storageBucket: "jbp-ed.firebasestorage.app",
    messagingSenderId: "458472558224",
    appId: "1:458472558224:web:cb6b3733183426e06cd215",
    measurementId: "G-ZKS0JRLLN5"
  },

  collectionName: "bn_feedback",

  // Firebase Console > Authentication > Users > 使用者 UID
  adminUids: [
    "QoPe75RsJehf8imORa9p4KXy1fu2"
  ]
};
=======
/* JBP 使用反饋 Firebase 設定
 * 管理頁使用 Firebase Authentication 的「電子郵件/密碼」登入。
 * 一般使用者送出反饋時使用 Anonymous Authentication。
 * 此版本僅使用 Authentication + Cloud Firestore，不使用 Firebase Storage。
 */
window.BN_FEEDBACK_CONFIG = {
  firebaseConfig: {
    apiKey: "AIzaSyBV8PTY4sZGRTbQTNDMyqUEB1Eqnwkw6BA",
    authDomain: "jbp-ed.firebaseapp.com",
    projectId: "jbp-ed",
    storageBucket: "jbp-ed.firebasestorage.app",
    messagingSenderId: "458472558224",
    appId: "1:458472558224:web:cb6b3733183426e06cd215",
    measurementId: "G-ZKS0JRLLN5"
  },

  collectionName: "bn_feedback",

  // Firebase Console > Authentication > Users > 使用者 UID
  adminUids: [
    "QoPe75RsJehf8imORa9p4KXy1fu2"
  ]
};
>>>>>>> d0c1f49ca454b8cb7adfad3de1a2ba8ba35521b1
