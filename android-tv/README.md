# PULL UP! TV — app Android TV / Google TV

App **Trusted Web Activity (TWA)** : elle embarque simplement la page
`https://pull-up.live/tv` (écran de pairing par code + bigscreen, voir
`routes/screen.js` et `public/js/auth.js`) dans une app installable et
publiable sur le Google Play Store, avec icône dans la rangée d'accueil
Google TV / Android TV (catégorie `LEANBACK_LAUNCHER`).

Générée sur le même modèle que l'outil officiel [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)
de Google, avec la lib `com.google.androidbrowserhelper:androidbrowserhelper`.

## ⚠️ Prérequis important

Une TWA s'appuie sur Chrome (Custom Tabs) installé sur l'appareil pour
afficher la page sans barre d'adresse. **Google TV** (Chromecast avec
Google TV, TV Google TV/Android TV avec services Google) l'a par défaut.
Certains boîtiers Android TV « génériques » (sans Google Play Services)
ne l'ont pas — dans ce cas l'app retombe sur un navigateur externe. Pour
la diffusion visée (Play Store / Google TV), c'est le cas standard et
recommandé par Google.

## 1. Ouvrir le projet

Ouvre le dossier `android-tv/` dans **Android Studio** (File → Open).
Android Studio complètera automatiquement le Gradle Wrapper manquant
(`gradlew`, `gradle-wrapper.jar`) au premier sync — ou génère-le toi-même :

```bash
cd android-tv
gradle wrapper --gradle-version 8.9   # si tu as Gradle installé en local
```

## 2. Créer ta clé de signature (upload key)

```bash
keytool -genkey -v -keystore pullup-tv-upload.keystore \
  -alias pullup-tv -keyalg RSA -keysize 2048 -validity 10000
```

Garde ce fichier **hors du repo Git** (déjà ignoré par `.gitignore`).

Récupère l'empreinte SHA-256 :

```bash
keytool -list -v -keystore pullup-tv-upload.keystore -alias pullup-tv
```

## 3. Vérifier le lien app ↔ site (Digital Asset Links)

Colle l'empreinte SHA-256 obtenue à l'étape 2 dans
`public/.well-known/assetlinks.json` (à la racine du projet, pas dans
`android-tv/`), à la place de `REMPLACE_MOI_PAR_LE_SHA256_DE_TA_CLE_DE_SIGNATURE`,
puis déploie le serveur. Vérifie que ça répond bien :

```
https://pull-up.live/.well-known/assetlinks.json
```

Sans ce fichier à jour, Chrome affichera une barre d'adresse (l'app
fonctionnera quand même, juste moins "app native").

Tu peux valider la config avec l'outil Google :
https://developers.google.com/digital-asset-links/tools/generator

## 4. Builder l'APK / AAB signé

Dans Android Studio : **Build → Generate Signed Bundle / APK**, choisis
**Android App Bundle** (`.aab`, requis par le Play Store), sélectionne
ta keystore de l'étape 2.

En ligne de commande, configure d'abord la signature dans
`app/build.gradle` (`signingConfigs`) ou passe les propriétés via
`gradle.properties`, puis :

```bash
./gradlew bundleRelease
# sortie : app/build/outputs/bundle/release/app-release.aab
```

## 5. Tester sur un appareil / TV avant publication

```bash
./gradlew assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
```

(`adb connect <ip-de-la-tv>:5555` pour une Google TV sur le même réseau
avec le débogage réseau activé dans les paramètres développeur.)

## 6. Publier sur le Play Store

1. Compte développeur Google Play (25 $ à vie, une fois) :
   https://play.google.com/console/signup
2. Créer une nouvelle app dans la Play Console, catégorie **TV** activée
   (Configuration de l'app → Présence sur l'appareil → cocher "Téléviseurs").
3. Uploader `app-release.aab` (étape 4) dans une piste (interne → prod).
4. Fournir : description, captures d'écran **format TV (16:9, 1920×1080)**,
   icône 512×512 (à générer depuis `public/images/logo.png` si besoin),
   politique de confidentialité (déjà en ligne : `/confidentialite.html`).
5. Le Play Store gère lui-même la distribution vers les appareils Google TV
   compatibles une fois la présence "Téléviseurs" activée.

## Fichiers du projet

- `app/src/main/AndroidManifest.xml` — config TWA + leanback launcher + banner TV
- `app/src/main/res/values/strings.xml` — URL cible (`default_url`) et host vérifié
- `app/src/main/res/drawable-xhdpi/tv_banner.png` — icône 320×180 affichée dans la rangée d'accueil
- `app/src/main/res/mipmap-*/ic_launcher.png` — icônes app (générées via `scripts/gen-tv-assets.js`)
- `../public/.well-known/assetlinks.json` — preuve de propriété du domaine (à compléter, étape 3)

Pour régénérer les icônes/banner si le logo change :

```bash
node scripts/gen-tv-assets.js
```
