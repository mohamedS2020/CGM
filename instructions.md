
---

## ✅ Step 1: Setup Project Base

1. Initialize project using **Expo** and **TypeScript**.
2. Install dependencies:
   - `firebase`
   - `react-navigation`, `react-native-safe-area-context`, `react-native-screens`, `react-native-gesture-handler`, `@react-navigation/native-stack`
   - `react-native-nfc-manager`
   - `expo-av`, `expo-secure-store`
   - `react-native-chart-kit` or `victory-native`
3. Set up:
   - Navigation structure
   - Firebase config in `firebase/firebaseConfig.ts`
   - Auth context in `context/AuthContext.tsx`

✅ Confirm:
- Project compiles successfully
- Firebase initialized and navigation works

---

## ✅ Step 2: Authentication Flow

Create the following screens:

- `SignUpScreen.tsx` (multi-step)
- `EmailVerificationScreen.tsx`
- `SignInScreen.tsx`
- `ForgotPasswordScreen.tsx`
- `ResetPasswordScreen.tsx`

✔ Tasks:
- Sign-up saves user to Firebase Auth and Firestore.
- Email verification logic
- Login uses persistent auth
- Forgot password flow with email code (Firebase email link method or custom logic)

✅ Confirm:
- Sign up & login works
- User stays logged in
- Email verification and password reset functional

---

## ✅ Step 3: Home Screen

Create `HomeScreen.tsx` under `screens/home`

✔ Tasks:
- Show last glucose reading in a large circle
- Show glucose history chart (hour/day/week toggle)
- Add NFC scan trigger button (mock or real)
- Readings fetched from Firestore

✅ Confirm:
- Home page is responsive
- NFC scan button present
- Chart renders with mock data

---

## ✅ Step 4: Profile Screen

Create `ProfileScreen.tsx`

✔ Tasks:
- Show/edit profile fields: image, name, age, gender, phone, email
- Show/edit normal glucose level and doctor name
- All changes sync to Firestore
- Upload image using Firebase Storage

✅ Confirm:
- Profile updates saved correctly
- Profile image upload works

---

## ✅ Step 5: History Screen

Create `HistoryScreen.tsx`

✔ Tasks:
- List glucose readings
- Show timestamp and value
- Tap a reading to view/add/edit a comment
- Use Firestore subcollection `measurements`

✅ Confirm:
- History visible
- Comments saved per reading

---

## ✅ Step 6: Alerts Screen

Create `AlertScreen.tsx`

✔ Tasks:
- List all alerts (low/high)
- Each alert shows time, type, value
- Allow adding a comment to alert
- Play sound using `expo-av`

✅ Confirm:
- Alerts log visible
- Comment works
- Sound plays on alert trigger

---

## ✅ Step 7: Notes Screen

Create `NotesScreen.tsx`

✔ Tasks:
- Add/edit/delete user notes
- Notes have title, body, timestamp
- Store in `notes` subcollection

✅ Confirm:
- Notes appear and save correctly
- Edit/delete functional

---

## ✅ Step 8: Start New Sensor Screen

Create `StartSensorScreen.tsx`

✔ Tasks:
- Trigger NFC scan
- Simulate adding new sensor (reset session/log)
- Log new sensor start in Firestore

✅ Confirm:
- NFC works
- Sensor reset logic works

---

## ✅ Step 9: Alert System Logic

✔ Tasks:
- Whenever a reading is created:
  - Compare against `normalGlucose` + thresholds
  - Trigger alert if out of range
  - Add to `alerts` collection
  - Play sound and (optionally) show push notification

✅ Confirm:
- Alert created automatically on critical reading
- Sound plays
- Log appears in alert screen

---

## ✅ Step 10: Children Support

✔ Tasks:
- During sign-up or in profile, allow adding children
- Store in `children` array inside user document
- Support toggling between self and child history in Home, History, and Alert screens

✅ Confirm:
- Switch between user and children
- Readings and alerts load per selected profile

---

## ✅ Step 11: User Roles (Optional – Extend Later)

- Admin: Can view all users (future admin dashboard)
- Doctor: Can view patients who listed them
- Patient: Default user

✔ Tasks:
- Add `role` field in user doc
- Secure Firebase rules later based on roles

✅ Confirm:
- Role field exists and logic is extendable

---

## 🔚 Final Checks

- Responsive design (test on small and large phones)
- Firebase rules secure collections
- All data synced
- Alerts/sounds work
- Auth fully functional

🎉 Once all steps are complete, you’ll have a production-ready CGM NFC App.
