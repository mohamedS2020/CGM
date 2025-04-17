// Export Firebase configuration
// This pattern allows both local and build environments to correctly import Firebase services
import { app, auth, db, storage } from './firebaseconfig';

export { app, auth, db, storage }; 