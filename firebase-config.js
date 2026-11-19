// Firebase web config for the BillAudit Pro project (public by design; access is controlled by
// Firestore security rules). Set the config to null to fall back to the Apps Script tracking sheet.
window.BILLAUDIT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBIFvypzj_pu21xsQS1PqXQzyaZCoraQaw',
  authDomain: 'billaudit-pro-bfd2d3.firebaseapp.com',
  projectId: 'billaudit-pro-bfd2d3',
  storageBucket: 'billaudit-pro-bfd2d3.firebasestorage.app',
  messagingSenderId: '871115037185',
  appId: '1:871115037185:web:5dba586793304464863e00'
};

// 'anonymous': the app signs itself in with no login screen (current setting).
// 'shared': everyone signs in with one shared email/password; also update firestore.rules.
window.BILLAUDIT_AUTH_MODE = 'anonymous';
