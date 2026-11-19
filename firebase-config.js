// Firebase web config for the BillAudit Pro project (public by design; access is controlled by
// Firestore security rules). Set the config to null to fall back to the Apps Script tracking sheet.
window.BILLAUDIT_FIREBASE_CONFIG = null;

// 'anonymous': the app signs itself in with no login screen (current setting).
// 'shared': everyone signs in with one shared email/password; also update firestore.rules.
window.BILLAUDIT_AUTH_MODE = 'anonymous';
